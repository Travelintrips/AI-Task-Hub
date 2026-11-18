import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  hasRecentVerifiedGpt02DevGoogleOperator as hasProof,
  GPT02_GOOGLE_OPERATOR_MAX_AGE_MS,
} from "../src/lib/gpt02-google-auth-gate.mjs";

const now=1_800_000_000_000;
const env={
  NODE_ENV:"development",APP_ENV:"development",
  SESSION_SECRET:"synthetic-dev-secret-for-test-only-no-real-credential",
};
const admin={
  id:"synthetic-db-id",email:"synthetic-admin@example.invalid",
  role:"super_admin",authSource:"supabase_google_identity",
  authSupabaseId:"12345678-1234-4234-8234-123456789abc",
  authVerifiedAt:now-5000,
};
test("verified recent Google Super Admin grants identity check but NOT command authority",()=>{
  assert.equal(GPT02_GOOGLE_OPERATOR_MAX_AGE_MS,10*60_000);
  assert.equal(hasProof(admin,env,now),true);
  const result=hasProof(admin,env,now);
  assert.equal(typeof result,"boolean");
});
test("7-day legacy email-only dashboard Super Admin token is denied",()=>{
  for(const old of [
    {...admin,authSource:undefined,authSupabaseId:undefined,authVerifiedAt:undefined},
    {...admin,authSource:"passwordless_email"},
    {...admin,authSource:"password"},
    {...admin,authSource:"google_linked_only"},
    {...admin,authSource:null},
  ])assert.equal(hasProof(old,env,now),false);
});
test("staff, company admin, owner, null account and invalid email are denied",()=>{
  for(const testUser of [
    null,undefined,{...admin,role:"staff"},{...admin,role:"company_admin"},
    {...admin,role:"owner"},{...admin,id:" "},{...admin,email:"invalid"},
    {...admin,email:"not verified"}
  ]) assert.equal(hasProof(testUser,env,now),false);
});
test("old or future Google authentication does not silently retain privileged write access",()=>{
  for(const ts of [0,now-600001,now-7*86400000,now+30001,NaN,Infinity,"1800000000000",null])
    assert.equal(hasProof({...admin,authVerifiedAt:ts},env,now),false,String(ts));
  assert.equal(hasProof({...admin,authVerifiedAt:now-600000},env,now),true);
  assert.equal(hasProof({...admin,authVerifiedAt:now+30000},env,now),true);
});
test("no malformed/unbound Supabase Auth ID is treated as valid provenance",()=>{
  for(const id of [undefined,null,"","opaque-account","00000000-0000-0000-0000-000000000000",
     "12345678-1234-4234-c234-123456789abc","12345678-1234-4234-8234-123456789abx"])
    assert.equal(hasProof({...admin,authSupabaseId:id},env,now),false,String(id));
});
test("wrong environment and missing/short signing custody fail closed",()=>{
  for(const diff of [
    {NODE_ENV:"production"},{APP_ENV:"production"},{NODE_ENV:"test"},
    {APP_ENV:"test"},{SESSION_SECRET:""},{SESSION_SECRET:"short"},
    {SESSION_SECRET:"fallback-secret-change-in-production"},
  ]) assert.equal(hasProof(admin,{...env,...diff},now),false,JSON.stringify(diff));
});
test("the real Google OAuth route, not email-only login, exclusively mints proof claims",()=>{
  const source=readFileSync(new URL("../src/routes/auth.ts",import.meta.url),"utf8");
  const emailOnly=source.split('router.post("/auth/login"')[1].split('router.get("/auth/google/start"')[0];
  assert.doesNotMatch(emailOnly,/authSource:|authSupabaseId:|authVerifiedAt:/);
  assert.match(source,/recentGoogleOAuthEvidenceAt/);
  assert.match(source,/authSource: "supabase_google_identity" as const/);
  assert.match(source,/authSupabaseId: authUser.id/);
  assert.match(source,/authVerifiedAt: verifiedGoogleOAuthAt/);
});
test("critical GPT02 DEV write endpoints require genuine fresh Google identity before DB write",()=>{
  const files=[
    ["../src/routes/gpt02-preparation.ts",[
      'router.post("/ai-tasks/:id/gpt02-prepare"',
      'router.post("/ai-tasks/:id/gpt02-replace-historical-reference"',
    ]],
    ["../src/routes/executions.ts",[
      'router.post("/ai-tasks/:id/gpt02-adopt-existing"',
      'router.post("/ai-tasks/:id/gpt02-assign-pic"',
      'router.post("/ai-tasks/:id/gpt02-confirm-recovery-pic"',
    ]],
  ];
  for(const [path,endpoints] of files) {
    const source=readFileSync(new URL(path,import.meta.url),"utf8");
    for(const endpoint of endpoints){
      const start=source.indexOf(endpoint);
      assert.ok(start>=0,endpoint);
      const next=source.indexOf("router.",start+endpoint.length);
      const route=source.slice(start,next<0?undefined:next);
      const gate=route.indexOf("hasRecentVerifiedGpt02DevGoogleOperator(req.user)");
      assert.ok(gate>=0,endpoint+" missing verified Google guard");
      assert.match(route,/GPT02_FRESH_GOOGLE_OPERATOR_REQUIRED/);
      for(const writer of ["db.update(","db.insert(","db.transaction(","tx.update(","tx.insert(","factory.preparer.prepare(","scheduleExecutionTracking("]){
        const write=route.indexOf(writer);
        if(write>=0)assert.ok(gate<write,endpoint+" gate must precede "+writer);
      }
    }
  }
});
