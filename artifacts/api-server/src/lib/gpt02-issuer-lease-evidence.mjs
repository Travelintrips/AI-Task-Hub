/**
 * DEV-only issuer lease evidence verifier. NOT a grant issuer or dispatcher.
 * All snapshots must come from independently authenticated, bounded DB reads.
 * Caller assertions are not authority, and a cryptographic match NEVER
 * enables a worker, nonce consumption, task creation, or dispatch.
 */
import {createHash,createPublicKey,verify} from 'node:crypto';
import {inspectPreparedSignedLink} from './gpt02-prepared-link.mjs';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const HEX=/^[0-9a-f]{64}$/;
const WORKER='openclaw-dell-chatgpt-wake-dev';
const ROLE='dev_gpt02_issuer_evidence';
const CLAIM_FIELDS=Object.freeze([
 'v','environment','audience','companyId','hubTaskId','hubExecutionId',
 'coreTaskId','commandId','attemptId','workerId','receiptId','linkId',
 'fenceId','approvalDigest','nonceDigest','issuerRole','leaseEpoch',
 'issuedAt','expiresAt'
]);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(v,fields)=>object(v)&&Object.keys(v).sort().join(',')===[...fields].sort().join(',');
const time=x=>Number.isSafeInteger(x)&&x>0;
const denied=reason=>Object.freeze({
 matched:false,reason,signatureVerified:false,nonceEvidenceMatched:false,
 issuerLeaseEvidenceVerified:false,leaseGranted:false,issuerPermitted:false,
 dispatchPermitted:false,commandCreated:false,readOnly:true,releaseDecision:'NO_GO'
});
export function canonicalIssuerLeaseEvidence(claims){
 if(!exact(claims,CLAIM_FIELDS))throw Error('INVALID_ISSUER_LEASE_CLAIMS');
 return JSON.stringify(Object.fromEntries(CLAIM_FIELDS.map(k=>[k,claims[k]])));
}
function key(pem){
 if(typeof pem!=='string'||pem.length>2000||!pem.includes('-----BEGIN PUBLIC KEY-----'))
  throw Error('ISSUER_PUBLIC_KEY_REQUIRED');
 const k=createPublicKey(pem);
 if(k.asymmetricKeyType!=='ed25519')throw Error('ISSUER_ED25519_REQUIRED');
 return k;
}
/**
 * Success only means detached issuer evidence cryptographically matches
 * historical snapshots; the live ledger, nonce uniqueness and valid worker
 * lease must be independently proven by a separate authorized service.
 */
/** Pin all four signer public keys from the independent server trust store.
 * Never read any of these keys from the caller's evidence envelope. */
