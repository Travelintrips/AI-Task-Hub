import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {classifyExistingGpt02GoogleAppSession as status} from "../src/lib/gpt02-google-session-status.mjs";
import {hasRecentVerifiedGpt02DevGoogleOperator as admit} from "../src/lib/gpt02-google-auth-gate.mjs";
const now=1_800_000_000_000;
const env={NODE_ENV:"development",APP_ENV:"development",
  SESSION_SECRET:"synthetic-unit-only-long-secret-never-used-live"};
const user={id:"synthetic-account",email:"test@example.invalid",role:"super_admin",
  authSource:"supabase_google_identity",
  authSupabaseId:"11111111-1111-4111-8111-111111111111",
  authVerifiedAt:now-5000};

test("fresh signed Google proof status matches existing admission; it never grants execution",()=>{
 assert.equal(admit(user,env,now),true);
 assert.equal(status(user,env,now),"SIGNED_SESSION_GOOGLE_PROOF_FRESH");
});
test("legacy role-only signed app session is distinguishable from expired Google proof",()=>{
 for(const u of [
  {...user,authSource:undefined,authSupabaseId:undefined,authVerifiedAt:undefined},
  {...user,authSource:"passwordless_email"},
  {...user,authSupabaseId:undefined},
  {...user,authSupabaseId:"not-uuid"},
 ]){
  assert.equal(admit(u,env,now),false);
  assert.equal(status(u,env,now),"SIGNED_SESSION_GOOGLE_CLAIMS_ABSENT");
 }
});
test("expired but valid signed Google provenance is distinct, including multi-hour proof",()=>{
 for(const elapsed of [600001,15*60000,7*86400000]){
  const u={...user,authVerifiedAt:now-elapsed};
  assert.equal(admit(u,env,now),false);
  assert.equal(status(u,env,now),"SIGNED_SESSION_GOOGLE_PROOF_EXPIRED");
 }
});
test("invalid or future timestamps remain nonauthorizing",()=>{
 for(const time of ["now",null,undefined,NaN,Infinity,now+31000]){
  const u={...user,authVerifiedAt:time};
  assert.equal(admit(u,env,now),false);
  assert.equal(status(u,env,now),"SIGNED_SESSION_GOOGLE_PROOF_INVALID");
 }
});
test("wrong runtime, unsafe secret or non-admin do not disclose any identity",()=>{
 for(const patch of [{NODE_ENV:"production"},{APP_ENV:"production"},
   {SESSION_SECRET:"short"},{SESSION_SECRET:"fallback-secret-change-in-production"}]){
  assert.equal(status(user,{...env,...patch},now),"DEV_SESSION_GUARD_CONFIGURATION_UNAVAILABLE");
 }
 assert.equal(status({...user,role:"staff"},env,now),"SUPER_ADMIN_SESSION_REQUIRED");
});
test("read-only backend route never extracts or returns secrets, IDs, dates or permissions",()=>{
 const source=readFileSync(new URL("../src/routes/auth.ts",import.meta.url),"utf8");
 const start=source.indexOf('router.get("/auth/gpt02/operator-session-readiness"');
 const end=source.indexOf("// ───────────────────────────────────────────────────────────────────────────────",start);
 assert.ok(start>0&&end>start);
 const route=source.slice(start,end);
 assert.match(route,/classifyExistingGpt02GoogleAppSession\(req\.user\)/);
 assert.match(route,/googleProofStatus,/);
 assert.match(route,/Cache-Control", "no-store"/);
 for(const forbidden of ["req.user.email","req.user.id","req.user.authSupabaseId",
 "req.user.authVerifiedAt","db.insert(","db.update(","db.delete(","db.transaction(",
 "accessToken","jwt.sign","signToken","fetch(","dispatch(","issueLease("])
   assert.ok(!route.includes(forbidden),forbidden);
 for(const required of ["readOnly: true","operatorApprovalRecorded: false",
 "commandBoundConsentVerified: false","issuerLeaseGranted: false",
 "dispatchPermitted: false","resumePermitted: false","statusChanged: false"])
   assert.ok(route.includes(required),required);
});
test("Task detail shows distinct fail-closed reasons without a new login or approval workflow",()=>{
 const ui=readFileSync(new URL("../../ai-task-center/src/pages/ai-task-detail.tsx",import.meta.url),"utf8");
 for(const phrase of ["gpt02-google-proof-missing","gpt02-google-proof-expired",
 "gpt02-google-proof-invalid","gpt02-google-proof-config-block",
 "Sesi aplikasi belum memiliki klaim bukti Google","Login baru diperlukan hanya ketika hendak menugaskan PIC"])
  assert.ok(ui.includes(phrase),phrase);
 assert.ok(ui.includes('queryFn:()=>apiFetch("/auth/gpt02/operator-session-readiness")'));
});
