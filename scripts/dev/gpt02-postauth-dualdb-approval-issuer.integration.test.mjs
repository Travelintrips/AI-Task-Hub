/**
 * Disposable complete POST-AUTHORITY rehearsal: original PR196 Hub/Core
 * two TLS/SCRAM readers -> PR207 trusted adapter -> independently synthesized
 * four-domain Ed25519 fixture proof -> PR207 single-owner recorder ->
 * original PR196 restricted attestor -> original PR196 restricted issuer.
 *
 * ALL keys and consent here are test-only, generated inside this isolated
 * process. Not an HTTP route, not a real owner approval, and NEVER dispatch.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createHash,generateKeyPairSync,randomBytes,randomUUID,sign} from 'node:crypto';
import {createGpt02PreSignFactReader} from '../../pr196-verifier-reference/artifacts/api-server/src/lib/gpt02-presign-facts-readonly.mjs';
import {Gpt02IssuerStore,canonicalApproval} from '../../artifacts/api-server/src/lib/gpt02-issuer-store.mjs';
import {operatorLinkSigningBytes} from '../../artifacts/api-server/src/lib/gpt02-operator-link.mjs';
import {createGpt02SingleOwnerTrustedFactAdapter} from '../../artifacts/api-server/src/lib/gpt02-single-owner-trusted-facts-adapter.mjs';
import {createGpt02SingleOwnerApprovalRecorder} from '../../artifacts/api-server/src/lib/gpt02-single-owner-approval-recorder.mjs';

if(process.env.GPT02_POSTAUTH_FULL_CHAIN_DISPOSABLE_ONLY!=='1')throw Error('DISPOSABLE_FULL_CHAIN_REQUIRED');
if(process.env.NODE_ENV!=='development'||process.env.APP_ENV!=='development')throw Error('DEV_ONLY');
const {Pool}=createRequire('/workspace/artifacts/api-server/package.json')('pg');
const pass=JSON.parse(readFileSync('/run/fixture-auth.json','utf8'));
const ca=readFileSync('/run/ssl/server.crt','utf8');
const dbConfig={host:'synthetic-pg',port:5432,max:8,connectionTimeoutMillis:4000,
 ssl:{ca,rejectUnauthorized:true},statement_timeout:5000};
const pool=(user,database)=>new Pool({...dbConfig,user,database,password:pass[user]});
const hubPool=pool('gpt02_hub_evidence_reader','postgres');
const corePool=pool('gpt02_core_evidence_reader','postgres');
const attestorPool=pool('dev_gpt02_attestor_evidence','gpt02_issuer_isolated');
const issuerPool=pool('dev_gpt02_issuer_evidence','gpt02_issuer_isolated');
const admin=pool('postgres','postgres');
const audit=pool('postgres','gpt02_issuer_isolated');
const keys=Array.from({length:4},()=>generateKeyPairSync('ed25519'));
const [approvalKey,hubKey,coreKey,issuerKey]=keys;
const pem=k=>k.publicKey.export({format:'pem',type:'spki'}).toString();
const fingerprint=k=>createHash('sha256').update(k.publicKey.export({format:'der',type:'spki'})).digest('hex');
const roots={approvalPublicKeyPem:pem(approvalKey),hubPublicKeyPem:pem(hubKey),
 corePublicKeyPem:pem(coreKey),issuerPublicKeyPem:pem(issuerKey),
 metadata:{environment:'DEV',fingerprints:{approval:fingerprint(approvalKey),hub:fingerprint(hubKey),
  core:fingerprint(coreKey),issuer:fingerprint(issuerKey)}},
 issuerLeaseGranted:false,dispatchPermitted:false};
const originalReader=createGpt02PreSignFactReader({hubPool,corePool});
const adaptedReader=createGpt02SingleOwnerTrustedFactAdapter({
 readPreSignFacts:originalReader,env:process.env,maxAgeMs:2000});
const originKeys={hubPublicKeyPem:roots.hubPublicKeyPem,
 corePublicKeyPem:roots.corePublicKeyPem};
const attestor=new Gpt02IssuerStore({pool:attestorPool,kind:'attestor',
 trustedPublicKeyPem:roots.approvalPublicKeyPem,operatorAttestationKeys:originKeys});
const issuer=new Gpt02IssuerStore({pool:issuerPool,kind:'issuer',
 trustedPublicKeyPem:roots.approvalPublicKeyPem,operatorAttestationKeys:originKeys});
const recorder=createGpt02SingleOwnerApprovalRecorder({
 env:process.env,readTrustedFacts:adaptedReader,loadTrustedKeys:()=>roots,attestorStore:attestor
});
const req=Object.freeze({companyId:'default',hubTaskId:172,
 commandCandidateId:'33333333-3333-4333-8333-333333333333',
 attemptId:'44444444-4444-4444-8444-444444444444'});
let suiteFixture=null;
const count=async table=>{
 if(!['approvals','operator_links','receipts','core_identity_receipts'].includes(table))throw Error('AUDIT_TABLE_NOT_ALLOWED');
 const r=await audit.query('SELECT count(*)::int AS n FROM gpt02_private.'+table+
 ' WHERE command_id=$1',[req.commandCandidateId]);
 return r.rows[0].n;
};
async function buildBoundFixture(){
 const facts=await adaptedReader(req);
 const now=Date.now(),operator=facts.prepared.operatorSubject,nonce=randomBytes(32).toString('base64url');
 const session={id:operator,email:'owner@example.invalid',companyId:'default',name:'Fixture Owner',
  role:'super_admin',authSource:'supabase_google_identity',authSupabaseId:randomUUID(),
  authVerifiedAt:now};
 const consent={kind:'GPT02_DEV_SINGLE_COMMAND_CONSENT_V1',approved:true,
  companyId:'default',taskId:req.hubTaskId,commandId:req.commandCandidateId,
  attemptId:req.attemptId,nonce,operatorSubject:operator};
 const approval={v:2,environment:'DEV',audience:'GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL',
  taskId:req.hubTaskId,commandId:req.commandCandidateId,attemptId:req.attemptId,nonce,
  operatorNamespace:'ai-task-hub.public.users',superAdminId:operator,companyId:'default',
  issuedAt:now-80,expiresAt:Math.min(now+60000,facts.prepared.expiresAt-3000)};
 const approvalDigest=createHash('sha256').update(canonicalApproval(approval)).digest('hex');
 const link={v:1,environment:'DEV',audience:'GPT02_DUAL_ACCOUNT_COMMAND_LINK',
  linkId:randomUUID(),companyId:approval.companyId,hubTaskId:approval.taskId,
  hubExecutionId:facts.job.executionId,coreTaskId:facts.core.taskId,
  coreCommandId:approval.commandId,attemptId:approval.attemptId,attemptNumber:1,
  assigneeId:facts.prepared.memberId,accountableOwnerId:facts.hubOperator.accountableOwnerId,
  hubOperatorNamespace:'ai-task-hub.public.users',hubOperatorId:operator,
  hubRole:'super_admin',hubActive:true,
  coreOperatorNamespace:'ai-core.ai_platform.internal_users',
  coreOperatorUserId:facts.core.operatorUserId,coreRole:facts.core.operatorRole,
  coreActive:true,corePasswordChanged:true,workerId:facts.core.workerId,
  approvalDigest,nonce,issuedAt:now-50,expiresAt:Math.min(now+55000,approval.expiresAt-1000)};
 const proof={approval:{claims:approval,signatureBase64url:
   sign(null,Buffer.from(canonicalApproval(approval)),approvalKey.privateKey).toString('base64url')},
  operatorLink:{claims:link,hubSignatureBase64url:
   sign(null,operatorLinkSigningBytes(link,'hub'),hubKey.privateKey).toString('base64url'),
   coreSignatureBase64url:sign(null,operatorLinkSigningBytes(link,'core'),
    coreKey.privateKey).toString('base64url')}};
 return {facts,session,consent,proof};
}
test('real dual SSL/SCRAM pre-sign reader produces immutable exact bound facts before approval',async()=>{
 const {facts,session,consent,proof}=suiteFixture=await buildBoundFixture();
 assert.equal(facts.prepared.hubTaskId,172);
 assert.equal(facts.job.commandId,null);
 assert.equal(facts.job.dispatchStarted,false);
 assert.equal(facts.core.status,'PENDING');
 assert.equal(facts.core.workerId,'openclaw-dell-chatgpt-wake-dev');
 assert.equal(consent.operatorSubject,session.id);
 assert.equal(proof.operatorLink.claims.coreCommandId,facts.prepared.commandCandidateId);
 assert.equal(await count('approvals'),0);
});
test('stale Google session and changed exact consent cannot reach real attestor',async()=>{
 const {session,consent,proof}=suiteFixture;
 for(const changed of [
  {session:{...session,authVerifiedAt:Date.now()-11*60_000}},
  {session:{...session,authSource:'legacy_email'}},
  {consent:{...consent,approved:false}},
  {consent:{...consent,taskId:171}},
  {consent:{...consent,companyId:'other'}},
  {consent:{...consent,nonce:randomBytes(32).toString('base64url')}},
 ]){
  const out=await recorder({session,consent,proof,...changed});
  assert.equal(out.recorded,false);
  assert.equal(out.releaseDecision,'NO_GO');
  assert.equal(out.dispatchPermitted,false);
 }
 assert.equal(await count('approvals'),0);
});
test('real Core status tamper and PIC audit tamper deny a previously signed synthetic tuple',async()=>{
 const {session,consent,proof}=suiteFixture;
 await admin.query("UPDATE ai_platform.ai_coding_tasks SET status='COMPLETED' WHERE id=$1",
  [suiteFixture.facts.core.taskId]);
 try{
  const r=await recorder({session,consent,proof});
  assert.equal(r.recorded,false);assert.equal(r.dispatchPermitted,false);
 }finally{
  await admin.query("UPDATE ai_platform.ai_coding_tasks SET status='PENDING' WHERE id=$1",
   [suiteFixture.facts.core.taskId]);
 }
 await admin.query("UPDATE public.audit_logs SET after='{}'::jsonb WHERE id=9801");
 try{
  const r=await recorder({session,consent,proof});
  assert.equal(r.recorded,false);assert.equal(r.dispatchPermitted,false);
 }finally{
  await admin.query("UPDATE public.audit_logs SET after=$1::jsonb WHERE id=9801",
  [JSON.stringify({actorIdentity:{id:session.id,role:'super_admin',email:session.email}})]);
 }
 assert.equal(await count('approvals'),0);
});
test('eight simultaneous full real Hub+Core TLS reads and dedicated attestor writes store one signed approval',async()=>{
 const {session,consent,proof}=suiteFixture;
 const result=await Promise.all(Array.from({length:8},()=>recorder({session,consent,proof})));
 const committed=result.filter(x=>x.recorded===true);
 assert.equal(committed.length,1,'exactly one recorder may commit signed evidence');
 assert.equal(result.filter(x=>x.recorded===false).length,7);
 for(const out of result){
  assert.equal(out.releaseDecision,'NO_GO');
  assert.equal(out.authorizationGranted,false);
  assert.equal(out.issuerLeaseGranted,false);
  assert.equal(out.dispatchPermitted,false);
  assert.equal(out.commandCreated,false);
 }
 assert.equal(await count('approvals'),1);assert.equal(await count('operator_links'),1);
 assert.equal(await count('receipts'),0);
});
test('original issuer consumes once, records one immutable non-authorizing receipt; replay rejected',async()=>{
 const out=await issuer.consumeLinkedApproval(suiteFixture.proof);
 assert.ok(out.receiptId);assert.equal(out.evidenceConsumed,true);
 assert.equal(out.dispatchPermitted,false);assert.equal(out.authorizationGranted,false);
 assert.equal(out.coreLedgerWritten,false);
 assert.equal(await count('receipts'),1);
 assert.equal(await count('core_identity_receipts'),1);
 await assert.rejects(issuer.consumeLinkedApproval(suiteFixture.proof),
  e=>e?.code==='LINKED_APPROVAL_UNAVAILABLE_OR_REPLAYED');
 const row=(await audit.query('SELECT may_dispatch_worker,may_issue_grant,may_close_job,core_ledger_written '+
   'FROM gpt02_private.core_identity_receipts WHERE command_id=$1',[req.commandCandidateId])).rows[0];
 for(const v of Object.values(row))assert.equal(v,false);
});
test('historical task cannot replay through original reader or trusted adapter',async()=>{
 await assert.rejects(adaptedReader({...req,hubTaskId:171}),
  e=>e?.code==='FRESH_DEV_TASK_BINDING_REQUIRED');
});
test.after(async()=>{await Promise.all([hubPool,corePool,attestorPool,issuerPool,admin,audit].map(p=>p.end()))});
