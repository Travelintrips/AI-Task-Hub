"use strict";
/**
 * One new GPT02 DEV test candidate. This plans prerequisites only.
 * User authorized PREPARATION, not an issuer grant or native dispatch.
 * Do not read env secrets, insert tasks, sign reviews, or touch Task #135.
 */
const LEGACY_TASK_ID=135;
const REQUIRED=Object.freeze([
 "devOnly","authenticatedSuperAdminSession","superAdminSignatureValidated",
 "newTaskIdPresent","newTaskNotLegacy135","picActiveInSameCompany",
 "picAuditPersisted","scopedHubLogin","tenantRlsE2eVerified",
 "claimNonceImmutable","separateIssuerLogin","grantLeaseFencingVerified",
 "nativeAttestorVerified","rollbackPlanTested"
]);
function assess(input={}){
 const checks={};
 for(const name of REQUIRED)checks[name]=input[name]===true;
 const taskId=input.taskId;
 checks.newTaskIdPresent=Number.isSafeInteger(taskId)&&taskId>0;
 checks.newTaskNotLegacy135=checks.newTaskIdPresent&&taskId!==LEGACY_TASK_ID;
 // Request approval in chat is not a cryptographic operator signature.
 const blockers=Object.entries(checks).filter(([,v])=>!v).map(([name])=>name);
 // The checker is intentionally never a positive authorization signal.
 return {scope:"GPT02_DEV_NEW_TEST_PREPARATION",taskId:checks.newTaskNotLegacy135?taskId:null,
  preparationApproved:true,operatorApprovalRecorded:checks.superAdminSignatureValidated,
  evidenceChecks:checks,blockers,releaseDecision:"NO_GO",
  creationPermitted:false,issuerPermitted:false,dispatchPermitted:false,
  legacyTask135RecoveryPermitted:false,prodMutationPermitted:false,readOnly:true};
}
module.exports={assess,REQUIRED,LEGACY_TASK_ID};
if(require.main===module){
 const report=assess();
 process.stdout.write(JSON.stringify(report,null,2)+"\n");
 process.exitCode=3;
}
