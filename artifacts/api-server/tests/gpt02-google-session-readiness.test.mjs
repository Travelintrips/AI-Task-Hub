import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const auth=readFileSync(new URL("../src/routes/auth.ts",import.meta.url),"utf8");
const ui=readFileSync(new URL("../../ai-task-center/src/pages/ai-task-detail.tsx",import.meta.url),"utf8");

function currentRoute(){
 const begin=auth.indexOf('router.get("/auth/gpt02/operator-session-readiness"');
 const end=auth.indexOf('// ───────────────────────────────────────────────────────────────────────────────',begin);
 assert.ok(begin>0 && end>begin);
 return auth.slice(begin,end);
}
test("DEV Google-session status requires existing app auth, no new raw access token",()=>{
 const r=currentRoute();
 assert.match(r,/requireAuth/);
 assert.match(r,/NODE_ENV !== "development"/);
 assert.match(r,/APP_ENV !== "development"/);
 assert.match(r,/req\.user\?\.role !== "super_admin"/);
 assert.match(r,/hasRecentVerifiedGpt02DevGoogleOperator\(req\.user\)/);
 assert.match(r,/Cache-Control", "no-store"/);
 assert.doesNotMatch(r,/accessToken|req\.body|req\.query|auth\.getUser|jwt\.sign|signToken/);
});
test("Google session status does not issue approvals, modify data or dispatch",()=>{
 const r=currentRoute();
 for(const p of ["db.select(","db.update(","db.insert(","db.delete(","db.transaction(",
   "supabase.auth.","fetch(","scheduleExecutionTracking(","dispatch(","issueLease("])
   assert.equal(r.includes(p),false,p);
 for(const p of [
  "readOnly: true","operatorApprovalRecorded: false","commandBoundConsentVerified: false",
  "issuerLeaseGranted: false","dispatchPermitted: false","resumePermitted: false",
  "statusChanged: false"
 ])assert.ok(r.includes(p),p);
});
test("response returns only booleans and labels, not Google account identifiers",()=>{
 const r=currentRoute();
 assert.match(r,/googleProofFresh,/);
 assert.match(r,/requiresFreshGoogleLogin: !googleProofFresh/);
 assert.match(r,/proofSource: "signed_app_session"/);
 assert.doesNotMatch(r,/req\.user\.(?:email|id|authSupabaseId|authVerifiedAt)/);
});
test("Task171 UI uses existing apiFetch JWT locally but displays no token, approval or dispatch",()=>{
 assert.match(ui,/queryKey:\["gpt02-google-session-readiness",id\]/);
 assert.match(ui,/queryFn:\(\)=>apiFetch\("\/auth\/gpt02\/operator-session-readiness"\)/);
 assert.match(ui,/enabled:currentUser\?\.role==="super_admin"/);
 assert.match(ui,/data-testid="gpt02-google-session-readiness"/);
 assert.match(ui,/Bukti Google baru belum terverifikasi/);
 assert.match(ui,/Hasil ini bukan persetujuan operator/);
 assert.match(ui,/Periksa bukti sesi Google/);
});
