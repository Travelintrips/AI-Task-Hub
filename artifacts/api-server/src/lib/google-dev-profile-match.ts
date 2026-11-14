/**
 * DEV Google OAuth profile lookup is by the verified Supabase email, while
 * CST-DEV users.email is not unique after trim/lower. Fail closed instead of
 * choosing the first tenant / role on ambiguous identity. Does not change
 * ordinary passwordless login or production OAuth.
 */
export function selectUniqueActiveGoogleDevProfile<
  T extends { isActive: boolean | null; loginStatus: string | null; role: string },
>(matches: readonly T[], allowedRoles: readonly string[]): T | null {
  if (matches.length !== 1) return null;
  const profile = matches[0];
  // Preserve existing unique-email CST-DEV login for the legacy "admin"
  // role. It is NOT accepted as a privileged canonical pin or added to the
  // application's role hierarchy; duplicates still fail closed.
  const recognized = allowedRoles.includes(profile.role) || profile.role === "admin";
  return profile.isActive === true && profile.loginStatus === "active" &&
    recognized ? profile : null;
}

/**
 * Reuse existing PROD Auth Admin-owned app_metadata provenance. A pin is only
 * a candidate selector: the current DB row must also agree on ID, role,
 * company, email (at query time) and active status before issuing a JWT.
 * No user_metadata or automatic admin-role fallback is ever accepted.
 */
export type TrustedGoogleDevProfilePin = Readonly<{
  id: string; role: string; company: string;
}>;

const PROFILE_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const COMPANY_ID = /^(?:@NULL@|[0-9]+)$/;
const META_FIELDS = ["ai_task_user_id", "ai_task_role", "ai_task_company_id"];

export function trustedGoogleDevProfilePin(
  appMetadata: unknown, allowedRoles: readonly string[],
): TrustedGoogleDevProfilePin | "absent" | "invalid" {
  if (appMetadata === undefined || appMetadata === null) return "absent";
  if (typeof appMetadata !== "object" || Array.isArray(appMetadata)) return "invalid";
  const meta = appMetadata as Record<string, unknown>;
  const pinned = META_FIELDS.filter((key) =>
    Object.prototype.hasOwnProperty.call(meta, key));
  if (pinned.length === 0) return "absent";
  if (pinned.length !== META_FIELDS.length) return "invalid";
  const id = meta.ai_task_user_id;
  const role = meta.ai_task_role;
  const company = meta.ai_task_company_id;
  if (typeof id !== "string" || !PROFILE_ID.test(id) ||
      typeof role !== "string" || !allowedRoles.includes(role) ||
      typeof company !== "string" || !COMPANY_ID.test(company))
    return "invalid";
  return { id, role, company };
}

export function profileMatchesTrustedGoogleDevPin(
  profile: { id: string | number; role: string; companyId: unknown } | null,
  pin: TrustedGoogleDevProfilePin,
): boolean {
  if (!profile) return false;
  const actualCompany = profile.companyId == null
    ? "@NULL@" : String(profile.companyId);
  return String(profile.id) === pin.id &&
    profile.role === pin.role && actualCompany === pin.company;
}
