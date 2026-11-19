/**
 * Issue159 GPT02 DEV signer-custody readiness snapshot. READ-ONLY.
 * Does not read secret contents, sign, start units, send requests, create
 * approval claims, alter DB roles, or grant execution.
 */
import {existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const BASE='/opt/ai-coding-standalone-dev';
const SIGN=['gpt02-issue159-sign-once-approval.service',
  'gpt02-issue159-sign-once-operator@hub.service',
  'gpt02-issue159-sign-once-operator@core.service',
  'gpt02-issue159-sign-once-issuer.service'];
const SERVICE={
 hubReader:'gpt02-issue159-reader.service',
 approvalReader:'gpt02-issue159-approval-reader.service',
 issuerReader:'gpt02-issue159-issuer-reader.service',
 lineageReader:'gpt02-issue159-lineage-reader.service',
 verifier:'gpt02-issue159-verifier.service'
};
const FILE={
 approvedClaims:BASE+'/gpt02_issue159_approved_claims.json',
 hubCoreClaims:BASE+'/gpt02_issue159_hub_core_link_claims.json',
 issuerClaims:BASE+'/gpt02_issue159_issuer_claims.json',
 approvalSignature:'/run/gpt02-issue159-sign-once-approval/approval-signature.json',
 hubSignature:'/run/gpt02-issue159-sign-once-hub/hub-signature.json',
 coreSignature:'/run/gpt02-issue159-sign-once-core/core-signature.json',
 issuerReaderSocket:'/run/gpt02-issuer-reader/reader.sock',
 approvalReaderSocket:'/run/gpt02-approval-reader/approval.sock',
 hubReaderSocket:'/run/gpt02-reader/reader.sock',
 verifierSocket:'/run/gpt02-issue159-verifier/verify.sock',
 manifest:'/etc/gpt02-dev/trust-fingerprints.json'
};
const CREDENTIAL_PATH='/etc/credstore.encrypted';
const CREDENTIAL_LABELS=['approval','hub','core','issuer'];
const refusal=(code,details)=>Object.freeze({
 environment:'CST-DEV',mode:'SIGNER_CUSTODY_METADATA_ONLY',
 preconditionsComplete:false,operatorApprovalVerified:false,
 signatureVerified:false,attestorRecordPermitted:false,
 issuerLeaseGranted:false,signingPermitted:false,dispatchPermitted:false,
 releaseDecision:'NO_GO',reason:code,details:Object.freeze(details)
});
export function assessGpt02SignerCustody(snapshot){
 const srv=snapshot?.services,file=snapshot?.files,key=snapshot?.encryptedCredentialPresent,\n   runtime=snapshot?.runtime;
 if(!srv||!file||!key||!runtime||typeof srv!=='object'||\n   typeof file!=='object'||typeof key!=='object'||typeof runtime!=='object')
  return refusal('INVALID_READONLY_SNAPSHOT',[]);
 const missing=[];\n if(runtime.legacyAiTaskService!=='inactive')\n  missing.push('CONCURRENT_LEGACY_AI_TASK_RUNTIME');
 for(const [label] of Object.entries(SERVICE))
  if(srv[label]!=='active')missing.push('SERVICE_'+label);
 for(const label of Object.keys(FILE))
  if(file[label]!==true)missing.push('PREREQUISITE_'+label);
 for(const label of CREDENTIAL_LABELS)
  if(key[label]!==true)missing.push('ESCROW_METADATA_'+label);
 // A snapshot with all green metadata is STILL NOT command-bound consent or
 // an independently signed operator link, issuer receipt, or native ACK.
 return missing.length?
   refusal('SIGNER_PRECONDITIONS_INCOMPLETE',missing):
   Object.freeze({...refusal('SIGNER_METADATA_READY_NO_AUTHORITY',[]),
     preconditionsComplete:true});
}
export function readGpt02CustodyMetadata({
 exists=existsSync,
 serviceState=(unit)=>execFileSync('systemctl',
  ['show',unit,'-p','ActiveState','--value','--no-pager'],
  {encoding:'utf8',timeout:2000}).trim()
}={}){
 const services={},files={},encryptedCredentialPresent={};\n const runtime={legacyAiTaskService:'unavailable'};\n try{runtime.legacyAiTaskService=serviceState('ai-task-development.service')==='inactive'?\n   'inactive':'active'}catch{runtime.legacyAiTaskService='unavailable'}
 for(const [label,unit] of Object.entries(SERVICE)){
  try{services[label]=serviceState(unit)==='active'?'active':'inactive'}
  catch{services[label]='unavailable'}
 }
 for(const [label,path] of Object.entries(FILE)){
  try{files[label]=exists(path)===true}catch{files[label]=false}
 }
 for(const label of CREDENTIAL_LABELS){
  try{encryptedCredentialPresent[label]=exists(
   CREDENTIAL_PATH+'/gpt02-issue159-'+label+'-private-key.pkcs8')===true}
  catch{encryptedCredentialPresent[label]=false}
 }
 return Object.freeze({services:Object.freeze(services),
  files:Object.freeze(files),
  encryptedCredentialPresent:Object.freeze(encryptedCredentialPresent),\n  runtime:Object.freeze(runtime)});
}
if(process.argv[1] && import.meta.url===new URL('file://'+process.argv[1]).href){
 const result=assessGpt02SignerCustody(readGpt02CustodyMetadata());
 process.stdout.write(JSON.stringify(result)+'\n');
 if(!result.preconditionsComplete)process.exitCode=2;
}
