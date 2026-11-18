/** DEV local canary only. No GPT02 approval, signature, dispatch or Final ACK. */
export const TEAM_SOURCE = "cst-ai-team-dev-canary";
export const TEAM_ROLES = ["coding", "infrastructure", "security", "qa"] as const;
export type TeamRole = typeof TEAM_ROLES[number];
export function canReadDevTeam(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.APP_ENV === "development" && env.NODE_ENV === "development";
}
export function canRunDevTeam(env: NodeJS.ProcessEnv = process.env): boolean {
  return canReadDevTeam(env) && env.CST_AI_TEAM_DEV_ENABLED === "true";
}
/** A restarted API must never show an abandoned in-progress canary forever. */
export const CANARY_STALE_AFTER_MS = 120_000;
export function projectCanaryStatus(
  status: string,
  createdAt: Date | string | null,
  nowMs: number = Date.now(),
): { status: string; stale: boolean } {
  const createdMs = createdAt == null ? Number.NaN : new Date(createdAt).getTime();
  const stale = status === "processing" && (
    !Number.isFinite(createdMs) || nowMs - createdMs > CANARY_STALE_AFTER_MS
  );
  return { status: stale ? "blocked" : status, stale };
}

export function canaryVerdict(evidence: Array<{role: string; status: string; ok: boolean}>): boolean {
  return TEAM_ROLES.every(role => evidence.some(e =>
    e.role === role && e.status === "completed" && e.ok)) &&
    !evidence.some(e => e.status === "failed");
}
