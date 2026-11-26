"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const src=readFileSync(require("node:path").join(__dirname,"../../artifacts/api-server/src/routes/auth.ts"),"utf8");
const start=src.indexOf('router.post("/auth/gpt02/operator-identity-preflight"');
const end=src.indexOf('// ─── POST /auth/logout',start);
const route=src.slice(start,end);
test("GPT02 identity preflight uses separate authenticated endpoint and fails closed outside DEV",()=>{
 assert.ok(start>0&&end>start);
 assert.match(route,/requireAuth/);
 assert.match(route,/isProduction \|\| !devPasswordlessLoginEnabled/);
 assert.match(route,/req\.user\?\.role !== "super_admin"/);
 assert.match(route,/Cache-Control", "no-store"/);
});
test("Google identity is checked independently and matched to active Super Admin account",()=>{
 assert.match(route,/supabase\.auth\.getUser\(accessToken\)/);
 assert.match(route,/googleUser\?\.email_confirmed_at/);
 assert.match(route,/hasGoogleIdentity/);
 assert.match(route,/activeAdmin\.isActive/);
 assert.match(route,/activeAdmin\.role !== "super_admin"/);
 assert.match(route,/String\(activeAdmin\.id\) !== String\(req\.user\.id\)/);
 assert.match(route,/SUPER_ADMIN_ACCOUNT_MISMATCH/);
});
test("identity preflight cannot mutate, authorize issuer, or dispatch",()=>{
 assert.match(route,/operatorApprovalRecorded: false/);
 assert.match(route,/issuerPermitted: false, dispatchPermitted: false/);
 for(const forbidden of ["signToken(","db.insert(","db.update(","issueCommand(","resumeCommand(","dispatchCommand("])
  assert.equal(route.includes(forbidden),false,forbidden);
 assert.match(route,/SIGNED_COMMAND_BOUND_APPROVAL/);
 assert.match(route,/IMMUTABLE_NONCE/);
});
