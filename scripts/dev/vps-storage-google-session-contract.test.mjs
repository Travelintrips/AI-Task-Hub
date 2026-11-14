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
  assert.ok(route.includes("usersTable.isActive"));
  assert.ok(route.includes('activeAdmin.role !== "super_admin"'));
  assert.ok(route.includes("activeAdmin.email.trim().toLowerCase()"));
  assert.ok(route.includes("activeAdmin.companyId"));
  for (const method of ["post", "put", "patch", "delete"]) {
    assert.ok(!route.includes("router."+method+"("));
  }
});
