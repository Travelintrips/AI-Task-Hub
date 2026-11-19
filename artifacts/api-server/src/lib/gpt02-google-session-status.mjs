/**
 * DEV-only nonsecret diagnostics for the EXISTING signed app JWT.
 * The existing operator admission is unchanged and remains the authority.
 * Neither this helper nor its caller performs OAuth, authorizes a command,
 * writes data, refreshes a token, or returns a timestamp/account identifier.
 */
import { hasRecentVerifiedGpt02DevGoogleOperator } from "./gpt02-google-auth-gate.mjs";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_AGE_MS=10*60_000;

export function classifyExistingGpt02GoogleAppSession(user,env=process.env,nowMs=Date.now()) {
  if(hasRecentVerifiedGpt02DevGoogleOperator(user,env,nowMs))
    return "SIGNED_SESSION_GOOGLE_PROOF_FRESH";
  if(env?.NODE_ENV!=="development"||env?.APP_ENV!=="development"||
      typeof env?.SESSION_SECRET!=="string"||env.SESSION_SECRET.length<32||
      env.SESSION_SECRET==="fallback-secret-change-in-production")
    return "DEV_SESSION_GUARD_CONFIGURATION_UNAVAILABLE";
  if(!user||user.role!=="super_admin")
    return "SUPER_ADMIN_SESSION_REQUIRED";
  if(user.authSource!=="supabase_google_identity"||
      typeof user.authSupabaseId!=="string"||
      !UUID.test(user.authSupabaseId))
    return "SIGNED_SESSION_GOOGLE_CLAIMS_ABSENT";
  if(!Number.isSafeInteger(user.authVerifiedAt)||!Number.isSafeInteger(nowMs))
    return "SIGNED_SESSION_GOOGLE_PROOF_INVALID";
  const age=nowMs-user.authVerifiedAt;
  if(age>MAX_AGE_MS)
    return "SIGNED_SESSION_GOOGLE_PROOF_EXPIRED";
  return "SIGNED_SESSION_GOOGLE_PROOF_INVALID";
}
