import type { AuthUser } from "../middleware/auth";

/**
 * This signed JWT marker is minted only after Supabase verifies a confirmed
 * account with a linked Google identity. It is not GPT02 operator approval.
 * The current database role/active status must also be checked by the caller.
 */
/**
 * Supabase getUser(accessToken) must have authenticated this same JWT before
 * the caller decodes its AMR claim. A linked Google identity by itself is not
 * evidence that the current session authenticated through Google.
 * Supabase documents AMR entries as newest first.
 */
export function recentGoogleOAuthEvidenceAt(
  amr: unknown,
  identities: ReadonlyArray<{ provider?: unknown; last_sign_in_at?: unknown }> | undefined,
  nowMs: number = Date.now(),
): number | null {
  if (!Array.isArray(amr) || amr.length === 0) return null;
  const latest = amr[0] as Record<string, unknown> | null;
  if (!latest || typeof latest !== "object" || latest.method !== "oauth" ||
      !Number.isSafeInteger(latest.timestamp)) return null;
  const amrAge = nowMs - Number(latest.timestamp) * 1000;
  if (amrAge < -30_000 || amrAge > 600_000) return null;
  const google = identities?.find((i) => i.provider === "google");
  if (!google || typeof google.last_sign_in_at !== "string") return null;
  const lastGoogleUse = Date.parse(google.last_sign_in_at);
  const googleAge = nowMs - lastGoogleUse;
  if (!Number.isFinite(lastGoogleUse) || googleAge < -30_000 || googleAge > 600_000) return null;
  // Bound the application JWT proof to the *earlier* underlying authentication
  // event, not the later local token exchange timestamp.
  return Math.min(Number(latest.timestamp) * 1000, lastGoogleUse, nowMs);
}

export function hasRecentGoogleVerifiedVpsSession(
  user: AuthUser | undefined,
  env: NodeJS.ProcessEnv = process.env,
  nowMs: number = Date.now(),
): boolean {
  if (env.NODE_ENV !== "development" || env.APP_ENV !== "development") return false;
  if (env.VPS_STORAGE_INVENTORY_READONLY_ENABLED !== "true") return false;
  if (typeof env.SESSION_SECRET !== "string" || env.SESSION_SECRET.length < 32 ||
      env.SESSION_SECRET === "fallback-secret-change-in-production") return false;
  if (user?.role !== "super_admin" || user.authSource !== "supabase_google_identity") return false;
  const verifiedAt = user.authVerifiedAt;
  if (!Number.isSafeInteger(verifiedAt) || typeof verifiedAt !== "number") return false;
  return verifiedAt >= nowMs - 10 * 60_000 && verifiedAt <= nowMs + 30_000;
}
