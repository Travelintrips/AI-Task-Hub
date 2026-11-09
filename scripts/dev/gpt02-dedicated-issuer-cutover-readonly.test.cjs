"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const path=require("node:path");
const {assessIssuer}=require("./gpt02-dedicated-issuer-cutover-readonly.cjs");
const green={environment:"DEV",dbReadOnly:true,issuerRole:"gpt02_issuer_login_dev",
 issuerCanLogin:true,issuerElevated:false,issuerBypassRls:false,
 issuerCreateRole:false,issuerCreateDb:false,
 issuerCanAssumeEvidenceOwner:false,issuerCanAssumeWriter:false,
 issuerCanAssumePostgres:false,issuerHasGlobalRead:false,
 issuerHasGlobalWrite:false,issuerCanReadUnrelatedTables:false,
 issuerCanModifyEvidenceDirectly:false,
 issuerOnlyWhitelistedRoutine:true,commandBoundApprovalValidated:true,
 atomicNonceValidatedLive:true,immutableAuditReadback:true,
 leaseAndFencingValidated:true,nativeAttestationValidated:true};
test("even all synthetic greens never authorize issuer or dispatch",()=>{
 const r=assessIssuer(green);
 assert.equal(r.blockers.length,0);
 assert.equal(r.cutoverPermitted,false);
 assert.equal(r.grantPermitted,false);
 assert.equal(r.dispatchPermitted,false);
 assert.equal(r.releaseDecision,"NO_GO");
});
test("existing administrative and bypassrls roles are denied",()=>{
 for(const issuerRole of ["postgres","ai_task_hostinger","service_role","supabase_admin",
  "dev_gpt02_claim_writer_nologin","dev_gpt02_evidence_owner"]){
  assert.ok(assessIssuer({...green,issuerRole}).blockers.includes("ISSUER_ROLE_NOT_DEDICATED"));
 }
});
test("wrong environment or untrusted audit rejects",()=>{
 for(const input of [{...green,environment:"PROD"},{...green,dbReadOnly:false},
  {...green,issuerCanLogin:false},{...green,issuerElevated:true},
  {...green,issuerBypassRls:true},{...green,issuerHasGlobalRead:true},
  {...green,issuerCanAssumeEvidenceOwner:true},{...green,issuerCanAssumeWriter:true},
  {...green,issuerCanModifyEvidenceDirectly:true},{...green,issuerCanReadUnrelatedTables:true}]){
  assert.ok(assessIssuer(input).blockers.length>0);
 }
});
test("missing independent cryptographic and operational evidence denies",()=>{
 for(const key of ["issuerOnlyWhitelistedRoutine","commandBoundApprovalValidated",
 "atomicNonceValidatedLive","immutableAuditReadback","leaseAndFencingValidated",
 "nativeAttestationValidated"]){
  assert.ok(assessIssuer({...green,[key]:false}).blockers.length>0,key);
 }
});
test("audit code has no database DDL or DML and uses BEGIN READ ONLY",()=>{
 const code=readFileSync(path.join(__dirname,"gpt02-dedicated-issuer-cutover-readonly.cjs"),"utf8");
 assert.match(code,/BEGIN READ ONLY/);
 assert.match(code,/statement_timeout:7000/);
 assert.doesNotMatch(code,/c\.query\(\s*["'`]\s*(?:CREATE|ALTER|GRANT|REVOKE|INSERT|UPDATE|DELETE)/i);
 assert.match(code,/releaseDecision:"NO_GO"/);
});
