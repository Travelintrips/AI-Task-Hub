/**
 * CST-DEV PR207: review-only three-domain pre-issuer bootstrap handoff.
 *
 * Reuses the ORIGINAL PR196 Google and three-signature Hub/Core link verifier,
 * and the ORIGINAL attestor, issuer consume and non-dispatch fence result shapes.
 * This candidate does NOT sign, open a database, read credentials, create a
 * task/role, issue a lease, or authorize worker/issuer/dispatch.
 *
 * Why separate this stage: the existing Core AI post-lineage scoped reader
 * needs FOUR signatures, but its fourth issuer signer requires an issuer-reader
 * socket. A four-signature-only bootstrap is a dependency cycle. This module
 * describes the preceding three-signed evidence; a separately reviewed,
 * independently authenticated task-scoped DB custody broker is STILL REQUIRED.
 */
import {createHash} from 'node:crypto';
import {hasRecentVerifiedGpt02DevGoogleOperator} from './gpt02-google-auth-gate.mjs';
import {inspectPreparedSignedLink} from './gpt02-prepared-link.mjs';
import {canonicalApproval} from './gpt02-issuer-store.mjs';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const exact=(o,keys)=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&
 Object.keys(o).sort().join(',')===[...keys].sort().join(',');
const deny=reason=>Object.freeze({
 reviewed:false,reason,readOnly:true,threeSignaturesReviewed:false,
 databaseTaskIsolationProven:false,credentialIssuancePermitted:false,
 replayProtectionProven:false,authorizationGranted:false,
 signingPermitted:false,issuerLeaseGranted:false,dispatchPermitted:false,
 commandCreated:false,releaseDecision:'NO_GO'
});
const CONSENT=['kind','approved','companyId','taskId','commandId',
 'attemptId','nonce','operatorSubject'];
const OWNER=['verified','reason','digest','releaseDecision',
 'authorizationGranted','signingPermitted','issuerLeaseGranted','dispatchPermitted'];
const ATTESTOR=['approvalEvidenceRecorded','dualIdentityEvidenceRecorded',
 'authorizationGranted','dispatchPermitted'];
const RECEIPT=['receiptId','linkId','coreOperatorUserId','recordedBy',
 'evidenceConsumed','coreLedgerWritten','authorizationGranted','dispatchPermitted'];
const FENCE=['fenceId','receiptId','commandId','leaseEpoch','evidenceFenceReserved',
 'issuerLeaseGranted','coreLedgerWritten','operatorApprovalGranted',
 'dispatchPermitted','readOnly'];
const WORKER='openclaw-dell-chatgpt-wake-dev';

