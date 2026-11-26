/**
 * Inert verifier for a future Task183 expired-preparation recovery signature.
 * Does not load a signer, mint approval, consume a nonce, write records,
 * renew a reservation, create a task, dispatch a worker or grant authority.
 *
 * The Ed25519 verifier key AND its pinned SPKI fingerprint must be supplied
 * by independently trusted server configuration, NEVER by request JSON.
 */
import {createHash,createPublicKey,timingSafeEqual,verify} from 'node:crypto';

const fail=(reason)=>Object.freeze({verified:false,reason,approvalGranted:false,dispatchPermitted:false,canIssueAttempt:false});
const DOMAIN='GPT02_TASK183_EXPIRED_PREPARATION_RECOVERY_REVIEW_V1\n';
const fields=Object.freeze([
 'version','environment','audience','companyId','hubTaskId',
 'originalCoreTaskId','originalHubExecutionId','originalAttemptId',
 'originalReservationExpiresAt','recoveryAttemptNumber',
 'recoveryPurpose','ownerSubject','nonce','issuedAt','expiresAt'
]);
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{64}$/;
const b64=/^[A-Za-z0-9_-]{86}$/;
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const num=x=>Number.isSafeInteger(x)&&x>=0;
export const TASK183_RECOVERY_DOMAIN=DOMAIN.trim();

export function canonicalRecoveryReview(claims){
 if(!plain(claims)||Object.keys(claims).sort().join('|')!==[...fields].sort().join('|'))
  throw Error('RECOVERY_CLAIM_SHAPE_INVALID');
 return DOMAIN+JSON.stringify(Object.fromEntries(fields.map(k=>[k,claims[k]])));
}

export function verifyTask183RecoverySignature({
 claims,signature,serverPinnedPublicKey,serverPinnedSpkiSha256,
 expectedOriginal, expectedOwnerSubject, now=Date.now()
}={}){
 try{
  if(!plain(expectedOriginal)||!num(now)||
     typeof expectedOwnerSubject!=='string'||
     !/^owner:[A-Za-z0-9_-]{4,120}$/.test(expectedOwnerSubject))
   return fail('UNTRUSTED_SERVER_READBACK');
  const raw=canonicalRecoveryReview(claims);
  if(claims.version!==1||claims.environment!=='DEV'||
     claims.audience!=='GPT02_TASK183_EXPIRED_PREPARATION_RECOVERY_REVIEW_V1'||
     claims.companyId!=='default'||claims.hubTaskId!==183||
     claims.recoveryAttemptNumber!==2||
     claims.recoveryPurpose!=='REVIEW_ONLY_NO_DISPATCH'||
     !UUID.test(claims.originalCoreTaskId)||
     !UUID.test(claims.originalHubExecutionId)||
     !UUID.test(claims.originalAttemptId)||
     !/^[a-zA-Z0-9_-]{24,80}$/.test(claims.nonce)||
     claims.ownerSubject!==expectedOwnerSubject||
     !num(claims.issuedAt)||!num(claims.expiresAt)||
     typeof claims.originalReservationExpiresAt!=='string')
   return fail('RECOVERY_REVIEW_CLAIMS_DENIED');
  if(Object.keys(expectedOriginal).sort().join('|')!==[
     'coreTaskId','hubExecutionId','attemptId','expiresAt','recoveryPreviouslyRequested'
   ].sort().join('|')||
    expectedOriginal.coreTaskId!==claims.originalCoreTaskId||
    expectedOriginal.hubExecutionId!==claims.originalHubExecutionId||
    expectedOriginal.attemptId!==claims.originalAttemptId||
    expectedOriginal.expiresAt!==claims.originalReservationExpiresAt||
    expectedOriginal.recoveryPreviouslyRequested!==false)
   return fail('IMMUTABLE_ORIGINAL_EVIDENCE_MISMATCH');
  const originalExpiry=Date.parse(claims.originalReservationExpiresAt);
  if(!Number.isFinite(originalExpiry)||originalExpiry>=now||
     claims.issuedAt>now+30000||claims.expiresAt<=now||
     claims.expiresAt-claims.issuedAt>600000||
     claims.expiresAt<=claims.issuedAt||
     claims.issuedAt<now-600000)
   return fail('RECOVERY_SIGNATURE_WINDOW_INVALID');
  if(typeof serverPinnedSpkiSha256!=='string'||!SHA.test(serverPinnedSpkiSha256)||
     typeof signature!=='string'||!b64.test(signature))
   return fail('TRUSTED_VERIFIER_OR_SIGNATURE_UNAVAILABLE');
  const key=serverPinnedPublicKey?.type==='public'
    ? serverPinnedPublicKey : createPublicKey(serverPinnedPublicKey);
  if(key.type!=='public'||key.asymmetricKeyType!=='ed25519')
   return fail('WRONG_SIGNER_ALGORITHM');
  const spki=key.export({format:'der',type:'spki'});
  const digest=createHash('sha256').update(spki).digest();
  const expected=Buffer.from(serverPinnedSpkiSha256,'hex');
  if(expected.length!==32||!timingSafeEqual(digest,expected))
   return fail('TRUSTED_VERIFIER_FINGERPRINT_MISMATCH');
  const sig=Buffer.from(signature.replaceAll('-','+').replaceAll('_','/'),'base64');
  if(sig.length!==64||!verify(null,Buffer.from(raw,'utf8'),key,sig))
   return fail('RECOVERY_SIGNATURE_INVALID');
  // Even a genuine valid signature is NOT sufficient to authorize recovery.
  // Independent issuer must atomically consume the nonce and verify real
  // owner signatory role, current DB state, immutable target and replay fence.
  return Object.freeze({
   verified:true,reason:'SIGNATURE_VALID_INDEPENDENT_NONCE_AND_OWNER_REVIEW_REQUIRED',
   originalAttemptId:claims.originalAttemptId,
   recoveryAttemptNumber:2,
   approvalGranted:false,dispatchPermitted:false,canIssueAttempt:false
  });
 }catch{
  return fail('RECOVERY_SIGNATURE_VERIFICATION_UNAVAILABLE');
 }
}
