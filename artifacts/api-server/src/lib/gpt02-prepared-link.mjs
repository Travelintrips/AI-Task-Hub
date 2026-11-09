/**
 * Pure DEV preview: require independently signed approval & Hub/Core link to
 * match immutable server-side task preparation and pre-dispatch job records.
 * NOT mounted by HTTP/worker, NOT a signer, nonce writer or grant issuer.
 */
import { createHash, createPublicKey, verify } from 'node:crypto';
import { canonicalApproval } from './gpt02-issuer-store.mjs';
import { createOperatorLinkVerifier } from './gpt02-operator-link.mjs';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const DIGEST=/^[a-f0-9]{64}$/;
const SUBJECT=/^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$/;
const isObject=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const fail=reason=>Object.freeze({matched:false,reason,signatureVerified:false,
  dualOriginVerified:false,approvalRecorded:false,nonceConsumed:false,
  issuerPermitted:false,dispatchPermitted:false,completionPermitted:false,
  readOnly:true});
/** `prepared`, `job`, `core` and `hubOperator` MUST originate in distinct trusted DB reads. */
export function inspectPreparedSignedLink({prepared,job,core,hubOperator,proof,publicKeys,now=Date.now()}={}) {
 try {
  if(![prepared,job,core,hubOperator,proof,publicKeys].every(isObject)||
     !Number.isSafeInteger(now)||now<0)return fail('INCOMPLETE_EVIDENCE');
  const ap=proof.approval,link=proof.operatorLink;
  if(!isObject(ap)||!isObject(link)||!isObject(ap.claims)||!isObject(link.claims))return fail('PROOF_NOT_PRESENT');
  if(Object.keys(ap).sort().join(',')!=='claims,signatureBase64url'||
    Object.keys(link).sort().join(',')!=='claims,coreSignatureBase64url,hubSignatureBase64url'||
    Object.keys(publicKeys).sort().join(',')!=='approvalPublicKeyPem,corePublicKeyPem,hubPublicKeyPem')
    return fail('UNEXPECTED_SIGNED_PROOF_FIELDS');
  const a=ap.claims,l=link.claims;
  if(prepared.companyId!=='default'||!Number.isSafeInteger(prepared.hubTaskId)||prepared.hubTaskId<=136||
     !Number.isSafeInteger(prepared.memberId)||prepared.memberId<=0||
     !Number.isSafeInteger(prepared.memberAuditId)||prepared.memberAuditId<=0||
     !SUBJECT.test(prepared.operatorSubject)||
     ![prepared.coreTaskId,prepared.commandCandidateId,prepared.attemptId].every(x=>typeof x==='string'&&UUID.test(x))||
     new Set([prepared.coreTaskId,prepared.commandCandidateId,prepared.attemptId]).size!==3||
     typeof prepared.expiresAt!=='number'||prepared.expiresAt<=now||
     prepared.expiresAt-now>900000)return fail('UNTRUSTED_CORE_RESERVATION');
  if(job.companyId!==prepared.companyId||job.taskId!==prepared.hubTaskId||
     !UUID.test(job.executionId)||job.status!=='prepared'||job.commandId!==null||
     job.workerCommandCount!==0||job.attemptNumber!==1||job.dispatchStarted!==false||
     job.memberId!==prepared.memberId||job.memberAuditId!==prepared.memberAuditId||
     job.operatorSubject!==prepared.operatorSubject)return fail('HUB_PRE_DISPATCH_JOB_NOT_PROVEN');
  if(core.taskId!==prepared.coreTaskId||core.commandCandidateId!==prepared.commandCandidateId||
     core.attemptId!==prepared.attemptId||core.status!=='PENDING'||core.commandCount!==0||
     core.runCount!==0||core.workerId!=='openclaw-dell-chatgpt-wake-dev'||
     !Number.isSafeInteger(core.operatorUserId)||core.operatorUserId<=0||core.operatorUserId>2147483647||
     !['owner','admin'].includes(core.operatorRole)||core.operatorActive!==true||core.passwordChanged!==true)
    return fail('CORE_CODING_TASK_NOT_PREPARED');
  if(hubOperator.subject!==prepared.operatorSubject||hubOperator.role!=='super_admin'||
     hubOperator.active!==true||hubOperator.memberId!==prepared.memberId||
     !SUBJECT.test(hubOperator.accountableOwnerId))return fail('HUB_SUPER_ADMIN_NOT_BOUND');
  if(a.taskId!==prepared.hubTaskId||a.companyId!==prepared.companyId||
     a.superAdminId!==prepared.operatorSubject||a.commandId!==prepared.commandCandidateId||
     a.attemptId!==prepared.attemptId||
     l.hubTaskId!==prepared.hubTaskId||l.companyId!==prepared.companyId||
     l.hubExecutionId!==job.executionId||l.coreTaskId!==prepared.coreTaskId||
     l.coreCommandId!==prepared.commandCandidateId||l.attemptId!==prepared.attemptId||
     l.assigneeId!==prepared.memberId||l.accountableOwnerId!==hubOperator.accountableOwnerId||
     l.hubOperatorId!==prepared.operatorSubject||
     l.coreOperatorUserId!==core.operatorUserId||l.coreRole!==core.operatorRole||
     l.workerId!==core.workerId||l.nonce!==a.nonce||l.expiresAt>prepared.expiresAt||
     a.expiresAt>prepared.expiresAt)return fail('PREPARED_SIGNATURE_BINDING_MISMATCH');
  if(typeof ap.signatureBase64url!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(ap.signatureBase64url))
    return fail('APPROVAL_SIGNATURE_NOT_VERIFIED');
  let approvalKey;
  try{approvalKey=createPublicKey(publicKeys.approvalPublicKeyPem);}catch{return fail('PINNED_APPROVAL_KEY_REQUIRED')}
  if(approvalKey.asymmetricKeyType!=='ed25519')return fail('ED25519_APPROVAL_REQUIRED');
  // Approval, Hub identity and Core identity must be independently signed.
  // Merely possessing one server signing key cannot impersonate all origins.
  let hubKey,coreKey;
  try{hubKey=createPublicKey(publicKeys.hubPublicKeyPem);coreKey=createPublicKey(publicKeys.corePublicKeyPem)}
  catch{return fail('PINNED_OPERATOR_KEYS_REQUIRED')}
  if(hubKey.asymmetricKeyType!=='ed25519'||coreKey.asymmetricKeyType!=='ed25519'||
    new Set([approvalKey,hubKey,coreKey].map(k=>k.export({format:'der',type:'spki'}).toString('hex'))).size!==3)
    return fail('THREE_INDEPENDENT_SIGNATURE_KEYS_REQUIRED');
  const canonical=canonicalApproval(a),sig=Buffer.from(ap.signatureBase64url,'base64url');
  if(sig.length!==64||sig.toString('base64url')!==ap.signatureBase64url||
     !verify(null,Buffer.from(canonical),approvalKey,sig))return fail('APPROVAL_SIGNATURE_NOT_VERIFIED');
  const digest=createHash('sha256').update(canonical).digest('hex');
  if(!DIGEST.test(digest))return fail('APPROVAL_DIGEST_INVALID');
  const verifyLink=createOperatorLinkVerifier({hubPublicKeyPem:publicKeys.hubPublicKeyPem,
    corePublicKeyPem:publicKeys.corePublicKeyPem});
  const verified=verifyLink(link,a,digest,now);
  if(!verified||verified.coreOperatorUserId!==core.operatorUserId||
     verified.hubOperatorId!==prepared.operatorSubject)return fail('INDEPENDENT_OPERATOR_LINK_NOT_VERIFIED');
  // Even a fully matched preview cannot claim the approval was recorded,
  // its nonce consumed, or a lease granted. There is no record/dispatch path.
  return Object.freeze({matched:true,reason:'MATCHED_NOT_RECORDED',signatureVerified:true,
    dualOriginVerified:true,approvalRecorded:false,nonceConsumed:false,
    issuerPermitted:false,dispatchPermitted:false,completionPermitted:false,
    readOnly:true,
    identifiers:Object.freeze({hubTaskId:prepared.hubTaskId,coreTaskId:prepared.coreTaskId,
      executionId:job.executionId,commandCandidateId:prepared.commandCandidateId,
      attemptId:prepared.attemptId,memberId:prepared.memberId}),
    approvalDigest:digest,operatorLinkDigest:verified.digest});
 }catch{return fail('SIGNED_BINDING_INVALID_OR_EXPIRED')}
}
