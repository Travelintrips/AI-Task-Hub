/** DEV local canary only. No GPT02 approval, signature, dispatch or Final ACK. */
export const TEAM_SOURCE = "cst-ai-team-dev-canary";
export const TEAM_ROLES = ["coding", "infrastructure", "security", "qa"] as const;

/** Pin only the existing DEV CST Company 1 model-free PC worker for its exact
 * supported no-write probes. Explicit task/client selection still comes from
 * the authenticated Hub execution request; this never grants a capability.
 */
export function isCstDevBoundedWorkerProbe(
  input: { companyId: string; assignedClientId?: string | null; instruction: string },
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.NODE_ENV === "development" && env.APP_ENV === "development"
    && input.companyId === "1"
    && input.assignedClientId === "openclaw-pc-worker-dev"
    && ["ping", "status"].includes(input.instruction.trim().toLowerCase());
}
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

/** Read-only global Core capacity, NEVER proof that Company-1 has four agents.
 * A successful canary or an active coding-worker lease cannot grant execution,
 * worker-role authority, independent QA review, or an external Final ACK.
 */
export type IndependentTeamCapacityCounts = {
  registeredCodingWorkers: number;
  activeLeasedCodingWorkers: number;
  recordedAiHandoffs: number;
};
export type IndependentTeamGate = {
  mode: "READ_ONLY_GLOBAL_CAPACITY_NOT_AUTHORITY";
  status: "blocked" | "unavailable";
  checkedAt: string;
  registeredCodingWorkers: number | null;
  activeLeasedCodingWorkers: number | null;
  recordedAiHandoffs: number | null;
  verifiedIndependentTeam: false;
  blockers: string[];
};
export function projectIndependentTeamGate(
  counts: IndependentTeamCapacityCounts | null,
  checkedAt: Date = new Date(),
): IndependentTeamGate {
  const basic = { mode: "READ_ONLY_GLOBAL_CAPACITY_NOT_AUTHORITY" as const,
    checkedAt: checkedAt.toISOString(), verifiedIndependentTeam: false as const };
  if (!counts ||
      !Object.values(counts).every(n => Number.isSafeInteger(n) && n >= 0) ||
      counts.activeLeasedCodingWorkers > counts.registeredCodingWorkers) {
    return { ...basic, status: "unavailable",
      registeredCodingWorkers: null, activeLeasedCodingWorkers: null,
      recordedAiHandoffs: null,
      blockers: ["CORE_CAPACITY_READBACK_UNAVAILABLE"] };
  }
  const blockers = [
    ...(counts.activeLeasedCodingWorkers < 4 ? ["FOUR_ACTIVE_CODING_WORKERS_NOT_VERIFIED"] : []),
    ...(counts.recordedAiHandoffs === 0 ? ["NO_PERSISTED_MULTIWORKER_HANDOFF"] : []),
    "FOUR_DISTINCT_AGENT_RECEIPTS_AND_INDEPENDENT_QA_FINAL_ACK_NOT_VERIFIED",
  ];
  return { ...basic, status: "blocked", ...counts, blockers };
}
