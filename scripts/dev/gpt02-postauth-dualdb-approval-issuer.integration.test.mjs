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
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {createHash,generateKeyPairSync,randomBytes,randomUUID,sign} from 'node:crypto';
import {createGpt02PreSignFactReader} from '../../pr196-verifier-reference/artifacts/api-server/src/lib/gpt02-presign-facts-readonly.mjs';
import {Gpt02IssuerStore,canonicalApproval} from '../../artifacts/api-server/src/lib/gpt02-issuer-store.mjs';
import {operatorLinkSigningBytes} from '../../artifacts/api-server/src/lib/gpt02-operator-link.mjs';
import {createGpt02SingleOwnerTrustedFactAdapter} from '../../artifacts/api-server/src/lib/gpt02-single-owner-trusted-facts-adapter.mjs';
import {createGpt02SingleOwnerApprovalRecorder} from '../../artifacts/api-server/src/lib/gpt02-single-owner-approval-recorder.mjs';
import {createGpt02SingleOwnerApprovalHttpCandidate} from '../../artifacts/api-server/src/lib/gpt02-single-owner-approval-http-candidate.mjs';
import {createGpt02Issue159PersistedIntentGate} from '../../artifacts/api-server/src/lib/gpt02-issue159-persisted-owner-intent-gate.mjs';
import {hasRecentVerifiedGpt02DevGoogleOperator} from '../../artifacts/api-server/src/lib/gpt02-google-auth-gate.mjs';

if(process.env.GPT02_POSTAUTH_FULL_CHAIN_DISPOSABLE_ONLY!=='1')throw Error('DISPOSABLE_FULL_CHAIN_REQUIRED');
if(process.env.NODE_ENV!=='development'||process.env.APP_ENV!=='development')throw Error('DEV_ONLY');
const authModule=process.env.GPT02_PR196_AUTH_BUNDLE_PATH;
if(!authModule||!authModule.startsWith('/run/fixture-auth/'))
 throw Error('PINNED_ORIGINAL_AUTH_MIDDLEWARE_REQUIRED');
const {signToken,extractUser,requireAuth,requireRole}=
 createRequire(import.meta.url)(authModule);
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
// All signing evidence stays within this TEST-ONLY trusted process. No keys,
 // signatures, tokens, or signer selectors are accepted from HTTP input.
