"use strict";
/**
 * GPT02 DEV cryptographic OPERATOR APPROVAL PROOF PREVIEW.
 *
 * This verifies an externally provided Ed25519 signature and strict
 * command-bound claims. It NEVER makes a runtime issuer/dispatch decision.
 * A database-backed, atomic and immutable nonce claim, verified Google
 * identity, separate issuer login, lease fencing and attestor are required
 * outside this pure verifier before any operational approval can exist.
 */
const {createPublicKey,verify}=require("node:crypto");
const REQUIRED=Object.freeze(["v","environment","audience","taskId","commandId",
 "attemptId","nonce","superAdminId","companyId","issuedAt","expiresAt"]);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NONCE=/^[a-zA-Z0-9_-]{32,128}$/;
const COMPANY=/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;
const MAX_DURATION_MS=5*60*1000;
function deny(reason){return {signatureValid:false,claimsValid:false,
 operatorApprovalRecorded:false,issuerPermitted:false,dispatchPermitted:false,
 decision:"NO_GO",reason};}
function canonicalPayload(x){
 if(!x||typeof x!=="object"||Array.isArray(x)||
   Object.keys(x).length!==REQUIRED.length||
   REQUIRED.some(k=>!Object.hasOwn(x,k)))return null;
 return JSON.stringify(Object.fromEntries(REQUIRED.map(k=>[k,x[k]])));
}
function inspectSignedApproval({claims,signatureBase64url,publicKeyPem,now=Date.now()}={}){
 const payload=canonicalPayload(claims);
 if(!payload)return deny("INVALID_CANONICAL_CLAIMS");
 if(claims.v!==1||claims.environment!=="DEV"||
   claims.audience!=="GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL"||
   !Number.isSafeInteger(claims.taskId)||claims.taskId<1||
   claims.taskId===135||!UUID.test(claims.commandId)||!UUID.test(claims.attemptId)||
   claims.commandId===claims.attemptId||!NONCE.test(claims.nonce)||
   !Number.isSafeInteger(claims.superAdminId)||claims.superAdminId<1||
   !COMPANY.test(claims.companyId)||
   !Number.isSafeInteger(claims.issuedAt)||
   !Number.isSafeInteger(claims.expiresAt)||
   claims.issuedAt>now+5000||claims.expiresAt<=now||
   claims.expiresAt<=claims.issuedAt||
   claims.expiresAt-claims.issuedAt>MAX_DURATION_MS)
  return deny("INVALID_OR_EXPIRED_APPROVAL_CLAIMS");
 if(typeof signatureBase64url!=="string"||
   !/^[a-zA-Z0-9_-]{86}$/.test(signatureBase64url)||
   typeof publicKeyPem!=="string"||publicKeyPem.length>2000)
  return deny("INVALID_SIGNATURE_INPUT");
 try{
  const key=createPublicKey(publicKeyPem);
  if(key.asymmetricKeyType!=="ed25519")return deny("ED25519_REQUIRED");
  const signature=Buffer.from(signatureBase64url,"base64url");
  if(signature.length!==64)return deny("INVALID_SIGNATURE_SIZE");
  if(!verify(null,Buffer.from(payload,"utf8"),key,signature))
   return deny("BAD_SIGNATURE");
 }catch{return deny("BAD_KEY_OR_SIGNATURE")}
 return {signatureValid:true,claimsValid:true,operatorApprovalRecorded:false,
   issuerPermitted:false,dispatchPermitted:false,decision:"NO_GO",
   reason:"DURABLE_NONCE_CLAIM_AND_INDEPENDENT_IDENTITY_NOT_VERIFIED",
   taskId:claims.taskId};
}
module.exports={inspectSignedApproval,canonicalPayload,REQUIRED};
