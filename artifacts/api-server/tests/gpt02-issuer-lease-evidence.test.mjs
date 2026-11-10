import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,generateKeyPairSync,sign,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {canonicalIssuerLeaseEvidence,inspectIssuerLeaseEvidence as inspect} from '../src/lib/gpt02-issuer-lease-evidence.mjs';
import {canonicalApproval} from '../src/lib/gpt02-issuer-store.mjs';
import {canonicalOperatorLink,operatorLinkSigningBytes} from '../src/lib/gpt02-operator-link.mjs';

const now=Date.now();
const keys=Object.fromEntries(['approval','hub','core','issuer'].map(n=>[n,generateKeyPairSync('ed25519')]));
const pub=n=>keys[n].publicKey.export({type:'spki',format:'pem'}).toString();
const publicKeys={approvalPublicKeyPem:pub('approval'),hubPublicKeyPem:pub('hub'),corePublicKeyPem:pub('core')};
const signLease=claims=>sign(null,Buffer.from('GPT02_ISSUER_LEASE_EVIDENCE_V1\n'+canonicalIssuerLeaseEvidence(claims)),keys.issuer.privateKey).toString('base64url');
const digest=x=>createHash('sha256').update(x).digest('hex');

function fixture(taskId=137){
 const ids={coreTaskId:randomUUID(),hubExecutionId:randomUUID(),commandCandidateId:randomUUID(),attemptId:randomUUID()};
 const prepared={companyId:'default',hubTaskId:taskId,memberId:5,memberAuditId:4567,operatorSubject:'google_fixture_operator',
  ...ids,expiresAt:now+90000};
 const job={companyId:'default',taskId,executionId:ids.hubExecutionId,status:'prepared',commandId:null,
  workerCommandCount:0,attemptNumber:1,dispatchStarted:false,memberId:5,memberAuditId:4567,operatorSubject:prepared.operatorSubject};
 const core={taskId:ids.coreTaskId,commandCandidateId:ids.commandCandidateId,attemptId:ids.attemptId,
  status:'PENDING',commandCount:0,runCount:0,workerId:'openclaw-dell-chatgpt-wake-dev',operatorUserId:77,
  operatorRole:'admin',operatorActive:true,passwordChanged:true};
 const hubOperator={subject:prepared.operatorSubject,role:'super_admin',active:true,memberId:5,accountableOwnerId:'fixture_owner'};
 const a={v:2,environment:'DEV',audience:'GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL',
  taskId,commandId:ids.commandCandidateId,attemptId:ids.attemptId,nonce:randomBytes(32).toString('base64url'),
  operatorNamespace:'ai-task-hub.public.users',superAdminId:prepared.operatorSubject,companyId:'default',
  issuedAt:now-20000,expiresAt:now+60000};
 const approvalDigest=digest(canonicalApproval(a));
 const l={v:1,environment:'DEV',audience:'GPT02_DUAL_ACCOUNT_COMMAND_LINK',
  linkId:randomUUID(),companyId:'default',hubTaskId:taskId,hubExecutionId:ids.hubExecutionId,
  coreTaskId:ids.coreTaskId,coreCommandId:a.commandId,attemptId:a.attemptId,attemptNumber:1,
  assigneeId:5,accountableOwnerId:'fixture_owner',hubOperatorNamespace:'ai-task-hub.public.users',
  hubOperatorId:prepared.operatorSubject,hubRole:'super_admin',hubActive:true,
  coreOperatorNamespace:'ai-core.ai_platform.internal_users',coreOperatorUserId:77,coreRole:'admin',
  coreActive:true,corePasswordChanged:true,workerId:core.workerId,approvalDigest,
  nonce:a.nonce,issuedAt:now-15000,expiresAt:now+45000};
 const proof={approval:{claims:a,signatureBase64url:sign(null,Buffer.from(canonicalApproval(a)),keys.approval.privateKey).toString('base64url')},
  operatorLink:{claims:l,
   hubSignatureBase64url:sign(null,operatorLinkSigningBytes(l,'hub'),keys.hub.privateKey).toString('base64url'),
   coreSignatureBase64url:sign(null,operatorLinkSigningBytes(l,'core'),keys.core.privateKey).toString('base64url')}};
 const receiptId=randomUUID(),fenceId=randomUUID(),linkDigest=digest(canonicalOperatorLink(l));
 const nonceReceipt={receiptId,commandId:a.commandId,nonce:a.nonce,digest:approvalDigest,consumedAt:now-3000};
 const identityReceipt={receiptId,commandId:a.commandId,linkId:l.linkId,operatorUserId:77,
  hubOperatorId:prepared.operatorSubject,linkDigest,bindingVerified:false,
  mayDispatchWorker:false,mayIssueGrant:false,mayCloseJob:false,coreLedgerWritten:false};
 const fence={fenceId,receiptId,commandId:a.commandId,linkId:l.linkId,
  hubExecutionId:ids.hubExecutionId,coreTaskId:ids.coreTaskId,attemptId:ids.attemptId,
  workerId:core.workerId,leaseEpoch:1,leaseStartedAt:now-2000,leaseExpiresAt:now+10000,
  dispatchAllowed:false,coreLedgerWritten:false};
 const claims={v:1,environment:'DEV',audience:'GPT02_ISSUER_LEASE_EVIDENCE_V1',
  companyId:'default',hubTaskId:taskId,hubExecutionId:ids.hubExecutionId,
  coreTaskId:ids.coreTaskId,commandId:a.commandId,attemptId:a.attemptId,workerId:core.workerId,
  receiptId,linkId:l.linkId,fenceId,approvalDigest,nonceDigest:digest(a.nonce),
  issuerRole:'dev_gpt02_issuer_evidence',leaseEpoch:1,issuedAt:now-1900,expiresAt:now+8000};
 const lease={claims,signatureBase64url:signLease(claims)};
 return {prepared,job,core,hubOperator,proof,publicKeys,nonceReceipt,identityReceipt,fence,lease,
  issuerPublicKeyPem:pub('issuer'),now};
}
function patchLease(x,changes){
 const claims={...x.lease.claims,...changes};
 return {...x,lease:{claims,signatureBase64url:signLease(claims)}};
}
test('valid independently signed 4-origin synthetic evidence remains NO-GO without an actual grant',()=>{
 const v=inspect(fixture());
 assert.equal(v.matched,true);assert.equal(v.signatureVerified,true);
 assert.equal(v.nonceEvidenceMatched,true);assert.equal(v.issuerLeaseEvidenceVerified,true);
 for(const k of ['leaseGranted','issuerPermitted','dispatchPermitted','commandCreated'])assert.equal(v[k],false,k);
 assert.equal(v.releaseDecision,'NO_GO');assert.equal(v.readOnly,true);
});
test('fresh dual-signatures cannot recycle Task135 or Task136',()=>{
 for(const taskId of [135,136]){const x=inspect(fixture(taskId));assert.equal(x.matched,false);assert.equal(x.dispatchPermitted,false);}
});
for(const [field,mutate] of [
 ['companyId',()=> 'other'],['hubTaskId',()=>138],
 ['hubExecutionId',()=>randomUUID()],['coreTaskId',()=>randomUUID()],
 ['commandId',()=>randomUUID()],['attemptId',()=>randomUUID()],
 ['workerId',()=> 'another-worker'],['receiptId',()=>randomUUID()],
 ['linkId',()=>randomUUID()],['fenceId',()=>randomUUID()],
 ['approvalDigest',()=> 'a'.repeat(64)],['nonceDigest',()=> 'b'.repeat(64)],
 ['issuerRole',()=> 'postgres'],['leaseEpoch',()=>2],
 ['issuedAt',()=> now+5000],['expiresAt',()=>now-10]
])test('reject independently re-signed issuer evidence with mismatched '+field,()=>{
 const x=fixture();const out=inspect(patchLease(x,{[field]:mutate()}));
 assert.equal(out.matched,false);assert.equal(out.dispatchPermitted,false);
});
for(const [part,changes] of [
 ['nonceReceipt',{receiptId:randomUUID()}],['nonceReceipt',{nonce:'different'}],
 ['nonceReceipt',{consumedAt:now+999}],['nonceReceipt',{digest:'f'.repeat(64)}],
 ['identityReceipt',{operatorUserId:55}],['identityReceipt',{linkId:randomUUID()}],
 ['identityReceipt',{bindingVerified:true}],['identityReceipt',{mayDispatchWorker:true}],
 ['identityReceipt',{coreLedgerWritten:true}],['fence',{commandId:randomUUID()}],
 ['fence',{leaseEpoch:2}],['fence',{leaseExpiresAt:now-1}],
 ['fence',{leaseExpiresAt:now+17000}],['fence',{dispatchAllowed:true}],
 ['fence',{coreLedgerWritten:true}],['fence',{workerId:'unknown'}]
])test('deny modified independent DB readback '+part+' '+Object.keys(changes)[0],()=>{
 const x=fixture();x[part]={...x[part],...changes};
 const out=inspect(x);assert.equal(out.matched,false);assert.equal(out.dispatchPermitted,false);
});
test('forged issuer signature and request-supplied issuer key are rejected',()=>{
 const x=fixture(),other=generateKeyPairSync('ed25519');
 const bad={...x,lease:{...x.lease,signatureBase64url:
  sign(null,Buffer.from('GPT02_ISSUER_LEASE_EVIDENCE_V1\n'+canonicalIssuerLeaseEvidence(x.lease.claims)),other.privateKey).toString('base64url')}};
 assert.equal(inspect(bad).matched,false);
 assert.equal(inspect({...x,lease:{...x.lease,issuerPublicKeyPem:pub('issuer')}}).matched,false);
});
test('issuer signing key must be distinct from the three already pinned signer keys',()=>{
 const x=fixture();assert.equal(inspect({...x,issuerPublicKeyPem:pub('hub')}).matched,false);
 assert.equal(inspect({...x,issuerPublicKeyPem:pub('approval')}).matched,false);
});
test('altered original signed link, revoked operator or historical task cannot be rescued by issuer signature',()=>{
 const x=fixture();
 for(const patch of [{core:{...x.core,operatorActive:false}},{hubOperator:{...x.hubOperator,active:false}},
 {proof:{...x.proof,operatorLink:{...x.proof.operatorLink,coreSignatureBase64url:'A'.repeat(86)}}}]){
  const out=inspect({...x,...patch});assert.equal(out.matched,false);assert.equal(out.dispatchPermitted,false);
 }
});
test('an evidence match cannot mint authority even under repeated or concurrent invocation',async()=>{
 const x=fixture();const rs=await Promise.all(Array.from({length:8},async()=>inspect(x)));
 assert.equal(rs.length,8);
 for(const r of rs){assert.equal(r.releaseDecision,'NO_GO');assert.equal(r.leaseGranted,false);assert.equal(r.dispatchPermitted,false);}
});
test('no SQL, network, or dispatch access is imported from issuer evidence verifier',()=>{
 const s=readFileSync(new URL('../src/lib/gpt02-issuer-lease-evidence.mjs',import.meta.url),'utf8');
 for(const bad of ['new Pool','db.query','fetch(','INSERT INTO','UPDATE ','DELETE FROM','submitAiTask','sendCommand','allowDispatch:true'])
  assert.equal(s.includes(bad),false,bad);
 assert.match(s,/issuerLeaseEvidenceVerified:true/);
 assert.match(s,/dispatchPermitted:false/);
});
