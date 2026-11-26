/**
 * Genuine Google-verified App JWT admission for high-impact GPT02 DEV writes.
 *
 * Older dashboard JWTs minted by DEV email-only login lack these claims.
 * Do not infer authorization from role, source email, or a linked Google
 * provider alone. Google auth proof is minted only by the existing Supabase
 * Auth exchange after its checked AMR + current identity sign-in evidence.
 *
 * This is step-up identity ONLY; never grants GPT02 operator command approval,
 * a nonce, issuer lease, dispatch, resume or Core Task creation.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const GPT02_GOOGLE_OPERATOR_MAX_AGE_MS = 10 * 60_000;

export function hasRecentVerifiedGpt02DevGoogleOperator(
  user, env = process.env, nowMs = Date.now()
) {
  if (env?.NODE_ENV !== "development" || env?.APP_ENV !== "development")
    return false;
  if (typeof env.SESSION_SECRET !== "string" ||
      env.SESSION_SECRET.length < 32 ||
      env.SESSION_SECRET === "fallback-secret-change-in-production")
    return false;

  if (!user || user.role !== "super_admin" ||
      user.authSource !== "supabase_google_identity")
    return false;
  if ((typeof user.id !== "number" && typeof user.id !== "string") ||
      !String(user.id).trim() ||
      typeof user.email !== "string" ||
      !/^[^@\s]+@[^@\s]+$/.test(user.email.trim()))
    return false;
  if (typeof user.authSupabaseId !== "string" ||
      !UUID.test(user.authSupabaseId))
    return false;
  if (!Number.isSafeInteger(user.authVerifiedAt) ||
      !Number.isSafeInteger(nowMs))
    return false;
  const age = nowMs - user.authVerifiedAt;
  return age >= -30_000 && age <= GPT02_GOOGLE_OPERATOR_MAX_AGE_MS;
}

export function preparationReadinessForOperator(serviceReason, user, env = process.env, nowMs = Date.now()) {
  if (serviceReason !== "READY_FOR_PREPARATION_ONLY") {
    return { reason: serviceReason, canRequestPreparation: false };
  }
  if (!hasRecentVerifiedGpt02DevGoogleOperator(user, env, nowMs)) {
    return { reason: "GPT02_FRESH_GOOGLE_OPERATOR_REQUIRED", canRequestPreparation: false };
  }
  return { reason: serviceReason, canRequestPreparation: true };
}
