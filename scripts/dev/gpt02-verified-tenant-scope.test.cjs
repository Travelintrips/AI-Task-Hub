"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {scopeFromVerifiedPrincipal:admit}=require("./gpt02-verified-tenant-scope.cjs");
const staff={id:17,companyId:"tenant_a",role:"staff"};
const admin={id:1,companyId:"tenant_a",role:"super_admin"};
test("denies unauthenticated, invalid or header-only user claim",()=>{
 for(const principal of [null,{}, {role:"super_admin",companyId:"tenant_b"}, {id:1,role:"super_admin",companyId:""}])
  assert.equal(admit(principal,"tenant_b").allowed,false);
});
test("normal user cannot select other tenant even with query or requested admin mode",()=>{
 assert.equal(admit(staff,"tenant_b").reason,"CROSS_TENANT_SELECTOR_FORBIDDEN");
 assert.equal(admit(staff,undefined,{crossCompanyRead:true}).mode,"SINGLE_TENANT");
});
test("verified super-admin may request explicit cross-company READ proposal, never DB role or dispatch",()=>{
 const out=admit(admin,undefined,{crossCompanyRead:true});
 assert.equal(out.mode,"CROSS_COMPANY_READ_REQUIRES_DEDICATED_DB_ROLE");
 assert.equal(out.dbCredentialRole,null);
 assert.equal(out.issuerPermitted,false);
 assert.equal(out.dispatchPermitted,false);
});
test("staff own tenant and scoped admin selector are permitted only as non-authorizing plan",()=>{
 for(const o of [admit(staff),admit(staff,"tenant_a"),admit(admin,"tenant_b")]){
  assert.equal(o.allowed,true);
  assert.equal(o.mode,"SINGLE_TENANT");
  assert.equal(o.dbCredentialRole,null);
 }
});
test("rejects malformed and wildcard company IDs",()=>{
 for(const x of ["all","*","../tenant_a","tenant a","",["tenant_b"]]){
  const o=admit(staff,x);
  if(x==="all")assert.equal(o.allowed,false);
  else assert.equal(o.allowed,false);
 }
});
