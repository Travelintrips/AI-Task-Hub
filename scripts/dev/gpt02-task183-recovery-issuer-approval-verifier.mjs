/**
 * Task183 recovery issuer-approval signature verifier, DEV offline contract.
 * The existing Issue159 operational signer does not support this domain.
 * No keys are generated or loaded; only independently pinned public keys.
 * A verified signature is NOT a persisted approval/issuer lease.
 */
import {createHash,createPublicKey,timingSafeEqual,verify} from 'node:crypto';
const DOMAIN='GPT02_TASK183_RECOVERY_ISSUER_APPROVAL_V1\n';
const KEYS=Object.freeze(['version','environment','audience','companyId','hubTaskId',
  'recoveryAttemptNumber','requestId','evidenceSha256','originalCoreTaskId',
  'originalHubExecutionId','originalAttemptId','ownerSubject','nonce',
  'issuedAt','expiresAt','purpose','dispatchPermitted']);
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const SHA=/^[0-9a-f]{64}$/;
const NONCE=/^[A-Za-z0-9_-]{32,128}$/;
const failure=reason=>Object.freeze({verified:false,reason,
  ownerApprovalPersisted:false,issuerAuthorized:false,
  attemptIssued:false,dispatchPermitted:false});
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  Object.getPrototypeOf(x)===Object.prototype;
export const RECOVERY_ISSUER_APPROVAL_DOMAIN=DOMAIN.trim();
export function canonicalIssuerRecoveryApproval(claims){
 if(!object(claims)||Object.keys(claims).sort().join(',')!==[...KEYS].sort().join(','))
   throw Error('RECOVERY_APPROVAL_CLAIM_SHAPE_DENIED');
 return DOMAIN+JSON.stringify(Object.fromEntries(KEYS.map(k=>[k,claims[k]])));
}
export function verifyIssuerRecoveryApproval({
 claims,signatureBase64url,pinnedOwnerPublicKey,pinnedOwnerSpkiSha256,
 trustedFacts,now=Date.now()
}={}){
 try{
  if(!object(trustedFacts)||Object.keys(trustedFacts).sort().join(',')!==
    ['requestId','evidenceSha256','coreTaskId','hubExecutionId','attemptId',
     'ownerSubject','superAdminIntentRecorded','nonceAlreadyConsumed']
       .sort().join(','))return failure('INDEPENDENT_TRUSTED_FACTS_REQUIRED');
  const bytes=Buffer.from(canonicalIssuerRecoveryApproval(claims),'utf8');
  if(claims.version!==1||claims.environment!=='DEV'||
     claims.audience!==RECOVERY_ISSUER_APPROVAL_DOMAIN||
     claims.companyId!=='default'||claims.hubTaskId!==183||
     claims.recoveryAttemptNumber!==2||
     claims.purpose!=='PREPARE_ATTEMPT2_ONLY'||
     claims.dispatchPermitted!==false||
     !UUID.test(claims.originalCoreTaskId)||
     !UUID.test(claims.originalHubExecutionId)||
     !UUID.test(claims.originalAttemptId)||
     !SHA.test(claims.evidenceSha256)||
     !NONCE.test(claims.nonce)||
     typeof claims.requestId!=='string'||
     !/^[0-9a-f]{36}$/.test(claims.requestId)||
     typeof claims.ownerSubject!=='string'||
     !/^owner:[A-Za-z0-9_-]{4,120}$/.test(claims.ownerSubject))
     return failure('STRICT_ATTEMPT2_CLAIMS_DENIED');
  if(trustedFacts.requestId!==claims.requestId||
    trustedFacts.evidenceSha256!==claims.evidenceSha256||
    trustedFacts.coreTaskId!==claims.originalCoreTaskId||
    trustedFacts.hubExecutionId!==claims.originalHubExecutionId||
    trustedFacts.attemptId!==claims.originalAttemptId||
    trustedFacts.ownerSubject!==claims.ownerSubject||
    trustedFacts.superAdminIntentRecorded!==true||
    trustedFacts.nonceAlreadyConsumed!==false)
     return failure('TRUSTED_ORIGINAL_OR_NONCE_FENCE_MISMATCH');
  if(!Number.isSafeInteger(now)||!Number.isSafeInteger(claims.issuedAt)||
     !Number.isSafeInteger(claims.expiresAt)||
     claims.issuedAt>now+5000||claims.issuedAt<now-300000||
     claims.expiresAt<=now||claims.expiresAt<=claims.issuedAt||
     claims.expiresAt-claims.issuedAt>300000)
     return failure('APPROVAL_WINDOW_EXPIRED_OR_INVALID');
  if(typeof pinnedOwnerSpkiSha256!=='string'||!SHA.test(pinnedOwnerSpkiSha256)||
     typeof signatureBase64url!=='string'||
     !/^[A-Za-z0-9_-]{86}$/.test(signatureBase64url))
     return failure('INDEPENDENT_PUBLIC_TRUST_OR_SIGNATURE_REQUIRED');
  const key=pinnedOwnerPublicKey?.type==='public'?pinnedOwnerPublicKey:
    createPublicKey(pinnedOwnerPublicKey);
  if(key.type!=='public'||key.asymmetricKeyType!=='ed25519')
     return failure('WRONG_SIGNER_ALGORITHM');
  const actual=createHash('sha256').update(key.export({format:'der',type:'spki'})).digest();
  if(!timingSafeEqual(actual,Buffer.from(pinnedOwnerSpkiSha256,'hex')))
     return failure('PINNED_OWNER_PUBLIC_ROOT_MISMATCH');
  const sig=Buffer.from(signatureBase64url,'base64url');
  if(sig.length!==64||sig.toString('base64url')!==signatureBase64url||
     !verify(null,bytes,key,sig))
     return failure('SIGNATURE_NOT_VALID');
  return Object.freeze({verified:true,reason:'CRYPTOGRAPHICALLY_VALID_NOT_PERSISTED',
    approvalDigest:createHash('sha256').update(bytes).digest('hex'),
    originalAttemptId:claims.originalAttemptId,
    ownerApprovalPersisted:false,issuerAuthorized:false,
    nonceIssuerConsumed:false,attemptIssued:false,dispatchPermitted:false});
 }catch{
  return failure('INDEPENDENT_RECOVERY_VERIFIER_UNAVAILABLE');
 }
}
