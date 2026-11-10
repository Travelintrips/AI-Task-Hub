/**
 * GPT02 DEV source candidate: bind a nonce consumption request to fresh,
 * server-read Hub/Core prepared records and three independent signatures.
 * Not mounted in HTTP routes/workers, not a signer or a dispatch/lease issuer.
 * The injected fact reader MUST perform independently authenticated DB reads;
 * caller cannot supply facts, clock, or pinned public keys.
 */
import {createPublicKey,createHash,verify} from 'node:crypto';
import {canonicalApproval} from './gpt02-issuer-store.mjs';
import {canonicalOperatorLink,operatorLinkSigningBytes} from './gpt02-operator-link.mjs';
import {inspectPreparedSignedLink} from './gpt02-prepared-link.mjs';
import {loadGpt02DevTrustStore} from './gpt02-dev-trust-store.mjs';

const FIELDS=['approval','operatorLink'];
const PUBLIC_KEYS=['approvalPublicKeyPem','hubPublicKeyPem','corePublicKeyPem'];
const exact=(value,fields)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&
 Object.keys(value).sort().join(',')===[...fields].sort().join(',');
const denied=reason=>Object.freeze({
 reason,evidenceConsumed:false,receiptId:null,preparationVerified:false,
 issuerLeaseGranted:false,dispatchPermitted:false,commandCreated:false,
 completionPermitted:false,releaseDecision:'NO_GO'
});
function pinnedKeys(keys){
 if(!exact(keys,PUBLIC_KEYS))throw Error('GPT02_PINNED_SIGNER_KEYS_REQUIRED');
 const publicKeys=Object.fromEntries(PUBLIC_KEYS.map(field=>{
  const s=keys[field];
  if(typeof s!=='string'||s.length>2000)throw Error('GPT02_PINNED_SIGNER_KEYS_REQUIRED');
  let key;
  try{key=createPublicKey(s)}catch{throw Error('GPT02_PINNED_SIGNER_KEYS_REQUIRED')}
  if(key.asymmetricKeyType!=='ed25519')throw Error('GPT02_ED25519_SIGNER_REQUIRED');
  return [field,s];
 }));
 const signatures=PUBLIC_KEYS.map(field=>createPublicKey(publicKeys[field])
  .export({format:'der',type:'spki'}).toString('hex'));
 if(new Set(signatures).size!==3)throw Error('GPT02_THREE_INDEPENDENT_KEYS_REQUIRED');
 return Object.freeze(publicKeys);
}
export function createPreparedNonceConsumer({
 readTrustedFacts,issuerStore,publicKeys,expectedFingerprints,clock=Date.now
}={}){
 if(typeof readTrustedFacts!=='function'||!issuerStore||
  typeof issuerStore.consumeLinkedApproval!=='function'||typeof clock!=='function')
  throw Error('GPT02_AUTHENTICATED_READ_AND_ISSUER_REQUIRED');
 // Only synthetic test runners may inject their own ephemeral public keys.
 // Operational DEV must load independently pinned public keys from the
 // restricted on-host trust store before any issuer or task reader can run.
 const synthetic=process.env.NODE_ENV==='test'&&process.env.APP_ENV!=='production';
 let keyMaterial;
 if(synthetic){
  if(expectedFingerprints!==undefined)throw Error('GPT02_TEST_CONFIG_MIXED_WITH_REAL_TRUST');
  keyMaterial=publicKeys;
 }else{
  if(publicKeys!==undefined)throw Error('GPT02_CALLER_SIGNER_KEYS_FORBIDDEN');
  if(process.env.NODE_ENV!=='development'||process.env.APP_ENV!=='development')
   throw Error('GPT02_EXPLICIT_CST_DEV_MODE_REQUIRED');
  const material=loadGpt02DevTrustStore({expectedFingerprints});
  keyMaterial={approvalPublicKeyPem:material.approvalPublicKeyPem,
   hubPublicKeyPem:material.hubPublicKeyPem,corePublicKeyPem:material.corePublicKeyPem};
 }
 const trustedKeys=pinnedKeys(keyMaterial);
 let inflight=false; // Single process guard; DB unique indexes are still the cross-process authority.
 // This preflight runs before ANY task/identity database read.
 // The fact reader will never receive an unauthenticated claim as a lookup.
 const signingKeys=Object.fromEntries(PUBLIC_KEYS.map(field=>[field,createPublicKey(trustedKeys[field])]));
 function validSignature(value,bytes,signerKey){
  if(typeof value!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(value))return false;
  const sig=Buffer.from(value,'base64url');
  return sig.length===64&&sig.toString('base64url')===value&&verify(null,bytes,signerKey,sig);
 }
 function signedBeforeRead(input){
  try{
   const a=input.approval.claims,l=input.operatorLink.claims;
   const ap=canonicalApproval(a),op=canonicalOperatorLink(l);
   const digest=createHash('sha256').update(ap).digest('hex');
   if(l.hubTaskId!==a.taskId||l.companyId!==a.companyId||
      l.coreCommandId!==a.commandId||l.attemptId!==a.attemptId||
      l.hubOperatorId!==a.superAdminId||l.nonce!==a.nonce||
      l.approvalDigest!==digest)return false;
   return validSignature(input.approval.signatureBase64url,Buffer.from(ap),signingKeys.approvalPublicKeyPem)&&
    validSignature(input.operatorLink.hubSignatureBase64url,
      operatorLinkSigningBytes(l,'hub'),signingKeys.hubPublicKeyPem)&&
    validSignature(input.operatorLink.coreSignatureBase64url,
      operatorLinkSigningBytes(l,'core'),signingKeys.corePublicKeyPem);
  }catch{return false;}
 }
 return Object.freeze({
  async consume(input){
   if(!exact(input,FIELDS)||!exact(input.approval,['claims','signatureBase64url'])||
      !exact(input.operatorLink,['claims','hubSignatureBase64url','coreSignatureBase64url']))
    return denied('UNTRUSTED_APPROVAL_INPUT');
   const a=input.approval.claims;
   if(!a||a.environment!=='DEV'||a.companyId!=='default'||
      !Number.isSafeInteger(a.taskId)||a.taskId<=136||
      typeof a.commandId!=='string'||typeof a.attemptId!=='string')
    return denied('OUT_OF_SCOPE_TASK_OR_APPROVAL');
   if(!signedBeforeRead(input))return denied('SIGNATURE_NOT_VERIFIED_BEFORE_DB_READ');
   if(inflight)return denied('LOCAL_DUPLICATE_CONSUMPTION');
   inflight=true;
   try{
    // Reader, never a request-body fact, reconstructs immutable reserved IDs
    // using scoped Hub/Core database connections. No silent fallback.
    const lookup=Object.freeze({companyId:a.companyId,hubTaskId:a.taskId,
      commandCandidateId:a.commandId,attemptId:a.attemptId});
    const facts=await readTrustedFacts(lookup);
    if(!exact(facts,['prepared','job','core','hubOperator','observedAt']))return denied('INCOMPLETE_TRUSTED_DB_READS');
    const at=clock();
    if(!Number.isSafeInteger(at)||!Number.isSafeInteger(facts.observedAt)||
       facts.observedAt>at||at-facts.observedAt>2000)
      return denied('STALE_OR_UNTRUSTED_FACT_READ');
    const inspected=inspectPreparedSignedLink({
      prepared:facts.prepared,job:facts.job,core:facts.core,
      hubOperator:facts.hubOperator,proof:input,publicKeys:trustedKeys,now:at
    });
    if(inspected.matched!==true||inspected.signatureVerified!==true||
      inspected.dualOriginVerified!==true||inspected.dispatchPermitted!==false)
      return denied('SIGNED_PREPARED_BINDING_NOT_VERIFIED');
    // Never grant authority from these boolean fields: the issuer connection
    // independently authenticates, verifies signatures and atomically claims
    // the nonce against hosted immutable DB approval + signed origin rows.
    if(clock()-facts.observedAt>2000)return denied('FACTS_EXPIRED_BEFORE_CONSUMPTION');
    const receipt=await issuerStore.consumeLinkedApproval(input);
    if(!receipt||typeof receipt.receiptId!=='string'||
       !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(receipt.receiptId)||
       receipt.evidenceConsumed!==true||receipt.dispatchPermitted!==false||
       receipt.authorizationGranted!==false||receipt.coreLedgerWritten!==false)
      return denied('ISSUER_RECEIPT_NOT_TRUSTWORTHY');
    return Object.freeze({
      reason:'ATOMIC_NONCE_EVIDENCE_ONLY',evidenceConsumed:true,receiptId:receipt.receiptId,
      preparationVerified:true,issuerLeaseGranted:false,dispatchPermitted:false,
      commandCreated:false,completionPermitted:false,releaseDecision:'NO_GO'
    });
   }catch{
    // Do not return signatures, nonce, DSN, SQL or authentication errors.
    return denied('TRUSTED_READ_OR_ISSUER_TRANSACTION_FAILED');
   }finally{inflight=false;}
  }
 });
}
