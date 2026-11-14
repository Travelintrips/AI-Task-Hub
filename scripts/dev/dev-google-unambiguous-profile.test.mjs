import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { selectUniqueActiveGoogleDevProfile } from "../../artifacts/api-server/src/lib/google-dev-profile-match.ts";

const source = readFileSync(
  new URL("../../artifacts/api-server/src/routes/auth.ts", import.meta.url), "utf8",
);
const devGoogle = source.split('router.post("/auth/google"')[1]
  .split("// GPT02 operator identity READINESS")[0];

const active = Object.freeze({
  id: "11111111-1111-4111-8111-111111111111",
  role: "super_admin", companyId: null,
  isActive: true, loginStatus: "active",
});
test("zero or multiple normalized-email matches fail closed; never pick first Super Admin", () => {
  assert.equal(selectUniqueActiveGoogleDevProfile([]), null);
  assert.equal(selectUniqueActiveGoogleDevProfile([active, {
    ...active, id: "22222222-2222-4222-8222-222222222222", role: "staff",
  }]), null);
});
test("one active profile succeeds without coercing the CST-DEV TEXT ID or nullable company", () => {
  assert.equal(selectUniqueActiveGoogleDevProfile([active]), active);
  assert.equal(typeof active.id, "string");
  assert.equal(active.companyId, null);
});
test("blocked status or inactive account is denied even with a unique verified email", () => {
  assert.equal(selectUniqueActiveGoogleDevProfile([{ ...active, isActive: false }]), null);
  assert.equal(selectUniqueActiveGoogleDevProfile([{ ...active, isActive: null }]), null);
  assert.equal(selectUniqueActiveGoogleDevProfile([{ ...active, loginStatus: "suspended" }]), null);
  assert.equal(selectUniqueActiveGoogleDevProfile([{ ...active, loginStatus: null }]), null);
});
test("DEV Google token exchange uses normalized parameterized email, checks two matches, status and uniqueness", () => {
  assert.match(devGoogle, /supabase\.auth\.getUser\(accessToken\)/);
  assert.match(devGoogle, /lower\(btrim\(\$\{usersTable\.email\}\)\) = \$\{email\}/);
  assert.match(devGoogle, /loginStatus: sql<string>/);
  assert.match(devGoogle, /\.limit\(2\)/);
  assert.match(devGoogle, /selectUniqueActiveGoogleDevProfile\(matchingProfiles\)/);
  assert.ok(devGoogle.indexOf("selectUniqueActiveGoogleDevProfile") <
    devGoogle.indexOf("const token = signToken"));
  assert.match(devGoogle, /const \{ loginStatus: _loginStatus, \.\.\.registeredUser \} = uniqueProfile/);
});
test("existing DEV passwordless route and PROD Google claims remain unchanged", () => {
  const passwordless = source.split('router.post("/auth/login"')[1]
    .split('router.get("/auth/google/start"')[0];
  assert.match(source, /process\.env\.DEV_PASSWORDLESS_LOGIN === "true"/);
  assert.match(passwordless, /!devPasswordlessLoginEnabled/);
  assert.match(source, /const metadata = authUser\.app_metadata \?\? \{\}/);
  assert.match(source, /registeredUser\.role === "super_admin" && verifiedGoogleOAuthAt !== null/);
});
