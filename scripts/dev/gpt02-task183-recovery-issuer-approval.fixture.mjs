/** Synthetic-only Ed25519 receipt proof for the isolated attempt2 transaction.
 * Generates an ephemeral TEST keypair and never accesses VPS signer custody.
 * Its output is not trusted as an operational Owner approval.
 */
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {canonicalIssuerRecoveryApproval,verifyIssuerRecoveryApproval,
 RECOVERY_ISSUER_APPROVAL_DOMAIN} from './gpt02-task183-recovery-issuer-approval-verifier.mjs';
const now=Date.now();
const facts={
 requestId:'6bcd8419254dc21c0b149eb09e68a7b6da66',
 evidenceSha256:'0'.repeat(63)+'1',
 coreTaskId:'22222222-2222-4222-8222-222222222222',
 hubExecutionId:'33333333-3333-4333-8333-333333333333',
 attemptId:'11111111-1111-4111-8111-111111111111',
 ownerSubject:'owner:synthetic-fixture',
 superAdminIntentRecorded:true,nonceAlreadyConsumed:false,
};
const claims={
 version:1,environment:'DEV',audience:RECOVERY_ISSUER_APPROVAL_DOMAIN,
 companyId:'default',hubTaskId:183,recoveryAttemptNumber:2,
 requestId:facts.requestId,evidenceSha256:facts.evidenceSha256,
 originalCoreTaskId:facts.coreTaskId,originalHubExecutionId:facts.hubExecutionId,
 originalAttemptId:facts.attemptId,ownerSubject:facts.ownerSubject,
 nonce:'fixture-only-issuer-nonce-000000000000000000',
 issuedAt:now-15000,expiresAt:now+120000,
 purpose:'PREPARE_ATTEMPT2_ONLY',dispatchPermitted:false
};
const kp=generateKeyPairSync('ed25519');
const fp=createHash('sha256').update(kp.publicKey.export({format:'der',type:'spki'})).digest('hex');
const sig=sign(null,Buffer.from(canonicalIssuerRecoveryApproval(claims)),kp.privateKey).toString('base64url');
const v=verifyIssuerRecoveryApproval({claims,signatureBase64url:sig,
 pinnedOwnerPublicKey:kp.publicKey,pinnedOwnerSpkiSha256:fp,
 trustedFacts:facts,now});
if(!v.verified||v.issuerAuthorized!==false||v.ownerApprovalPersisted!==false||
   v.dispatchPermitted!==false||v.approvalDigest?.length!==64)
 throw Error('ISOLATED_CRYPTOGRAPHIC_VERIFIER_DID_NOT_PASS');
console.log(JSON.stringify({
 verifiedFixture:true,approvalDigest:v.approvalDigest,
 signerFingerprint:fp,receiptPurpose:'ATTEMPT2_PREPARE_ONLY',
 signerDomain:RECOVERY_ISSUER_APPROVAL_DOMAIN,
 realOwnerApproved:false,issuerAuthorized:false
}));
