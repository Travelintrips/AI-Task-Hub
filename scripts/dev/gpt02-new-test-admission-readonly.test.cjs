"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {assess,REQUIRED}=require("./gpt02-new-test-admission-readonly.cjs");
test("chat authorization permits preparation only, never command issuance",()=>{
 const r=assess();
 assert.equal(r.preparationApproved,true);
 for(const key of ["creationPermitted","issuerPermitted","dispatchPermitted",
 "legacyTask135RecoveryPermitted","prodMutationPermitted"])assert.equal(r[key],false,key);
 assert.equal(r.releaseDecision,"NO_GO");
});
test("old task 135 cannot be reused even with favorable input",()=>{
 const good=Object.fromEntries(REQUIRED.map(x=>[x,true]));
 for(const id of [135,0,-1,"136",null,undefined]){
  const r=assess({...good,taskId:id});
  assert.equal(r.evidenceChecks.newTaskNotLegacy135,false);
  assert.equal(r.dispatchPermitted,false);
 }
});
test("a unique new task reference does not grant issuer without independent signed operator proof",()=>{
 const r=assess({taskId:136,authenticatedSuperAdminSession:true});
 assert.equal(r.evidenceChecks.newTaskNotLegacy135,true);
 assert.equal(r.evidenceChecks.superAdminSignatureValidated,false);
 assert.ok(r.blockers.includes("superAdminSignatureValidated"));
 assert.equal(r.issuerPermitted,false);
});
test("even fabricated all green booleans cannot become a dispatch or PROD mutation authorization",()=>{
 const good=Object.fromEntries(REQUIRED.map(x=>[x,true]));
 const r=assess({...good,taskId:136});
 assert.equal(r.blockers.length,0);
 assert.equal(r.dispatchPermitted,false);
 assert.equal(r.creationPermitted,false);
 assert.equal(r.prodMutationPermitted,false);
 assert.equal(r.releaseDecision,"NO_GO");
});
