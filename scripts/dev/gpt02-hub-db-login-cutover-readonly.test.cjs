"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {evaluate,summarizeRequiredRls,REQUIRED,FORBIDDEN}=require("./gpt02-hub-db-login-cutover-readonly.cjs");
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

test("RLS catalog exposes missing policies but cannot authorize cutover",()=>{
 const rows=REQUIRED.map((x,i)=>({resource:x.table,rls_enabled:true,
  force_rls:false,policy_count:i===0?1:0}));
 const scan=summarizeRequiredRls(rows);
 assert.equal(scan.checkedTables,REQUIRED.length);
 assert.equal(scan.tablesWithoutPolicy.length,REQUIRED.length-1);
 assert.equal(scan.policySemanticsVerified,false);
 const report=evaluate({...ready(),requiredRls:scan});
 assert.ok(report.reasons.includes("APP_REQUIRED_TABLE_RLS_POLICIES_MISSING"));
 assert.equal(report.dbLoginCutoverPermitted,false);
});
test("missing RLS catalog rows remain blocked",()=>{
 const scan=summarizeRequiredRls([]);
 assert.equal(scan.checkedTables,0);
 assert.equal(scan.incomplete.length,REQUIRED.length);
 assert.equal(evaluate({...ready(),requiredRls:scan}).releaseDecision,"NO_GO");
});
