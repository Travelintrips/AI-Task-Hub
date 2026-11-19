import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  hasRecentGoogleVerifiedVpsSession as verified,
  recentGoogleOAuthEvidenceAt as oauthEvidenceAt,
} from "../../artifacts/api-server/src/lib/vps-storage-google-session.ts";

const now = 1_795_000_000_000;
const trustedId = "aabbbbbb-2222-4333-8444-555555555555";
const outsiderId = "cccccccc-2222-4333-8444-555555555555";
const env = Object.freeze({
  NODE_ENV: "development",
  APP_ENV: "development",
  VPS_STORAGE_INVENTORY_READONLY_ENABLED: "true",
  VPS_STORAGE_TRUSTED_GOOGLE_AUTH_USER_IDS: trustedId,
  SESSION_SECRET: "offline-synthetic-secret-only-".repeat(2),
});
const admin = Object.freeze({
  id: 42,
  email: "offline@example.invalid",
  companyId: "default",
  name: "Synthetic only",
  role: "super_admin",
  authSource: "supabase_google_identity",
  authSupabaseId: trustedId,
  authVerifiedAt: now - 3000,
});

test("recent independently verified OAuth proof and host-bound auth UID are required", () => {
  assert.equal(verified(admin, env, now), true);
  for (const patch of [
    { authSource: undefined },
    { authSource: "email" },
    { role: "staff" },
    { role: "company_admin" },
    { authSupabaseId: outsiderId },
    { authSupabaseId: undefined },
  ]) {
    assert.equal(verified({ ...admin, ...patch }, env, now), false);
  }
  assert.equal(verified(undefined, env, now), false);
});

test("passwordless admins cannot create an accepted provider UID via the users table", () => {
  assert.equal(verified({ ...admin, id: 99999, email: "new-admin@example.invalid",
    authSupabaseId: outsiderId }, env, now), false);
  assert.equal(verified(admin, { ...env, VPS_STORAGE_TRUSTED_GOOGLE_AUTH_USER_IDS: "" }, now), false);
  assert.equal(verified(admin, { ...env, VPS_STORAGE_TRUSTED_GOOGLE_AUTH_USER_IDS: outsiderId }, now), false);
  assert.equal(verified(admin, { ...env, VPS_STORAGE_TRUSTED_GOOGLE_AUTH_USER_IDS: "not-a-uuid" }, now), false);
  assert.equal(verified(admin, { ...env, VPS_STORAGE_TRUSTED_GOOGLE_AUTH_USER_IDS: trustedId+","+outsiderId }, now), true);
});

test("Google OAuth identity and JWT authentication method must refer to the same recent event", () => {
  const authTime = Math.floor(now / 1000) - 10;
  const validAmr = [{ method: "oauth", timestamp: authTime }];
  const googleSignIn = new Date(now - 12_000).toISOString();
  const validIdentities = [{ provider: "google", last_sign_in_at: googleSignIn }];
  const identityProviders = ["google"];
  assert.equal(oauthEvidenceAt(validAmr, validIdentities, identityProviders, now), now - 12_000);
  assert.equal(oauthEvidenceAt([{ method: "password", timestamp: authTime }], validIdentities, identityProviders, now), null);
  assert.equal(oauthEvidenceAt([{ method: "token_refresh", timestamp: authTime }], validIdentities, identityProviders, now), null);
  assert.equal(oauthEvidenceAt(validAmr, validIdentities, ["google", "github"], now), null);
  assert.equal(oauthEvidenceAt(validAmr, [...validIdentities, { provider: "github", last_sign_in_at: googleSignIn }], ["google", "github"], now), null);
  assert.equal(oauthEvidenceAt(validAmr, [{ provider: "email", last_sign_in_at: googleSignIn }], identityProviders, now), null);
  assert.equal(oauthEvidenceAt(validAmr, [{ provider: "google", last_sign_in_at: new Date(now - 610_000).toISOString() }], identityProviders, now), null);
  assert.equal(oauthEvidenceAt(validAmr, [{ provider: "google", last_sign_in_at: new Date(now - 200_000).toISOString() }], identityProviders, now), null);
  assert.equal(oauthEvidenceAt([{ method: "oauth", timestamp: authTime - 660 }], validIdentities, identityProviders, now), null);
  assert.equal(oauthEvidenceAt(validAmr, undefined, identityProviders, now), null);
  assert.equal(oauthEvidenceAt([{ method: "oauth" }], validIdentities, identityProviders, now), null);
});

test("expiry, malformed timestamp and weak app signing secret all fail closed", () => {
  for (const stamp of [now - 600_001, now + 30_001, "now", undefined, null, NaN, Infinity, -1]) {
    assert.equal(verified({ ...admin, authVerifiedAt: stamp }, env, now), false);
  }
  assert.equal(verified({ ...admin, authVerifiedAt: now - 600_000 }, env, now), true);
  for (const patch of [
    { NODE_ENV: "production" }, { APP_ENV: "production" },
    { VPS_STORAGE_INVENTORY_READONLY_ENABLED: "false" },
    { VPS_STORAGE_INVENTORY_READONLY_ENABLED: undefined },
    { SESSION_SECRET: "" },
    { SESSION_SECRET: "fallback-secret-change-in-production" },
  ]) {
    assert.equal(verified(admin, { ...env, ...patch }, now), false);
  }
});

