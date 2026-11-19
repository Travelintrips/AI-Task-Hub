import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomBytes,randomUUID,sign} from 'node:crypto';
import {createGpt02SingleOwnerApprovalRecorder} from '../../artifacts/api-server/src/lib/gpt02-single-owner-approval-recorder.mjs';
import {canonicalApproval} from '../../artifacts/api-server/src/lib/gpt02-issuer-store.mjs';
import {operatorLinkSigningBytes} from '../../artifacts/api-server/src/lib/gpt02-operator-link.mjs';
const env={NODE_ENV:'development',APP_ENV:'development',SESSION_SECRET:'isolated-synthetic-only-session-secret-length-pass'};
const uid='operator_7',worker='openclaw-dell-chatgpt-wake-dev';
function fixture(){
 const keys=[0,1,2].map(()=>generateKeyPairSync('ed25519')),now=Date.now();
 const [coreTaskId,hubExecutionId,commandCandidateId,attemptId]=[0,1,2,3].map(()=>randomUUID());
 const prepared={companyId:'default',hubTaskId:172,memberId:42,memberAuditId:921,
  operatorSubject:uid,coreTaskId,hubExecutionId,commandCandidateId,attemptId,expiresAt:now+120000};
 const job={companyId:'default',taskId:172,executionId:hubExecutionId,status:'prepared',commandId:null,
  workerCommandCount:0,attemptNumber:1,dispatchStarted:false,memberId:42,memberAuditId:921,operatorSubject:uid};
 const core={taskId:coreTaskId,commandCandidateId,attemptId,status:'PENDING',commandCount:0,
  runCount:0,workerId:worker,operatorUserId:77,operatorRole:'admin',operatorActive:true,passwordChanged:true};
 const hubOperator={subject:uid,role:'super_admin',active:true,memberId:42,accountableOwnerId:'fixture_owner'};
 const a={v:2,environment:'DEV',audience:'GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL',
  taskId:172,commandId:commandCandidateId,attemptId,nonce:randomBytes(32).toString('base64url'),
  operatorNamespace:'ai-task-hub.public.users',superAdminId:uid,companyId:'default',
  issuedAt:now-100,expiresAt:now+60000};
 const digest=createHash('sha256').update(canonicalApproval(a)).digest('hex');
 const l={v:1,environment:'DEV',audience:'GPT02_DUAL_ACCOUNT_COMMAND_LINK',
  linkId:randomUUID(),companyId:'default',hubTaskId:172,hubExecutionId,coreTaskId,
  coreCommandId:commandCandidateId,attemptId,attemptNumber:1,assigneeId:42,
  accountableOwnerId:'fixture_owner',hubOperatorNamespace:'ai-task-hub.public.users',
  hubOperatorId:uid,hubRole:'super_admin',hubActive:true,
  coreOperatorNamespace:'ai-core.ai_platform.internal_users',coreOperatorUserId:77,
  coreRole:'admin',coreActive:true,corePasswordChanged:true,workerId:worker,
  approvalDigest:digest,nonce:a.nonce,issuedAt:now-80,expiresAt:now+59000};
 const proof={approval:{claims:a,signatureBase64url:sign(null,Buffer.from(canonicalApproval(a)),keys[0].privateKey).toString('base64url')},
 operatorLink:{claims:l,hubSignatureBase64url:sign(null,operatorLinkSigningBytes(l,'hub'),keys[1].privateKey).toString('base64url'),
 coreSignatureBase64url:sign(null,operatorLinkSigningBytes(l,'core'),keys[2].privateKey).toString('base64url')}};
 const pem=k=>k.publicKey.export({format:'pem',type:'spki'}).toString();
 const store={approvalPublicKeyPem:pem(keys[0]),hubPublicKeyPem:pem(keys[1]),
  corePublicKeyPem:pem(keys[2]),metadata:{environment:'DEV',fingerprints:{approval:'a'.repeat(64),hub:'b'.repeat(64),core:'c'.repeat(64),issuer:'d'.repeat(64)}},
  issuerLeaseGranted:false,dispatchPermitted:false};
 const session={id:uid,email:'owner@example.invalid',role:'super_admin',
  authSource:'supabase_google_identity',authSupabaseId:randomUUID(),authVerifiedAt:now};
 const consent={kind:'GPT02_DEV_SINGLE_COMMAND_CONSENT_V1',approved:true,
  companyId:'default',taskId:172,commandId:commandCandidateId,attemptId,nonce:a.nonce,operatorSubject:uid};
 const facts={prepared,job,core,hubOperator};
 let recorded=0,read=0;
 const d={env,clock:()=>now,readTrustedFacts:async()=>{read++;return facts},
  loadTrustedKeys:()=>store,attestorStore:{recordLinkedApproval:async()=>{recorded++;return {approvalEvidenceRecorded:true,dualIdentityEvidenceRecorded:true,authorizationGranted:false,dispatchPermitted:false}}}};
 const run=(overrides={})=>createGpt02SingleOwnerApprovalRecorder({...d,...overrides});
 return {proof,session,consent,facts,store,run,getCalls:()=>({recorded,read}),now};
}
test('exact one Owner consent with three independently verified synthetic signatures records evidence but never grants dispatch',async()=>{
 const f=fixture(),res=await f.run()({session:f.session,consent:f.consent,proof:f.proof});
 assert.equal(res.recorded,true);assert.equal(res.reason,'SIGNED_EVIDENCE_RECORDED_ONLY');
 assert.deepEqual(f.getCalls(),{read:1,recorded:1});
 for(const flag of ['authorizationGranted','issuerLeaseGranted','dispatchPermitted','commandCreated'])assert.equal(res[flag],false);
 assert.equal(res.releaseDecision,'NO_GO');
});
test('no consent, wrong permission, role, Google session or operator identity cannot reach attestor',async()=>{
 for(const alter of [
  {consent:{...fixture().consent,approved:false}},
  {session:{...fixture().session,role:'staff'}},
  {session:{...fixture().session,authSource:'legacy_email'}},
  {session:{...fixture().session,authVerifiedAt:0}},
  {session:{...fixture().session,id:'other_operator'}},
 ]){
  const f=fixture();
  const input={session:f.session,consent:f.consent,proof:f.proof,...alter};
  const r=await f.run()(input);assert.equal(r.recorded,false);
  assert.equal(f.getCalls().recorded,0);
 }
});
test('the exact requested command, nonce, company, attempt, task and namespace must match signed approval',async()=>{
 for(const key of ['commandId','attemptId','nonce','companyId','taskId','operatorSubject']){
  const f=fixture();const value=key==='taskId'?173:key==='companyId'?'other':key==='nonce'?randomBytes(32).toString('base64url'):key==='operatorSubject'?'another_user':randomUUID();
  const r=await f.run()({session:f.session,consent:{...f.consent,[key]:value},proof:f.proof});
  assert.equal(r.recorded,false,key);assert.equal(f.getCalls().recorded,0,key);
 }
});
test('forged signed approval, mismatched Core identity, wrong independent key and expired preparation are refused',async()=>{
 for(const change of ['tamper','core','key','expired']){
  const f=fixture();const p=structuredClone(f.proof);
  if(change==='tamper')p.approval.signatureBase64url='A'.repeat(86);
  if(change==='core')f.facts.core.operatorUserId=78;
  if(change==='key')f.store.corePublicKeyPem=generateKeyPairSync('ed25519').publicKey.export({format:'pem',type:'spki'}).toString();
  if(change==='expired')f.facts.prepared.expiresAt=f.now-1;
  const r=await f.run()({session:f.session,consent:f.consent,proof:p});
  assert.equal(r.recorded,false,change);assert.equal(f.getCalls().recorded,0,change);
 }
});
test('database and attestor failures deny without release',async()=>{
 for(const override of [
  {readTrustedFacts:async()=>{throw Error('DB_OFFLINE')}},
  {loadTrustedKeys:()=>{throw Error('NO_MOUNT')}},
  {attestorStore:{recordLinkedApproval:async()=>{throw Error('ROLE_NOLOGIN')}}},
  {attestorStore:{recordLinkedApproval:async()=>({approvalEvidenceRecorded:true,dualIdentityEvidenceRecorded:true,authorizationGranted:true,dispatchPermitted:false})}},
 ]){
  const f=fixture(),res=await f.run(override)({session:f.session,consent:f.consent,proof:f.proof});
  assert.equal(res.recorded,false);assert.equal(res.dispatchPermitted,false);
 }
});
test('candidate recorder has no HTTP route or private signing material',async()=>{
 const fs=await import('node:fs');
 const s=fs.readFileSync(new URL('../../artifacts/api-server/src/lib/gpt02-single-owner-approval-recorder.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(s,/privateKey|\.sign\(|Router\(|router\.post\(|app\.post\(|issuerStore\.consumeLinkedApproval\(/);
});
