/**
 * Isolated PostgreSQL-only integration of candidate one-owner recorder with
 * ORIGINAL PR196 restricted attestor / issuer and immutable evidence schema.
 * Never connects to hosted CST-DEV/PROD, signs as a real Owner, or dispatches.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {randomBytes,randomUUID,generateKeyPairSync,sign,createHash} from 'node:crypto';
import {createGpt02SingleOwnerApprovalRecorder} from '../../artifacts/api-server/src/lib/gpt02-single-owner-approval-recorder.mjs';
import {Gpt02IssuerStore,canonicalApproval} from '../../artifacts/api-server/src/lib/gpt02-issuer-store.mjs';
import {operatorLinkSigningBytes} from '../../artifacts/api-server/src/lib/gpt02-operator-link.mjs';

if(process.env.GPT02_DISPOSABLE_PG_ONLY!=='1')throw Error('DISPOSABLE_POSTGRES_ONLY');
const {Pool}=createRequire(import.meta.url)(process.env.GPT02_TEST_PG_MODULE);
const auth=JSON.parse(readFileSync('/run/fixture-auth.json','utf8'));
const users=['postgres','dev_gpt02_attestor_evidence','dev_gpt02_issuer_evidence'];
const pool=user=>new Pool({host:'/var/run/postgresql',database:'gpt02_issuer_isolated',
  user,password:auth[user],max:8,connectionTimeoutMillis:3000,statement_timeout:5000});
const admin=pool(users[0]),attestorPool=pool(users[1]),issuerPool=pool(users[2]);
const env={NODE_ENV:'development',APP_ENV:'development',
  SESSION_SECRET:'synthetic-session-secret-only-for-offline-approval-gates'};
let syntheticTask=2000;
const pem=k=>k.publicKey.export({format:'pem',type:'spki'}).toString();
const digest=k=>createHash('sha256').update(k.publicKey.export({format:'der',type:'spki'})).digest('hex');
function fixture(){
 const keys=Array.from({length:4},()=>generateKeyPairSync('ed25519'));
 const [approvalKeys,hubKeys,coreKeys,issuerKeys]=keys;
 const now=Date.now(),id=syntheticTask++;
 const [hubExecutionId,coreTaskId,commandCandidateId,attemptId,linkId]=
   Array.from({length:5},()=>randomUUID());
 const operatorSubject='google_fixture_operator_7',workerId='openclaw-dell-chatgpt-wake-dev';
 const claims={v:2,environment:'DEV',audience:'GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL',
   taskId:id,commandId:commandCandidateId,attemptId,
   nonce:randomBytes(32).toString('base64url'),
   operatorNamespace:'ai-task-hub.public.users',superAdminId:operatorSubject,
   companyId:'default',issuedAt:now-60,expiresAt:now+85000};
 const approvalDigest=createHash('sha256').update(canonicalApproval(claims)).digest('hex');
 const link={v:1,environment:'DEV',audience:'GPT02_DUAL_ACCOUNT_COMMAND_LINK',
   linkId,companyId:'default',hubTaskId:id,hubExecutionId,coreTaskId,
   coreCommandId:commandCandidateId,attemptId,attemptNumber:1,
   assigneeId:42,accountableOwnerId:'fixture_owner',
   hubOperatorNamespace:'ai-task-hub.public.users',hubOperatorId:operatorSubject,
   hubRole:'super_admin',hubActive:true,
   coreOperatorNamespace:'ai-core.ai_platform.internal_users',coreOperatorUserId:77,
   coreRole:'admin',coreActive:true,corePasswordChanged:true,
   workerId,approvalDigest,nonce:claims.nonce,issuedAt:now-35,expiresAt:now+80000};
 const proof={approval:{claims,signatureBase64url:sign(null,Buffer.from(canonicalApproval(claims)),
    approvalKeys.privateKey).toString('base64url')},
   operatorLink:{claims:link,
    hubSignatureBase64url:sign(null,operatorLinkSigningBytes(link,'hub'),hubKeys.privateKey).toString('base64url'),
    coreSignatureBase64url:sign(null,operatorLinkSigningBytes(link,'core'),coreKeys.privateKey).toString('base64url')}};
 const facts={
   prepared:{companyId:'default',hubTaskId:id,memberId:42,memberAuditId:9801,
     operatorSubject,coreTaskId,hubExecutionId,commandCandidateId,attemptId,expiresAt:now+90000},
   job:{companyId:'default',taskId:id,executionId:hubExecutionId,status:'prepared',
     commandId:null,workerCommandCount:0,attemptNumber:1,dispatchStarted:false,
     memberId:42,memberAuditId:9801,operatorSubject},
   core:{taskId:coreTaskId,commandCandidateId,attemptId,status:'PENDING',
     commandCount:0,runCount:0,workerId,operatorUserId:77,operatorRole:'admin',
     operatorActive:true,passwordChanged:true},
   hubOperator:{subject:operatorSubject,role:'super_admin',active:true,
     memberId:42,accountableOwnerId:'fixture_owner'}};
 const store={approvalPublicKeyPem:pem(approvalKeys),hubPublicKeyPem:pem(hubKeys),
   corePublicKeyPem:pem(coreKeys),issuerPublicKeyPem:pem(issuerKeys),
   metadata:{environment:'DEV',fingerprints:{approval:digest(approvalKeys),
     hub:digest(hubKeys),core:digest(coreKeys),issuer:digest(issuerKeys)}},
   dispatchPermitted:false,issuerLeaseGranted:false};
 const attestor=new Gpt02IssuerStore({pool:attestorPool,kind:'attestor',
   trustedPublicKeyPem:pem(approvalKeys),operatorAttestationKeys:{
   hubPublicKeyPem:pem(hubKeys),corePublicKeyPem:pem(coreKeys)}});
 const issuer=new Gpt02IssuerStore({pool:issuerPool,kind:'issuer',
   trustedPublicKeyPem:pem(approvalKeys),operatorAttestationKeys:{
   hubPublicKeyPem:pem(hubKeys),corePublicKeyPem:pem(coreKeys)}});
 const session={id:operatorSubject,email:'test-owner@example.invalid',
   role:'super_admin',authSource:'supabase_google_identity',
   authSupabaseId:randomUUID(),authVerifiedAt:now};
 const consent={kind:'GPT02_DEV_SINGLE_COMMAND_CONSENT_V1',approved:true,
   companyId:'default',taskId:id,commandId:commandCandidateId,attemptId,
   nonce:claims.nonce,operatorSubject};
 let factsRead=0;
 const recorder=createGpt02SingleOwnerApprovalRecorder({env,clock:()=>now,
   readTrustedFacts:async()=>{factsRead++;return facts;},
   loadTrustedKeys:()=>store,attestorStore:attestor});
 return {id,claims,proof,consent,session,recorder,issuer,facts,now,
   factsCount:()=>factsRead};
}
const count=async(name,field,id)=>{
 const allowed=new Map([['approvals','command_id'],['receipts','command_id'],
   ['operator_links','command_id'],['core_identity_receipts','command_id']]);
 if(allowed.get(name)!==field)throw Error('INVALID_AUDIT_TABLE');
 const result=await admin.query('SELECT count(*)::integer AS n FROM gpt02_private.'+
   name+' WHERE '+field+'=$1',[id]);
 return result.rows[0].n;
};
test('actual dedicated SCRAM attestor role only, owner not impersonated',async()=>{
 const a=(await attestorPool.query('SELECT session_user,current_user')).rows[0];
 const i=(await issuerPool.query('SELECT session_user,current_user')).rows[0];
 assert.equal(a.session_user,'dev_gpt02_attestor_evidence');
 assert.equal(a.current_user,a.session_user);
 assert.equal(i.session_user,'dev_gpt02_issuer_evidence');
 assert.equal(i.current_user,i.session_user);
});
test('one synthetically signed Owner consent persists exactly one immutable linked evidence row, not a grant',async()=>{
 const f=fixture(),result=await f.recorder({session:f.session,consent:f.consent,proof:f.proof});
 assert.equal(result.recorded,true);assert.equal(result.dispatchPermitted,false);
 assert.equal(result.issuerLeaseGranted,false);assert.equal(result.releaseDecision,'NO_GO');
 assert.equal(await count('approvals','command_id',f.claims.commandId),1);
 assert.equal(await count('operator_links','command_id',f.claims.commandId),1);
 assert.equal(await count('receipts','command_id',f.claims.commandId),0);
 const row=(await admin.query('SELECT task_id,approver_id,company_id FROM gpt02_private.approvals WHERE command_id=$1',[f.claims.commandId])).rows[0];
 assert.equal(row.task_id,f.id);assert.equal(row.approver_id,f.session.id);assert.equal(row.company_id,'default');
});
test('signed approval replay and eight concurrent duplicate requests commit one approval only',async()=>{
 const f=fixture(),inputs={session:f.session,consent:f.consent,proof:f.proof};
 const outcome=await Promise.all(Array.from({length:8},()=>f.recorder(inputs)));
 assert.equal(outcome.filter(x=>x.recorded===true).length,1);
 assert.equal(outcome.filter(x=>x.recorded===false).length,7);
 for(const item of outcome)assert.equal(item.dispatchPermitted,false);
 assert.equal(await count('approvals','command_id',f.claims.commandId),1);
 assert.equal(await count('operator_links','command_id',f.claims.commandId),1);
});
test('issuer only consumes stored evidence once; durable receipt never authorizes dispatch',async()=>{
 const f=fixture(),r=await f.recorder({session:f.session,consent:f.consent,proof:f.proof});
 assert.equal(r.recorded,true);
 const consumed=await f.issuer.consumeLinkedApproval(f.proof);
 assert.ok(consumed.receiptId);assert.equal(consumed.authorizationGranted,false);
 assert.equal(consumed.coreLedgerWritten,false);assert.equal(consumed.dispatchPermitted,false);
 assert.equal(await count('receipts','command_id',f.claims.commandId),1);
 assert.equal(await count('core_identity_receipts','command_id',f.claims.commandId),1);
 await assert.rejects(f.issuer.consumeLinkedApproval(f.proof),
   e=>e.code==='LINKED_APPROVAL_UNAVAILABLE_OR_REPLAYED');
 const row=(await admin.query('SELECT may_dispatch_worker,may_issue_grant,core_ledger_written FROM gpt02_private.core_identity_receipts WHERE command_id=$1',[f.claims.commandId])).rows[0];
 assert.equal(row.may_dispatch_worker,false);assert.equal(row.may_issue_grant,false);
 assert.equal(row.core_ledger_written,false);
});
test('bad signed tuple, expired fact, stale Owner session cannot call real attestor',async()=>{
 for(const kind of ['signature','expired','role','consent','tenant']){
  const f=fixture(),p=structuredClone(f.proof),c={...f.consent},s={...f.session};
  if(kind==='signature')p.operatorLink.coreSignatureBase64url='A'.repeat(86);
  if(kind==='expired')f.facts.prepared.expiresAt=f.now-500;
  if(kind==='role')s.role='staff';
  if(kind==='consent')c.approved=false;
  if(kind==='tenant')c.companyId='other';
  const r=await f.recorder({session:s,consent:c,proof:p});
  assert.equal(r.recorded,false,kind);
  assert.equal(await count('approvals','command_id',f.claims.commandId),0,kind);
  assert.equal(await count('receipts','command_id',f.claims.commandId),0,kind);
 }
});
test.after(async()=>{await Promise.all([admin.end(),attestorPool.end(),issuerPool.end()]);});