async function startOfflineConsentHttp({persistedIntentPresent=true}={}){
 let signerCalls=0,recorderCalls=0;
 const verifyPersistedOwnerIntent=createGpt02Issue159PersistedIntentGate({
  env:process.env,clock:Date.now,maxReadAgeMs:2000,
  // The existing Issue159 approved-claims packet is ONLY simulated here;
  // a live release must bind these methods to the original Unix reader
  // with pinned filesystem permissions and SO_PEERCRED validation.
  readTrustedClaims:async lookup=>{
   const f=suiteFixture;
   if(!f||lookup.companyId!==f.consent.companyId||
      lookup.taskId!==f.consent.taskId||
      lookup.commandId!==f.consent.commandId||
      lookup.attemptId!==f.consent.attemptId||
      lookup.operatorSubject!==f.session.id) return null;
   return f.proof.approval.claims;
  },
  readTrustedIntent:async({lookup})=>{
   if(!persistedIntentPresent)return null;
   const f=suiteFixture;
   const claims=f.proof.approval.claims;
   const digest=createHash('sha256').update(canonicalApproval(claims)).digest('hex');
   if(lookup.claimsSha256!==digest||lookup.superAdminId!==f.session.id)return null;
   return {
    ok:true,environment:'DEV',approvalReadOnly:true,decisionCreated:false,
    releaseDecision:'NO_GO',signingPermitted:false,
    authorizationGranted:false,dispatchPermitted:false,
    result:{
     environment:'DEV',reason:'TRUSTED_APPROVAL_INTENT_READ_NO_SIGNING_AUTHORITY',
     persistedTrustedReadProven:true,approvalBindingMatched:true,
     adminApprovalMatched:true,aal2SuperAdminMatched:false,
     releaseDecision:'NO_GO',signingPermitted:false,authorizationGranted:false,
     dispatchPermitted:false,
     decision:{decisionId:randomUUID(),claimsSha256:digest,actorId:f.session.id,
      authMethod:'supabase_admin_session',roleAtDecision:'super_admin',
      decision:'APPROVE',recordedAt:claims.issuedAt+10}
    }
   };
  },
 });
 const route=createGpt02SingleOwnerApprovalHttpCandidate({
  env:{NODE_ENV:'development',APP_ENV:'development',SESSION_SECRET:process.env.SESSION_SECRET,
   GPT02_SINGLE_OWNER_APPROVAL_HTTP_ENABLED:'true'}, // fixture ONLY, never deployed
  verifyFreshGoogleOperator:hasRecentVerifiedGpt02DevGoogleOperator,
  verifyPersistedOwnerIntent,
  inspectRequestOrigin:req=>req.headers.origin==='https://dev-ai-task.cstlogistic.co.id',
  readSignedProof:async({session,consent})=>{
   signerCalls++;
   const expected=suiteFixture;
   if(session.id!==expected.session.id||consent.taskId!==expected.consent.taskId||
     consent.commandId!==expected.consent.commandId||
     consent.attemptId!==expected.consent.attemptId||consent.nonce!==expected.consent.nonce)
     return null;
   return expected.proof; // ephemeral fixture signature only, never browser input
  },
  recordOneConsent:async input=>{recorderCalls++;return recorder(input)}
 });
 const auth=()=>requireRole('super_admin');
 const server=createServer(async(req,res)=>{
  const out={setHeader:(k,v)=>{res.setHeader(k,v);return out},
   status:c=>{res.statusCode=c;return out},
   json:x=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(x));return out}};
  let payload='';for await(const b of req){
   payload+=b;
   if(payload.length>8192){res.statusCode=413;res.end('{}');return}
  }
  try{req.body=payload?JSON.parse(payload):{}}catch{req.body={}}
  extractUser(req,out,()=>requireAuth(req,out,()=>auth()(req,out,()=>{void route(req,out)})));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const send=async({token=null,body={consent:suiteFixture.consent}}={})=>{
  const headers={'content-type':'application/json',
   origin:'https://dev-ai-task.cstlogistic.co.id'};
  if(token)headers.authorization='Bearer '+token;
  const response=await fetch('http://127.0.0.1:'+server.address().port,{
   method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  return {status:response.status,body:await response.json()};
 };
 return {send,counters:()=>({signerCalls,recorderCalls}),
  close:()=>new Promise(resolve=>server.close(resolve))};
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
test('real PR196 JWT middleware blocks counterfeit, stale and incomplete HTTP consent before signing',async()=>{
 const h=await startOfflineConsentHttp();
 try{
  assert.equal((await h.send()).status,401);
  assert.equal((await h.send({token:'not.a.jwt'})).status,401);
  assert.equal((await h.send({token:signToken({...suiteFixture.session,role:'staff'})})).status,403);
  assert.equal((await h.send({token:signToken({...suiteFixture.session,
   authVerifiedAt:Date.now()-11*60_000})})).status,403);
  assert.equal((await h.send({token:signToken({...suiteFixture.session,authSource:'legacy_email'})})).status,403);
  const jwt=signToken(suiteFixture.session);
  assert.equal((await h.send({token:jwt,body:{consent:{...suiteFixture.consent,approved:false}}})).status,400);
  assert.equal((await h.send({token:jwt,body:{consent:suiteFixture.consent,proof:suiteFixture.proof}})).status,400);
  assert.deepEqual(h.counters(),{signerCalls:0,recorderCalls:0});
  assert.equal(await count('approvals'),0);
 }finally{await h.close()}
});
test('a fresh JWT and gesture without an actual persisted Issue159 Owner decision must never contact signer',async()=>{
 const h=await startOfflineConsentHttp({persistedIntentPresent:false});
 try{
  const r=await h.send({token:signToken(suiteFixture.session)});
  assert.equal(r.status,424);
  assert.equal(r.body.reason,'PERSISTED_OWNER_DECISION_REQUIRED');
  assert.deepEqual(h.counters(),{signerCalls:0,recorderCalls:0});
  assert.equal(await count('approvals'),0);
 }finally{await h.close()}
});
test('eight simultaneous ORIGINAL JWT HTTP requests, real TLS Hub/Core reads and attestor writes commit exactly one',async()=>{
 const h=await startOfflineConsentHttp();
 try{
  const jwt=signToken(suiteFixture.session);
  const result=await Promise.all(Array.from({length:8},()=>h.send({token:jwt})));
  assert.equal(result.filter(x=>x.status===202).length,1,'exactly one HTTP consent records signed evidence');
  assert.equal(result.filter(x=>x.status===409).length,7);
  for(const out of result){
   assert.equal(out.body.releaseDecision,'NO_GO');
   assert.equal(out.body.authorizationGranted,false);
   assert.equal(out.body.issuerLeaseGranted,false);
   assert.equal(out.body.dispatchPermitted,false);
   assert.equal(out.body.commandCreated,false);
  }
  assert.deepEqual(h.counters(),{signerCalls:8,recorderCalls:8});
  assert.equal(await count('approvals'),1);
  assert.equal(await count('operator_links'),1);
  assert.equal(await count('receipts'),0);
 }finally{await h.close()}
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
