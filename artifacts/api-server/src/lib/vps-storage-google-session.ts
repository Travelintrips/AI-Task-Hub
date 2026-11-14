import type { AuthUser } from "../middleware/auth";

const UTC_FRESHNESS_MS = 10 * 60_000;
const ALLOWED_IDENTITY_PROVIDERS = new Set(["email", "phone", "google"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * getUser(accessToken) must validate the same Supabase JWT before this
 * decoded AMR is inspected. A linked Google identity alone is insufficient:
 * there must be exactly one OAuth identity (Google), no other social provider,
 * and its trusted last-sign-in event must coincide with the JWT's latest AMR.
 * Returns the EARLIER original auth timestamp for the signed app proof.
 */
export function recentGoogleOAuthEvidenceAt(
  amr: unknown,
  identities: ReadonlyArray<{ provider?: unknown; last_sign_in_at?: unknown }> | undefined,
  linkedProviders: unknown,
  nowMs: number = Date.now(),
): number | null {
  if (!Array.isArray(amr) || amr.length === 0) return null;
  const latest = amr[0] as Record<string, unknown> | null;
  if (!latest || typeof latest !== "object" || latest.method !== "oauth" ||
      !Number.isSafeInteger(latest.timestamp)) return null;
  const amrAt = Number(latest.timestamp) * 1000;
  const amrAge = nowMs - amrAt;
  if (amrAge < -30_000 || amrAge > UTC_FRESHNESS_MS) return null;

  // provider lists from Supabase Auth app_metadata/identities, not user_metadata.
  if (!Array.isArray(linkedProviders) || !linkedProviders.includes("google") ||
      linkedProviders.some((provider: unknown) =>
        typeof provider !== "string" || !ALLOWED_IDENTITY_PROVIDERS.has(provider)))
    return null;
  if (!Array.isArray(identities) || identities.length === 0 ||
      identities.some((identity) =>
        typeof identity.provider !== "string" ||
        !ALLOWED_IDENTITY_PROVIDERS.has(identity.provider)))
    return null;

  const googleIdentities = identities.filter((i) => i.provider === "google");
  if (googleIdentities.length !== 1 ||
      typeof googleIdentities[0].last_sign_in_at !== "string") return null;

  const lastGoogleUse = Date.parse(googleIdentities[0].last_sign_in_at);
  const googleAge = nowMs - lastGoogleUse;
  if (!Number.isFinite(lastGoogleUse) ||
      googleAge < -30_000 || googleAge > UTC_FRESHNESS_MS) return null;
  if (Math.abs(amrAt - lastGoogleUse) > 90_000) return null;
  return Math.min(amrAt, lastGoogleUse, nowMs);
}

/** Stable Supabase Auth UID allowlist, host-controlled and independent of
 * public.users (which passwordless DEV dashboard admins can administer).
 * Missing/malformed config denies all inventory access.
 */
export function hasRecentGoogleVerifiedVpsSession(
  user: AuthUser | undefined,
  env: NodeJS.ProcessEnv = process.env,
  nowMs: number = Date.now(),
): boolean {
  if (env.NODE_ENV !== "development" || env.APP_ENV !== "development") return false;
  if (env.VPS_STORAGE_INVENTORY_READONLY_ENABLED !== "true") return false;
  if (typeof env.SESSION_SECRET !== "string" || env.SESSION_SECRET.length < 32 ||
      env.SESSION_SECRET === "fallback-secret-change-in-production") return false;
  if (user?.role !== "super_admin" ||
      user.authSource !== "supabase_google_identity") return false;

  const id = user.authSupabaseId?.trim().toLowerCase();
  if (!id || !UUID.test(id)) return false;
  const rawAllowed = env.VPS_STORAGE_TRUSTED_GOOGLE_AUTH_USER_IDS?.trim();
  if (!rawAllowed) return false;
  const allowed = rawAllowed.split(",").map((v) => v.trim().toLowerCase());
  if (allowed.length > 4 || allowed.some((v) => !UUID.test(v))) return false;
  if (!allowed.includes(id)) return false;

  const verifiedAt = user.authVerifiedAt;
  if (!Number.isSafeInteger(verifiedAt) || typeof verifiedAt !== "number") return false;
  return verifiedAt >= nowMs - UTC_FRESHNESS_MS && verifiedAt <= nowMs + 30_000;
}
