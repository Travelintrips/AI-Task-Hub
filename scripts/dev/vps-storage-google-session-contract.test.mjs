import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  hasRecentGoogleVerifiedVpsSession as verified,
  recentGoogleOAuthEvidenceAt as oauthEvidenceAt,
} from "../../artifacts/api-server/src/lib/vps-storage-google-session.ts";

const now = 1_795_000_000_000;
const env = Object.freeze({
  NODE_ENV: "development",
  APP_ENV: "development",
  VPS_STORAGE_INVENTORY_READONLY_ENABLED: "true",
  SESSION_SECRET: "offline-synthetic-secret-only-".repeat(2),
});
const admin = Object.freeze({
  id: 42,
  email: "offline@example.invalid",
  companyId: "default",
  name: "Synthetic only",
  role: "super_admin",
  authSource: "supabase_google_identity",
  authVerifiedAt: now - 3000,
});

test("only recent independently verified provider-origin JWT can pass the initial gate", () => {
  assert.equal(verified(admin, env, now), true);
  assert.equal(verified({ ...admin, authSource: undefined }, env, now), false);
  assert.equal(verified({ ...admin, authSource: "email" }, env, now), false);
  assert.equal(verified({ ...admin, role: "company_admin" }, env, now), false);
  assert.equal(verified({ ...admin, role: "staff" }, env, now), false);
  assert.equal(verified(undefined, env, now), false);
});

test("a linked Google identity is insufficient without recent Google OAuth use", () => {
  const authTime = Math.floor(now / 1000) - 10;
  const validAmr = [{ method: "oauth", timestamp: authTime }];
  const validIdentities = [{ provider: "google", last_sign_in_at: new Date(now - 12_000).toISOString() }];
  assert.equal(oauthEvidenceAt(validAmr, validIdentities, now), now - 12_000);
  assert.equal(oauthEvidenceAt([{ method: "password", timestamp: authTime }], validIdentities, now), null);
  assert.equal(oauthEvidenceAt([{ method: "token_refresh", timestamp: authTime }], validIdentities, now), null);
  assert.equal(oauthEvidenceAt(validAmr, [{ provider: "email", last_sign_in_at: validIdentities[0].last_sign_in_at }], now), null);
  assert.equal(oauthEvidenceAt(validAmr, [{ provider: "google", last_sign_in_at: new Date(now - 610_000).toISOString() }], now), null);
  assert.equal(oauthEvidenceAt([{ method: "oauth", timestamp: authTime - 660 }], validIdentities, now), null);
  assert.equal(oauthEvidenceAt(validAmr, undefined, now), null);
  assert.equal(oauthEvidenceAt([{ method: "oauth" }], validIdentities, now), null);
});

test("expiry, clock skew and malformed timestamps fail closed", () => {
  for (const stamp of [now - 600_001, now + 30_001, "now", undefined, null, NaN, Infinity, -1]) {
    assert.equal(verified({ ...admin, authVerifiedAt: stamp }, env, now), false);
  }
  assert.equal(verified({ ...admin, authVerifiedAt: now - 600_000 }, env, now), true);
});

test("DEV environment, explicit flag and strong signing key are mandatory", () => {
  for (const patch of [
    { NODE_ENV: "production" },
    { APP_ENV: "production" },
    { VPS_STORAGE_INVENTORY_READONLY_ENABLED: "false" },
    { VPS_STORAGE_INVENTORY_READONLY_ENABLED: undefined },
    { SESSION_SECRET: "" },
    { SESSION_SECRET: "fallback-secret-change-in-production".slice(0, 20) },
    { SESSION_SECRET: "fallback-secret-change-in-production" },
  ]) {
    assert.equal(verified(admin, { ...env, ...patch }, now), false);
  }
});

test("Google proof can be signed only from the verified DEV OAuth account path", () => {
  const auth = readFileSync("artifacts/api-server/src/routes/auth.ts", "utf8");
  const login = auth.split('router.post("/auth/login"')[1].split('router.get("/auth/google/start"')[0];
  const google = auth.split('router.post("/auth/google"')[1].split("// GPT02 operator identity READINESS")[0];
  assert.doesNotMatch(login, /supabase_google_identity|authVerifiedAt/);
  assert.match(google, /supabase\.auth\.getUser\(accessToken\)/);
  assert.match(google, /email_confirmed_at/);
  assert.match(google, /hasGoogleIdentity/);
  assert.match(google, /registeredUser\.role === "super_admin"/);
  assert.match(google, /authSource: "supabase_google_identity"/);
  assert.match(google, /jwt\.decode\(accessToken\)/);
  assert.match(google, /recentGoogleOAuthEvidenceAt\(authMethods, authUser\.identities\)/);
  assert.match(google, /registeredUser\.role === "super_admin" && verifiedGoogleOAuthAt !== null/);
  assert.match(google, /authVerifiedAt: verifiedGoogleOAuthAt/);
});

test("inventory independently rechecks active matching DB identity and stays GET-only", () => {
  const route = readFileSync("artifacts/api-server/src/routes/vps-storage.ts", "utf8");
  assert.match(route, /hasRecentGoogleVerifiedVpsSession\(req\.user\)/);
  assert.match(route, /usersTable\.isActive/);
  assert.match(route, /activeAdmin\.role !== "super_admin"/);
  assert.match(route, /activeAdmin\.email\.trim\(\)\.toLowerCase\(\)/);
  assert.match(route, /activeAdmin\.companyId/);
  assert.doesNotMatch(route, /router\.(post|put|patch|delete)\(/i);
});
