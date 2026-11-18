/** DEV local canary only. No GPT02 approval, signature, dispatch or Final ACK. */
export const TEAM_SOURCE = "cst-ai-team-dev-canary";
export const TEAM_ROLES = ["coding", "infrastructure", "security", "qa"] as const;
export type TeamRole = typeof TEAM_ROLES[number];
export function canRunDevTeam(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CST_AI_TEAM_DEV_ENABLED === "true" &&
    env.APP_ENV === "development" && env.NODE_ENV === "development";
}
export function canaryVerdict(evidence: Array<{role: string; status: string; ok: boolean}>): boolean {
  return TEAM_ROLES.every(role => evidence.some(e =>
    e.role === role && e.status === "completed" && e.ok)) &&
    !evidence.some(e => e.status === "failed");
}
