"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {evaluate,REQUIRED,FORBIDDEN}=require("./gpt02-hub-db-login-cutover-readonly.cjs");
const ready=()=>({devRuntime:true,databaseConnected:true,roleDistinctFromPostgres:true,
 nonPrivileged:true,noBroadReaderWriter:true,noEvidenceMembership:true,
 noEvidenceDml:true,requiredPrivileges:true,rlsChecked:true,
 applicationReadWriteE2E:true,roleName:"synthetic_scoped_app"});
test("even an all-green privilege census never authorizes a cutover or GPT02 issuer",()=>{
 const x=evaluate(ready());
 assert.equal(x.releaseDecision,"NO_GO");
 assert.equal(x.dbLoginCutoverPermitted,false);
 assert.equal(x.nativeDispatchPermitted,false);
 assert.equal(x.issuerPermitted,false);
 assert.ok(x.reasons.includes("CUTOVER_REQUIRES_SEPARATE_APPROVAL_AND_ROLLBACK"));
});
test("postgres app login and blanket grants remain hard blockers",()=>{
 for (const name of ["roleDistinctFromPostgres","nonPrivileged","noBroadReaderWriter",
  "noEvidenceMembership","noEvidenceDml"]){
  const x=ready();x[name]=false;
  const result=evaluate(x);assert.ok(result.reasons.length>1,name);
  assert.equal(result.dbLoginCutoverPermitted,false);
 }
});
test("missing app table coverage, RLS or auth E2E never succeeds",()=>{
 for(const name of ["databaseConnected","requiredPrivileges","rlsChecked","applicationReadWriteE2E"]){
  const x=ready();x[name]=false;
  const result=evaluate(x);assert.equal(result.releaseDecision,"NO_GO",name);
  assert.ok(result.reasons.length>=2,name);
 }
});
test("scope is explicitly minimal and excludes claim/nonce write rights",()=>{
 assert.ok(REQUIRED.length>=4);
 assert.equal(FORBIDDEN.length,2);
 assert.ok(FORBIDDEN.every(x=>x.includes("dev_gpt02_")));
 assert.equal(evaluate(ready()).tableCoverage.notExhaustive,true);
});