export function reviewGpt02ThreeSignedPreissuerCandidate({
 env,now,session,consent,proof,trustedFacts,trustedPublicKeys,
 persistedOwnerDecision,attestorEvidence,consumedReceipt,evidenceFence,
}={}){
 try {
  if(env?.NODE_ENV!=='development'||env?.APP_ENV!=='development'||
    !Number.isSafeInteger(now)||
    !hasRecentVerifiedGpt02DevGoogleOperator(session,env,now))
   return deny('FRESH_DEV_OWNER_SESSION_REQUIRED');
  if(!exact(consent,CONSENT)||consent.kind!=='GPT02_DEV_SINGLE_COMMAND_CONSENT_V1'||
    consent.approved!==true||consent.companyId!=='default'||
    !Number.isSafeInteger(consent.taskId)||consent.taskId<=171||
    !uuid.test(consent.commandId)||!uuid.test(consent.attemptId)||
    consent.commandId===consent.attemptId||
    typeof consent.nonce!=='string'||!/^[A-Za-z0-9_-]{32,128}$/.test(consent.nonce)||
    consent.operatorSubject!==String(session.id))
   return deny('EXACT_NEW_COMMAND_CONSENT_REQUIRED');

  // The existing Issue159 one-use Owner decision must be checked by its
  // server-owned persisted-intent gate, not by browser/JWT role flags.
  // This is still only a structural review of that upstream verdict.
  if(!exact(persistedOwnerDecision,OWNER)||
    persistedOwnerDecision.verified!==true||
    persistedOwnerDecision.reason!=='ISSUE159_PERSISTED_DECISION_VERIFIED_ONLY'||
    persistedOwnerDecision.releaseDecision!=='NO_GO'||
    ['authorizationGranted','signingPermitted','issuerLeaseGranted',
     'dispatchPermitted'].some(k=>persistedOwnerDecision[k]!==false))
   return deny('ORIGINAL_PERSISTED_OWNER_DECISION_REQUIRED');

  if(!exact(attestorEvidence,ATTESTOR)||
    attestorEvidence.approvalEvidenceRecorded!==true||
    attestorEvidence.dualIdentityEvidenceRecorded!==true||
    attestorEvidence.authorizationGranted!==false||
    attestorEvidence.dispatchPermitted!==false)
   return deny('ORIGINAL_ATTESTOR_EVIDENCE_REQUIRED');
  if(!exact(consumedReceipt,RECEIPT)||
    !uuid.test(consumedReceipt.receiptId)||!uuid.test(consumedReceipt.linkId)||
    consumedReceipt.evidenceConsumed!==true||
    consumedReceipt.coreLedgerWritten!==false||
    consumedReceipt.authorizationGranted!==false||
    consumedReceipt.dispatchPermitted!==false)
   return deny('ONE_NONAUTHORIZING_ISSUER_RECEIPT_REQUIRED');
  if(!exact(evidenceFence,FENCE)||
    !uuid.test(evidenceFence.fenceId)||
    evidenceFence.evidenceFenceReserved!==true||
    evidenceFence.leaseEpoch!==1||
    evidenceFence.issuerLeaseGranted!==false||
    evidenceFence.coreLedgerWritten!==false||
    evidenceFence.operatorApprovalGranted!==false||
    evidenceFence.dispatchPermitted!==false||
    evidenceFence.readOnly!==false)
   return deny('ORIGINAL_NONDISPATCH_FENCE_REQUIRED');

  if(!trustedFacts||!trustedPublicKeys||!proof||
    !exact(proof,['approval','operatorLink'])||
    !exact(proof.approval,['claims','signatureBase64url'])||
    !exact(proof.operatorLink,['claims','hubSignatureBase64url','coreSignatureBase64url']))
   return deny('ORIGINAL_SIGNED_PROOF_REQUIRED');
  const {prepared,job,core,hubOperator}=trustedFacts;
  const a=proof.approval.claims,l=proof.operatorLink.claims;
  const ownerDigest=createHash('sha256').update(canonicalApproval(a),'utf8').digest('hex');
  if(!a||!l||persistedOwnerDecision.digest!==ownerDigest||
    l.approvalDigest!==ownerDigest||
    a.taskId!==consent.taskId||a.companyId!==consent.companyId||
    a.commandId!==consent.commandId||a.attemptId!==consent.attemptId||
    a.superAdminId!==consent.operatorSubject||a.nonce!==consent.nonce||
    l.hubTaskId!==a.taskId||l.coreCommandId!==a.commandId||
    l.attemptId!==a.attemptId||l.workerId!==WORKER||
    l.hubOperatorId!==String(session.id)||
    consumedReceipt.linkId!==l.linkId||
    consumedReceipt.coreOperatorUserId!==l.coreOperatorUserId||
    evidenceFence.receiptId!==consumedReceipt.receiptId||
    evidenceFence.commandId!==a.commandId||
    !(prepared?.expiresAt>now)||
    !(l.expiresAt>now+3500))
   return deny('POST_ATTESTOR_LINEAGE_MISMATCH');

  // No signature reconstruction or new trust root: PR196 validates three
  // ORIGINAL domain-separated Ed25519 proofs with server-owned public keys.
  const verdict=inspectPreparedSignedLink({
   prepared,job,core,hubOperator,proof,
   publicKeys:{
    approvalPublicKeyPem:trustedPublicKeys.approvalPublicKeyPem,
    hubPublicKeyPem:trustedPublicKeys.hubPublicKeyPem,
    corePublicKeyPem:trustedPublicKeys.corePublicKeyPem,
   },now
  });
  if(verdict?.matched!==true||verdict.signatureVerified!==true||
     verdict.dualOriginVerified!==true||verdict.dispatchPermitted!==false||
     verdict.identifiers?.hubTaskId!==consent.taskId||
     verdict.identifiers?.commandCandidateId!==consent.commandId||
     verdict.identifiers?.attemptId!==consent.attemptId)
   return deny('ORIGINAL_THREE_DOMAIN_VERIFICATION_FAILED');

  const expiresAt=Math.min(a.expiresAt,l.expiresAt,prepared.expiresAt);
  if(!Number.isSafeInteger(expiresAt)||expiresAt-now<3500||expiresAt-now>300000)
   return deny('BOUNDED_PREISSUER_WINDOW_REQUIRED');
  const scope=Object.freeze({
   environment:'DEV',companyId:'default',taskId:a.taskId,
   commandId:a.commandId,attemptId:a.attemptId,
   operatorSubject:a.superAdminId,approvalDigest:l.approvalDigest,
   linkId:l.linkId,receiptId:consumedReceipt.receiptId,
   fenceId:evidenceFence.fenceId,hubExecutionId:l.hubExecutionId,
   coreTaskId:l.coreTaskId,workerId:WORKER,expiresAt
  });
  const scopeSha256=createHash('sha256').update(
   'GPT02_THREE_SIGNED_PREISSUER_REVIEW_V1\n'+JSON.stringify(scope),'utf8'
  ).digest('hex');
  return Object.freeze({
   ...deny('THREE_SIGNED_PREISSUER_REVIEW_ONLY_NO_AUTHORITY'),
   reviewed:true,threeSignaturesReviewed:true,
   scope,scopeSha256
  });
 }catch{
  return deny('PREISSUER_TRUSTED_REVIEW_UNAVAILABLE');
 }
}