test("only verified Supabase Google exchange may mint limited application JWT claim", () => {
  const auth = readFileSync("artifacts/api-server/src/routes/auth.ts", "utf8");
  const login = auth.split('router.post("/auth/login"')[1].split('router.get("/auth/google/start"')[0];
  const google = auth.split('router.post("/auth/google"')[1].split("// GPT02 operator identity READINESS")[0];
  assert.ok(!login.includes("supabase_google_identity"));
  assert.ok(!login.includes("authVerifiedAt"));
  assert.ok(!login.includes("authSupabaseId"));
  assert.ok(google.includes("supabase.auth.getUser(accessToken)"));
  assert.ok(google.includes("email_confirmed_at"));
  assert.ok(google.includes("hasGoogleIdentity"));
  assert.ok(google.includes("jwt.decode(accessToken)"));
  assert.ok(google.includes("recentGoogleOAuthEvidenceAt("));
  assert.ok(google.includes('registeredUser.role === "super_admin" && verifiedGoogleOAuthAt !== null'));
  assert.ok(google.includes("authSupabaseId: authUser.id"));
});

test("inventory rechecks active matching DEV account and remains GET-only", () => {
  const route = readFileSync("artifacts/api-server/src/routes/vps-storage.ts", "utf8");
  assert.ok(route.includes("hasRecentGoogleVerifiedVpsSession(req.user)"));
  const reader = readFileSync("artifacts/api-server/src/lib/vps-storage-readonly-db.ts", "utf8");
  assert.ok(route.includes("readActiveVpsSuperAdmin(req.user)"));
  assert.ok(reader.includes("AND role = 'super_admin' AND is_active IS TRUE AND status = 'active'"));
  assert.ok(reader.includes("lower(btrim(email)) = $2::text"));
  assert.ok(reader.includes("COALESCE(company_id::text, '@NULL@') = $3::text"));
  assert.ok(reader.includes("BEGIN READ ONLY"));
  for (const method of ["post", "put", "patch", "delete"]) {
    assert.ok(!route.includes("router."+method+"("));
  }
});


test("Supabase identity last-sign-in staleness: AMR + identity.updated_at + user.last_sign_in_at must agree", () => {
  const amrAt = now - 10_000;
  const amr = [{method: "oauth",timestamp: amrAt/1000}];
  const oldGoogleLogin = new Date(now - 90 * 24 * 60 * 60_000).toISOString();
  const identityUpdated = new Date(now - 11_000).toISOString();
  const userSignedIn = new Date(now - 12_000).toISOString();
  const providerIdentities = [{
    provider:"google",last_sign_in_at:oldGoogleLogin,updated_at:identityUpdated,
  }];
  // An actual hosted condition: a many-month-old identities.last_sign_in_at,
  // even though the signed OAuth AMR and SERVER-OWNED update/sign-in evidence
  // are newly synchronized. This cannot be achieved by changing user_metadata.
  assert.equal(oauthEvidenceAt(amr,providerIdentities,["google"],now,userSignedIn), now - 12_000);

  for (const [label,identities,userTime] of [
    ["missing user proof",providerIdentities,undefined],
    ["missing updated_at",[{provider:"google",last_sign_in_at:oldGoogleLogin}],userSignedIn],
    ["old identity update",[{...providerIdentities[0],updated_at:new Date(now-12*60_000).toISOString()}],userSignedIn],
    ["old user sign-in",providerIdentities,new Date(now-12*60_000).toISOString()],
    ["oauth time diverges from identity update",[{...providerIdentities[0],updated_at:new Date(now-170_000).toISOString()}],userSignedIn],
    ["user sign-in diverges from identity update",providerIdentities,new Date(now-180_000).toISOString()],
    ["future identity update",[{...providerIdentities[0],updated_at:new Date(now+31_000).toISOString()}],userSignedIn],
    ["malformed timestamp",[{...providerIdentities[0],updated_at:"not-a-date"}],userSignedIn],
    ["duplicate Google identity",[...providerIdentities,...providerIdentities],userSignedIn],
    ["wrong sole provider",[{...providerIdentities[0],provider:"github"}],userSignedIn],
  ]) {
    assert.equal(oauthEvidenceAt(amr,identities,["google"],now,userTime),null,label);
  }
  assert.equal(oauthEvidenceAt([{method:"password",timestamp:amrAt/1000}],providerIdentities,["google"],now,userSignedIn),null);
  assert.equal(oauthEvidenceAt([{method:"token_refresh",timestamp:amrAt/1000}],providerIdentities,["google"],now,userSignedIn),null);
  assert.equal(oauthEvidenceAt(amr,providerIdentities,["google","github"],now,userSignedIn),null);
  assert.equal(oauthEvidenceAt([{method:"oauth",timestamp:Math.floor((now-15*60_000)/1000)}],
    providerIdentities,["google"],now,userSignedIn),null);
});

test("fresh but mismatched identities.last_sign_in_at must not be bypassed by fallback",()=>{
  const amrAt = now-10_000;
  const amr=[{method:"oauth",timestamp:amrAt/1000}];
  const identities=[{
    provider:"google",
    last_sign_in_at:new Date(now-300_000).toISOString(),
    updated_at:new Date(now-10_000).toISOString(),
  }];
  assert.equal(oauthEvidenceAt(amr,identities,["google"],now,new Date(now-10_000).toISOString()),null);
});

test("Google login route passes trusted getUser.last_sign_in_at as a separate proof input",()=>{
  const code=readFileSync("artifacts/api-server/src/routes/auth.ts","utf8");
  const google=code.split('router.post("/auth/google"')[1].split("// GPT02 operator identity READINESS")[0];
  assert.match(google,/supabase\.auth\.getUser\(accessToken\)/);
  assert.match(google,/authMethods, authUser\.identities, linkedProviders, Date\.now\(\),\s*authUser\.last_sign_in_at/);
  assert.match(google,/registeredUser\.role === "super_admin" && verifiedGoogleOAuthAt !== null/);
  assert.doesNotMatch(google,/authUser\.user_metadata\?\.last_sign_in_at/);
});
