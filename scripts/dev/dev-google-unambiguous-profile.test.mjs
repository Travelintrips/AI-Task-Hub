import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  selectUniqueActiveGoogleDevProfile,
  trustedGoogleDevProfilePin,
  profileMatchesTrustedGoogleDevPin,
} from "../../artifacts/api-server/src/lib/google-dev-profile-match.ts";

const source = readFileSync(
  new URL("../../artifacts/api-server/src/routes/auth.ts", import.meta.url), "utf8",
);
const devGoogle = source.split('router.post("/auth/google"')[1]
  .split("// GPT02 operator identity READINESS")[0];

const roles = ["super_admin", "company_admin", "owner", "supervisor", "staff", "vendor", "customer"];
const active = Object.freeze({
  id: "11111111-1111-4111-8111-111111111111",
  role: "super_admin", companyId: null,
  isActive: true, loginStatus: "active",
});
test("zero or multiple normalized-email matches fail closed; never pick first Super Admin", () => {
  assert.equal(selectUniqueActiveGoogleDevProfile([], roles), null);
  assert.equal(selectUniqueActiveGoogleDevProfile([active, {
    ...active, id: "22222222-2222-4222-8222-222222222222", role: "staff",
  }], roles), null);
});
test("one active profile succeeds without coercing the CST-DEV TEXT ID or nullable company", () => {
  assert.equal(selectUniqueActiveGoogleDevProfile([active], roles), active);
  assert.equal(typeof active.id, "string");
  assert.equal(active.companyId, null);
});
test("unique legacy admin keeps existing DEV Google login behavior without new privileges", () => {
  assert.equal(selectUniqueActiveGoogleDevProfile([{ ...active, role: "admin" }], roles)?.role, "admin");
  assert.equal(selectUniqueActiveGoogleDevProfile([{ ...active, role: "staff" }], roles)?.role, "staff");
  assert.equal(selectUniqueActiveGoogleDevProfile([{ ...active, role: "unrecognized" }], roles), null);
  assert.equal(selectUniqueActiveGoogleDevProfile([{ ...active, role: "admin" }, active], roles), null);
  assert.equal(trustedGoogleDevProfilePin({
    ai_task_user_id: active.id, ai_task_role: "admin", ai_task_company_id: "@NULL@",
  }, roles), "invalid");
});
test("blocked status or inactive account is denied even with a unique verified email", () => {
  assert.equal(selectUniqueActiveGoogleDevProfile([{ ...active, isActive: false }], roles), null);
  assert.equal(selectUniqueActiveGoogleDevProfile([{ ...active, isActive: null }], roles), null);
  assert.equal(selectUniqueActiveGoogleDevProfile([{ ...active, loginStatus: "suspended" }], roles), null);
  assert.equal(selectUniqueActiveGoogleDevProfile([{ ...active, loginStatus: null }], roles), null);
});
test("DEV Google token exchange uses normalized parameterized email, checks two matches, status and uniqueness", () => {
  assert.match(devGoogle, /supabase\.auth\.getUser\(accessToken\)/);
  assert.match(devGoogle, /lower\(btrim\(\$\{usersTable\.email\}\)\) = \$\{email\}/);
  assert.match(devGoogle, /loginStatus: sql<string>/);
  assert.match(devGoogle, /\.limit\(2\)/);
  assert.match(devGoogle, /selectUniqueActiveGoogleDevProfile\(matchingProfiles, USER_ROLES\)/);
  assert.ok(devGoogle.indexOf("selectUniqueActiveGoogleDevProfile") <
    devGoogle.indexOf("const token = signToken"));
  assert.match(devGoogle, /const \{ loginStatus: _loginStatus, \.\.\.registeredUser \} = uniqueProfile/);
});
test("DEV rejects email-only JWT while PROD Google metadata claims stay unchanged", () => {
  const login = source.split('router.post("/auth/login"')[1]
    .split('router.get("/auth/google/start"')[0];
  assert.match(source, /process\.env\.DEV_PASSWORDLESS_LOGIN === "true"/);
  assert.match(login, /if \(devPasswordlessLoginEnabled\) \{\s*res\.status\(403\)/);
  assert.match(login, /Verified Google login required on DEV/);
  assert.ok(login.indexOf("if (devPasswordlessLoginEnabled)") < login.indexOf("const { email, password }"),
    "do not parse identity or access DB before denying email-only");
  assert.ok(login.indexOf("if (devPasswordlessLoginEnabled)") < login.indexOf("const token = signToken"));
  assert.match(login, /bcrypt\.compare\(password, user\.passwordHash\)/);
  assert.match(source, /const metadata = authUser\.app_metadata \?\? \{\}/);
  assert.match(source, /registeredUser\.role === "super_admin" && verifiedGoogleOAuthAt !== null/);
});

test("binding is absent by default and any partial or malformed metadata is invalid", () => {
  assert.equal(trustedGoogleDevProfilePin({ provider: "google" }, roles), "absent");
  assert.equal(trustedGoogleDevProfilePin(undefined, roles), "absent");
  assert.equal(trustedGoogleDevProfilePin({ ai_task_user_id: active.id }, roles), "invalid");
  assert.equal(trustedGoogleDevProfilePin({ ai_task_user_id: active.id, ai_task_role: "super_admin" }, roles), "invalid");
  assert.equal(trustedGoogleDevProfilePin({ ai_task_user_id: active.id, ai_task_role: "admin", ai_task_company_id: "@NULL@" }, roles), "invalid");
  assert.equal(trustedGoogleDevProfilePin({ ai_task_user_id: "../bad-path", ai_task_role: "super_admin", ai_task_company_id: "@NULL@" }, roles), "invalid");
  assert.equal(trustedGoogleDevProfilePin({ ai_task_user_id: active.id, ai_task_role: "super_admin", ai_task_company_id: "default" }, roles), "invalid");
});
test("trusted app_metadata can bind exactly matching ID, role and nullable company", () => {
  const pin = trustedGoogleDevProfilePin({ provider: "google", ai_task_user_id: active.id, ai_task_role: "super_admin", ai_task_company_id: "@NULL@" }, roles);
  assert.notEqual(pin, "absent");
  assert.notEqual(pin, "invalid");
  assert.equal(profileMatchesTrustedGoogleDevPin(active, pin), true);
  assert.equal(profileMatchesTrustedGoogleDevPin({ ...active, id: "another-id" }, pin), false);
  assert.equal(profileMatchesTrustedGoogleDevPin({ ...active, role: "staff" }, pin), false);
  assert.equal(profileMatchesTrustedGoogleDevPin({ ...active, companyId: 2 }, pin), false);
  assert.equal(profileMatchesTrustedGoogleDevPin(null, pin), false);
});
test("pinned integer company cannot silently become nullable company", () => {
  const pin = trustedGoogleDevProfilePin({ ai_task_user_id: active.id, ai_task_role: "super_admin", ai_task_company_id: "2" }, roles);
  assert.notEqual(pin, "invalid");
  assert.notEqual(pin, "absent");
  assert.equal(profileMatchesTrustedGoogleDevPin({ ...active, companyId: 2 }, pin), true);
  assert.equal(profileMatchesTrustedGoogleDevPin(active, pin), false);
});
test("duplicate lookup uses only verified Auth Admin metadata and exact TEXT row before JWT", () => {
  assert.match(devGoogle, /trustedGoogleDevProfilePin\(authUser\.app_metadata, USER_ROLES\)/);
  assert.match(devGoogle, /if \(pin === "invalid"\)/);
  assert.match(devGoogle, /if \(matchingProfiles\.length > 1\)/);
  assert.match(devGoogle, /\$\{usersTable\.id\}::text = \$\{pin\.id\}/);
  assert.match(devGoogle, /selectUniqueActiveGoogleDevProfile\(pinnedProfiles, USER_ROLES\)/);
  assert.match(devGoogle, /profileMatchesTrustedGoogleDevPin\(uniqueProfile, pin\)/);
  assert.ok(devGoogle.indexOf("profileMatchesTrustedGoogleDevPin(uniqueProfile, pin)") < devGoogle.indexOf("const token = signToken"));
  assert.doesNotMatch(devGoogle, /authUser\.user_metadata\.ai_task_user_id/);
});
