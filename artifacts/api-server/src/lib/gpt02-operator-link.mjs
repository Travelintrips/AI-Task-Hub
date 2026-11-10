/** Candidate identity bridge only. Does not authenticate browsers, sign claims or authorize dispatch. */
import { createHash, createPublicKey, verify } from 'node:crypto';
const FIELDS=Object.freeze([
 'v','environment','audience','linkId','companyId','hubTaskId','hubExecutionId',
 'coreTaskId','coreCommandId','attemptId','attemptNumber','assigneeId','accountableOwnerId',
 'hubOperatorNamespace','hubOperatorId','hubRole','hubActive',
 'coreOperatorNamespace','coreOperatorUserId','coreRole','coreActive','corePasswordChanged',
 'workerId','approvalDigest','nonce','issuedAt','expiresAt'
]);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SUBJECT=/^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$/;
const LEGACY_COMMAND='83db99f5-cbda-4e60-be71-3090fb411bbb';
const LEGACY_EXECUTION='4eb75fa9-f9e4-4573-8e00-d3084b4c2c8a';
const isObject=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const int32=x=>Number.isSafeInteger(x)&&x>0&&x<=2147483647;
export class OperatorLinkError extends Error {
 constructor(code){super(code);this.name='OperatorLinkError';this.code=code;}
}
const fail=code=>{throw new OperatorLinkError(code);};
export function canonicalOperatorLink(c){
 if(!isObject(c)||Object.keys(c).length!==FIELDS.length||FIELDS.some(k=>!Object.hasOwn(c,k)))fail('INVALID_OPERATOR_LINK_FIELDS');
 return JSON.stringify(Object.fromEntries(FIELDS.map(k=>[k,c[k]])));
}
/** Domain separation prevents a valid Hub signature being reused as a Core signature. */
export function operatorLinkSigningBytes(claims,origin){
 if(!['hub','core'].includes(origin))fail('INVALID_OPERATOR_LINK_ORIGIN');
 return Buffer.from('GPT02_OPERATOR_LINK_V1:'+origin+'\n'+canonicalOperatorLink(claims));
}
function pinnedKey(pem){
 if(typeof pem!=='string'||pem.length>2000||!pem.includes('BEGIN PUBLIC KEY'))fail('PINNED_OPERATOR_KEYS_REQUIRED');
 let k;try{k=createPublicKey(pem);}catch{fail('PINNED_OPERATOR_KEYS_REQUIRED');}
 if(k.asymmetricKeyType!=='ed25519')fail('OPERATOR_ED25519_REQUIRED');
 return k;
}
function signature(s,payload,key){
 if(typeof s!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(s))return false;
 const b=Buffer.from(s,'base64url');
 return b.length===64&&b.toString('base64url')===s&&verify(null,payload,key,b);
}
/** Keys must come from an independent server trust store, never from the link request. */
export function createOperatorLinkVerifier({hubPublicKeyPem,corePublicKeyPem}={}){
 const hub=pinnedKey(hubPublicKeyPem),core=pinnedKey(corePublicKeyPem);
 if(hub.export({format:'der',type:'spki'}).equals(core.export({format:'der',type:'spki'})))fail('INDEPENDENT_OPERATOR_KEYS_REQUIRED');
 return function verifyOperatorLink(proof,approval,approvalDigest,now){
  if(!isObject(proof)||Object.keys(proof).sort().join(',')!=='claims,coreSignatureBase64url,hubSignatureBase64url')fail('INVALID_OPERATOR_LINK_ENVELOPE');
  const payload=canonicalOperatorLink(proof.claims),c=JSON.parse(payload);
  const hubSignature=proof.hubSignatureBase64url,coreSignature=proof.coreSignatureBase64url;
  if(!Number.isSafeInteger(now)||now<0||c.v!==1||c.environment!=='DEV'||c.audience!=='GPT02_DUAL_ACCOUNT_COMMAND_LINK'||
   !int32(c.hubTaskId)||c.hubTaskId===135||!int32(c.coreOperatorUserId)||!int32(c.assigneeId)||c.attemptNumber!==1||
   c.companyId!=='default'||c.hubOperatorNamespace!=='ai-task-hub.public.users'||
   c.coreOperatorNamespace!=='ai-core.ai_platform.internal_users'||typeof c.hubOperatorId!=='string'||!SUBJECT.test(c.hubOperatorId)||
   typeof c.accountableOwnerId!=='string'||!SUBJECT.test(c.accountableOwnerId)||
   c.hubRole!=='super_admin'||c.hubActive!==true||!['owner','admin'].includes(c.coreRole)||c.coreActive!==true||c.corePasswordChanged!==true||
   c.workerId!=='openclaw-dell-chatgpt-wake-dev'||typeof c.nonce!=='string'||!/^[A-Za-z0-9_-]{32,128}$/.test(c.nonce)||
   typeof c.approvalDigest!=='string'||!/^[0-9a-f]{64}$/.test(c.approvalDigest)||
   [c.linkId,c.hubExecutionId,c.coreTaskId,c.coreCommandId,c.attemptId].some(x=>typeof x!=='string'||!UUID.test(x))||
   new Set([c.hubExecutionId,c.coreTaskId,c.coreCommandId,c.attemptId]).size!==4||
   c.coreCommandId===LEGACY_COMMAND||c.hubExecutionId===LEGACY_EXECUTION||
   !Number.isSafeInteger(c.issuedAt)||!Number.isSafeInteger(c.expiresAt)||c.issuedAt<0||
   c.issuedAt>now+5000||c.expiresAt<=now||c.expiresAt<=c.issuedAt||c.expiresAt-c.issuedAt>120000)
   fail('INVALID_OR_EXPIRED_OPERATOR_LINK');
  if(!isObject(approval)||approval.v!==2||approval.environment!=='DEV'||c.approvalDigest!==approvalDigest||
   c.companyId!==approval.companyId||c.hubTaskId!==approval.taskId||c.coreCommandId!==approval.commandId||
   c.attemptId!==approval.attemptId||c.nonce!==approval.nonce||c.hubOperatorNamespace!==approval.operatorNamespace||
   c.hubOperatorId!==approval.superAdminId||c.issuedAt<approval.issuedAt||c.expiresAt>approval.expiresAt)
   fail('OPERATOR_LINK_APPROVAL_MISMATCH');
  if(!signature(hubSignature,Buffer.from('GPT02_OPERATOR_LINK_V1:hub\n'+payload),hub)||
     !signature(coreSignature,Buffer.from('GPT02_OPERATOR_LINK_V1:core\n'+payload),core))fail('OPERATOR_LINK_SIGNATURE_NOT_VERIFIED');
  return Object.freeze({payload,digest:createHash('sha256').update(payload).digest('hex'),
   hubSignature,coreSignature,
   coreOperatorUserId:c.coreOperatorUserId,recordedBy:'internal:'+c.coreOperatorUserId,
   hubOperatorId:c.hubOperatorId,linkId:c.linkId});
 };
}
