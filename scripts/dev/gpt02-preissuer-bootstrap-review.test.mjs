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
import {readFileSync} from 'node:fs';
import {reviewGpt02ThreeSignedPreissuerCandidate} from '../../artifacts/api-server/src/lib/gpt02-preissuer-bootstrap-review.mjs';

function reviewFixture(){
 const f=fixture(),link=f.proof.operatorLink.claims;
 const receiptId=randomUUID();
 const digest=createHash('sha256').update(canonicalApproval(f.proof.approval.claims)).digest('hex');
 const decision={verified:true,reason:'ISSUE159_PERSISTED_DECISION_VERIFIED_ONLY',digest,
  releaseDecision:'NO_GO',authorizationGranted:false,signingPermitted:false,issuerLeaseGranted:false,dispatchPermitted:false};
 const attestor={approvalEvidenceRecorded:true,dualIdentityEvidenceRecorded:true,authorizationGranted:false,dispatchPermitted:false};
 const consumed={receiptId,linkId:link.linkId,coreOperatorUserId:link.coreOperatorUserId,
  recordedBy:'original-issuer-store-fixture',evidenceConsumed:true,coreLedgerWritten:false,
  authorizationGranted:false,dispatchPermitted:false};
 const fence={fenceId:randomUUID(),receiptId,commandId:f.consent.commandId,leaseEpoch:1,
  evidenceFenceReserved:true,issuerLeaseGranted:false,coreLedgerWritten:false,
  operatorApprovalGranted:false,dispatchPermitted:false,readOnly:false};
 const input={env,now:f.now,session:f.session,consent:f.consent,proof:f.proof,
  trustedFacts:f.facts,trustedPublicKeys:{
    approvalPublicKeyPem:f.store.approvalPublicKeyPem,
    hubPublicKeyPem:f.store.hubPublicKeyPem,
    corePublicKeyPem:f.store.corePublicKeyPem,
  },persistedOwnerDecision:decision,
  attestorEvidence:attestor,consumedReceipt:consumed,evidenceFence:fence};
 return {f,input};
}
const denied=(input)=>{const v=reviewGpt02ThreeSignedPreissuerCandidate(input);
 assert.equal(v.reviewed,false);assert.equal(v.releaseDecision,'NO_GO');
 assert.equal(v.credentialIssuancePermitted,false);
 assert.equal(v.dispatchPermitted,false);return v;};