export function createIssuerLeaseEvidenceVerifier({publicKeys,issuerPublicKeyPem}={}){
 let issuerKey;
 const allowedKeys=['approvalPublicKeyPem','hubPublicKeyPem','corePublicKeyPem'];
 try{
  if(!exact(publicKeys,allowedKeys))throw Error('PINNED_KEYS_REQUIRED');
  issuerKey=key(issuerPublicKeyPem);
  const fingerprints=[issuerKey,...allowedKeys.map(n=>key(publicKeys[n]))]
   .map(k=>k.export({format:'der',type:'spki'}).toString('hex'));
  if(new Set(fingerprints).size!==4)throw Error('INDEPENDENT_KEYS_REQUIRED');
 }catch{return ()=>denied('PINNED_FOUR_SIGNER_KEYS_REQUIRED');}
 const trustedKeys=Object.freeze({...publicKeys});
 const allowedEvidence=['prepared','job','core','hubOperator','proof','nonceReceipt',
  'identityReceipt','fence','lease','now'];
 return function inspectIssuerLeaseEvidence(evidence={}){
 try{
  if(!object(evidence)||Object.keys(evidence).some(k=>!allowedEvidence.includes(k))||
     allowedEvidence.filter(k=>k!=='now').some(k=>!Object.hasOwn(evidence,k)))
   return denied('UNEXPECTED_EVIDENCE_FIELDS');
  const {prepared,job,core,hubOperator,proof,nonceReceipt,identityReceipt,
   fence,lease,now=Date.now()}=evidence;
  if(!time(now)||!object(proof)||!object(proof.approval)||!object(proof.operatorLink)||
     !object(nonceReceipt)||!object(identityReceipt)||
     !object(fence)||!exact(lease,['claims','signatureBase64url']))
   return denied('INCOMPLETE_INDEPENDENT_EVIDENCE');
  const binding=inspectPreparedSignedLink({prepared,job,core,hubOperator,proof,publicKeys:trustedKeys,now});
  if(binding.matched!==true||binding.signatureVerified!==true||
     binding.dualOriginVerified!==true)return denied('PREPARED_SIGNED_LINK_NOT_VERIFIED');
  const a=proof.approval.claims,l=proof.operatorLink.claims,c=lease.claims;
  if(!time(prepared.hubTaskId)||prepared.hubTaskId<=136||
     ![prepared.coreTaskId,prepared.hubExecutionId,prepared.commandCandidateId,
       prepared.attemptId,nonceReceipt.receiptId,identityReceipt.receiptId,
       fence.fenceId].every(x=>typeof x==='string'&&UUID.test(x)))
   return denied('INVALID_HISTORICAL_OR_BINDING_IDENTITY');
  if(nonceReceipt.commandId!==a.commandId||
     nonceReceipt.receiptId!==identityReceipt.receiptId||
     nonceReceipt.nonce!==a.nonce||
     nonceReceipt.digest!==binding.approvalDigest||
     !time(nonceReceipt.consumedAt)||nonceReceipt.consumedAt>now||
     nonceReceipt.consumedAt<a.issuedAt)
   return denied('NONCE_RECEIPT_NOT_VERIFIED');
  if(identityReceipt.commandId!==a.commandId||
     identityReceipt.linkId!==l.linkId||
     identityReceipt.operatorUserId!==core.operatorUserId||
     identityReceipt.hubOperatorId!==prepared.operatorSubject||
     identityReceipt.linkDigest!==binding.operatorLinkDigest||
     identityReceipt.bindingVerified!==false||
     identityReceipt.mayDispatchWorker!==false||
     identityReceipt.mayIssueGrant!==false||
     identityReceipt.mayCloseJob!==false||
     identityReceipt.coreLedgerWritten!==false)
   return denied('CORE_IDENTITY_RECEIPT_MISMATCH');
  if(fence.receiptId!==nonceReceipt.receiptId||
     fence.commandId!==a.commandId||fence.linkId!==l.linkId||
     fence.hubExecutionId!==prepared.hubExecutionId||
     fence.coreTaskId!==prepared.coreTaskId||
     fence.attemptId!==prepared.attemptId||
     fence.workerId!==WORKER||core.workerId!==WORKER||
     fence.leaseEpoch!==1||fence.dispatchAllowed!==false||
     fence.coreLedgerWritten!==false||
     !time(fence.leaseStartedAt)||!time(fence.leaseExpiresAt)||
     fence.leaseStartedAt<nonceReceipt.consumedAt||
     fence.leaseExpiresAt<=now||fence.leaseExpiresAt<=fence.leaseStartedAt||
     fence.leaseExpiresAt-fence.leaseStartedAt>15000||
     fence.leaseExpiresAt>a.expiresAt||fence.leaseExpiresAt>l.expiresAt)
   return denied('NONDISPATCH_FENCE_NOT_VERIFIED');
  if(!exact(c,CLAIM_FIELDS)||
     c.v!==1||c.environment!=='DEV'||c.audience!=='GPT02_ISSUER_LEASE_EVIDENCE_V1'||
     c.companyId!=='default'||c.companyId!==a.companyId||
     c.hubTaskId!==prepared.hubTaskId||
     c.hubExecutionId!==prepared.hubExecutionId||
     c.coreTaskId!==prepared.coreTaskId||
     c.commandId!==a.commandId||c.attemptId!==a.attemptId||
     c.workerId!==WORKER||c.receiptId!==nonceReceipt.receiptId||
     c.linkId!==l.linkId||c.fenceId!==fence.fenceId||
     c.approvalDigest!==binding.approvalDigest||!HEX.test(c.approvalDigest)||
     c.nonceDigest!==createHash('sha256').update(a.nonce).digest('hex')||
     c.issuerRole!==ROLE||c.leaseEpoch!==1||
     !time(c.issuedAt)||!time(c.expiresAt)||
     c.issuedAt<fence.leaseStartedAt||c.issuedAt>now+1000||
     c.expiresAt<=now||c.expiresAt<=c.issuedAt||
     c.expiresAt>fence.leaseExpiresAt||c.expiresAt-c.issuedAt>15000)
   return denied('ISSUER_LEASE_CLAIMS_MISMATCH');
  const sig=lease.signatureBase64url;
  if(typeof sig!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(sig))
   return denied('ISSUER_LEASE_SIGNATURE_INVALID');
  const b=Buffer.from(sig,'base64url');
  const bytes=Buffer.from('GPT02_ISSUER_LEASE_EVIDENCE_V1\n'+canonicalIssuerLeaseEvidence(c));
  if(b.length!==64||b.toString('base64url')!==sig||!verify(null,bytes,issuerKey,b))
   return denied('ISSUER_LEASE_SIGNATURE_INVALID');
  // Only an informational match: the issuer role is NOLOGIN in live CST-DEV,
  // there is no operational lease/nonce authority, and dispatch is forbidden.
  return Object.freeze({
   matched:true,reason:'SIGNED_ISSUER_EVIDENCE_ONLY',
   signatureVerified:true,nonceEvidenceMatched:true,issuerLeaseEvidenceVerified:true,
   leaseGranted:false,issuerPermitted:false,dispatchPermitted:false,
   commandCreated:false,readOnly:true,releaseDecision:'NO_GO'
  });
 }catch{return denied('UNTRUSTED_OR_INVALID_ISSUER_EVIDENCE')}
}
}
