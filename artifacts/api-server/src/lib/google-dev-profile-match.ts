/**
 * DEV Google OAuth profile lookup is by the verified Supabase email, while
 * CST-DEV users.email is not unique after trim/lower. Fail closed instead of
 * choosing the first tenant / role on ambiguous identity. Does not change
 * ordinary passwordless login or production OAuth.
 */
export function selectUniqueActiveGoogleDevProfile<
  T extends { isActive: boolean | null; loginStatus: string | null },
>(matches: readonly T[]): T | null {
  if (matches.length !== 1) return null;
  const profile = matches[0];
  return profile.isActive === true && profile.loginStatus === "active"
    ? profile : null;
}