test('original three signatures + source facts + original receipt/fence yield ONLY inert preissuer review',()=>{
 const {f,input}=reviewFixture(),v=reviewGpt02ThreeSignedPreissuerCandidate(input);
 assert.equal(v.reviewed,true,v.reason);
 assert.equal(v.threeSignaturesReviewed,true);
 assert.equal(v.scope.taskId,172);
 assert.equal(v.scope.commandId,f.consent.commandId);
 assert.equal(v.scope.linkId,f.proof.operatorLink.claims.linkId);
 assert.equal(v.scope.receiptId,input.consumedReceipt.receiptId);
 assert.equal(v.scope.fenceId,input.evidenceFence.fenceId);
 assert.match(v.scopeSha256,/^[a-f0-9]{64}$/);
 for(const field of ['databaseTaskIsolationProven','credentialIssuancePermitted',
   'replayProtectionProven','authorizationGranted','signingPermitted',
   'issuerLeaseGranted','dispatchPermitted','commandCreated'])
  assert.equal(v[field],false,field);
 assert.equal(v.releaseDecision,'NO_GO');
});
test('historical Task171 and cross-tenant request deny before any reader authority',()=>{
 for(const value of [171,136]){
  const {input}=reviewFixture();
  denied({...input,consent:{...input.consent,taskId:value}});
 }
 const {input}=reviewFixture();
 denied({...input,consent:{...input.consent,companyId:'other'}});
});
test('stale, email-only and non-admin JWT provenance refuse preissuer review',()=>{
 for(const change of [
  {role:'staff'}, {authSource:'email_only'},
  {authVerifiedAt:0}, {id:'another_operator'}
 ]){
  const {input}=reviewFixture();
  denied({...input,session:{...input.session,...change}});
 }
});
test('a fresh Google session without original persisted Owner intent is NOT approval',()=>{
 for(const patch of [
  {verified:false},{reason:'UNTRUSTED_OWNER_INTENT'},
  {signingPermitted:true},{authorizationGranted:true},
  {digest:'f'.repeat(64)},{releaseDecision:'GO'}
 ]){
  const {input}=reviewFixture();
  denied({...input,persistedOwnerDecision:{...input.persistedOwnerDecision,...patch}});
 }
});
test('missing or unsigned attestor and consumed one-use receipt are denied',()=>{
 for(const patch of [
  {approvalEvidenceRecorded:false},{authorizationGranted:true},
 ]){
  const {input}=reviewFixture();
  denied({...input,attestorEvidence:{...input.attestorEvidence,...patch}});
 }
 for(const patch of [
  {receiptId:randomUUID(),evidenceConsumed:false},
  {linkId:randomUUID()},{evidenceConsumed:false},
  {authorizationGranted:true},{dispatchPermitted:true},
 ]){
  const {input}=reviewFixture();
  denied({...input,consumedReceipt:{...input.consumedReceipt,...patch}});
 }
});
test('non-dispatch fence must stay exactly receipt, command, lease epoch 1',()=>{
 for(const patch of [
  {receiptId:randomUUID()},{commandId:randomUUID()},
  {leaseEpoch:2},{issuerLeaseGranted:true},
  {dispatchPermitted:true},{coreLedgerWritten:true},
  {operatorApprovalGranted:true},{readOnly:true}
 ]){
  const {input}=reviewFixture();
  denied({...input,evidenceFence:{...input.evidenceFence,...patch}});
 }
});
test('tampered original Ed25519 approval/Hub/Core proofs refuse source candidate',()=>{
 for(const field of ['approval','hub','core']){
  const {input}=reviewFixture(),p=structuredClone(input.proof);
  if(field==='approval')p.approval.signatureBase64url='A'.repeat(86);
  if(field==='hub')p.operatorLink.hubSignatureBase64url='A'.repeat(86);
  if(field==='core')p.operatorLink.coreSignatureBase64url='A'.repeat(86);
  denied({...input,proof:p});
 }
});
test('changed Core identity, PIC and worker binding refuse candidate',()=>{
 for(const fault of ['core','pic','worker']){
  const {input}=reviewFixture(),facts=structuredClone(input.trustedFacts);
  if(fault==='core')facts.core.operatorUserId=999;
  if(fault==='pic')facts.prepared.memberId=999;
  if(fault==='worker')facts.core.workerId='wrong-worker';
  denied({...input,trustedFacts:facts});
 }
});
test('original signed claims must not include fourth issuer key/extra fields',()=>{
 const {input}=reviewFixture(),p=structuredClone(input.proof);
 p.issuerEvidence={claims:{},signatureBase64url:'f'.repeat(86)};
 denied({...input,proof:p});
});
test('expired preparation or original link denies candidate',()=>{
 for(const field of ['prepared','link']){
  const {input}=reviewFixture();
  if(field==='prepared'){
   const facts=structuredClone(input.trustedFacts);
   facts.prepared.expiresAt=input.now-1;
   denied({...input,trustedFacts:facts});
  } else {
   const p=structuredClone(input.proof);
   p.operatorLink.claims.expiresAt=input.now-1;
   denied({...input,proof:p});
  }
 }
});
test('production env and missing prerequisites fail closed with no authority',()=>{
 const {input}=reviewFixture();
 denied({...input,env:{NODE_ENV:'production',APP_ENV:'production'}});
 denied({...input,consumedReceipt:null});
 denied({...input,trustedPublicKeys:null});
});
test('source-only contract cannot create credentials, route, signin, dispatch or key material',()=>{
 const source=readFileSync(new URL('../../artifacts/api-server/src/lib/gpt02-preissuer-bootstrap-review.mjs',import.meta.url),'utf8');
 for(const banned of [/\.sign\(/,/CREATE ROLE/,/ALTER ROLE/,/router\.post\(/,/\.connect\(/,/process\.env\./,/privateKey/])
  assert.equal(banned.test(source),false,String(banned));
});
