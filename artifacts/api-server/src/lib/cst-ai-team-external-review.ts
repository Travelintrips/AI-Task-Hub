/** DEV-only, operator-collected OpenClaw/local-model observations. NOT agent attestation. */
import { canRunDevTeam, TEAM_ROLES, type TeamRole } from "./cst-ai-team-contract.ts";

export const EXTERNAL_REVIEW_SOURCE = "cst-ai-team-dev-external-review";
export const EXTERNAL_REVIEW_PROOF = "DEV_OPERATOR_COLLECTED_UNATTESTED";
export const EXTERNAL_REVIEW_SCENARIO = "operator_collected_read_only_review";
/** Incomplete operator-collected reviews must never appear running indefinitely. */
export const EXTERNAL_REVIEW_STALE_AFTER_MS = 10 * 60 * 1000;
export const EXTERNAL_REVIEW_FAILURE_REASONS = [
  "QA_PROVIDER_LIMIT", "QA_PROVIDER_AUTH_UNAVAILABLE", "REVIEW_INTERRUPTED",
] as const;
export type ExternalReviewFailureReason = (typeof EXTERNAL_REVIEW_FAILURE_REASONS)[number];
export function parseExternalReviewFailure(input: unknown): ExternalReviewFailureReason | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || typeof record.reason !== "string") return null;
  return EXTERNAL_REVIEW_FAILURE_REASONS.includes(record.reason as ExternalReviewFailureReason)
    ? record.reason as ExternalReviewFailureReason : null;
}
export function projectExternalReviewStatus(
  status: string, createdAt: Date | string | null, nowMs = Date.now(),
): { status: string; expired: boolean; failureReason: string | null } {
  if (status !== "processing") return {status, expired: false, failureReason: null};
  const created = createdAt == null ? Number.NaN : new Date(createdAt).getTime();
  const expired = !Number.isFinite(created) || nowMs - created > EXTERNAL_REVIEW_STALE_AFTER_MS;
  return { status: expired ? "blocked" : "processing", expired,
    failureReason: expired ? "OPERATOR_REVIEW_TIMEOUT" : null };
}

export const EXTERNAL_TEAM_AGENTS: Record<TeamRole, { host: string; agentId: string }> = {
  coding: { host: "DELL", agentId: "gpt02-dev" },
  infrastructure: { host: "DELL", agentId: "dell-recovery" },
  security: { host: "DELL", agentId: "dell-verifier" },
  qa: { host: "DELL", agentId: "dell-browser" },
};
/** Explicit read-only local-model alternative. NOT the OpenClaw dell-browser agent. */
export const EXTERNAL_QA_LOCAL_FALLBACK = { host: "DELL", agentId: "ollama-local-qa" } as const;

function allowedExternalProfiles(role: TeamRole): ReadonlyArray<{host: string; agentId: string}> {
  return role === "qa" ? [EXTERNAL_TEAM_AGENTS.qa, EXTERNAL_QA_LOCAL_FALLBACK]
    : [EXTERNAL_TEAM_AGENTS[role]];
}

export function externalObservationWorkerId(profile: Pick<ExternalObservation, "role" | "host" | "agentId">): string {
  const kind = profile.role === "qa" && profile.host === EXTERNAL_QA_LOCAL_FALLBACK.host &&
    profile.agentId === EXTERNAL_QA_LOCAL_FALLBACK.agentId ? "ollama-local" : "openclaw";
  return `${kind}:${profile.host}:${profile.agentId}`;
}

export function canRunExternalReview(env: NodeJS.ProcessEnv = process.env): boolean {
  return canRunDevTeam(env) && env.CST_AI_TEAM_EXTERNAL_EVIDENCE_ENABLED === "true";
}

const OBSERVATION_KEYS = ["role", "agentId", "host", "challenge", "result", "summaryCode", "responseSha256", "sessionSha256"] as const;
const SUMMARY_CODES = [
  "REVIEW_COMPLETE", "MISSING_WORKER_LEASE", "NO_PERSISTED_HANDOFF",
  "MISSING_ATTESTATION", "MISSING_FINAL_ACK", "UNSAFE_RECOMMENDATION_REJECTED",
  "DEV_READ_ONLY_GUARDS_OK", "AGENT_UNAVAILABLE",
] as const;
export type ExternalObservation = {
  role: TeamRole; agentId: string; host: string; challenge: string;
  result: "PASS" | "BLOCKED" | "FAIL";
  summaryCode: (typeof SUMMARY_CODES)[number];
  responseSha256: string; sessionSha256: string;
};
export function isExternalReviewStart(input: unknown): boolean {
  return input !== null && typeof input === "object" && !Array.isArray(input) &&
    Object.keys(input).length === 1 &&
    (input as Record<string, unknown>).scenario === EXTERNAL_REVIEW_SCENARIO;
}
/** Reject extra fields, free-form transcripts, credentials, and unknown profiles. */
export function parseExternalObservation(input: unknown): ExternalObservation | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const p = input as Record<string, unknown>;
  if (Object.keys(p).length !== OBSERVATION_KEYS.length ||
    !OBSERVATION_KEYS.every(key => Object.prototype.hasOwnProperty.call(p,key))) return null;
  if (typeof p.role !== "string" || !TEAM_ROLES.includes(p.role as TeamRole)) return null;
  const validProfile = allowedExternalProfiles(p.role as TeamRole).some(profile =>
    p.agentId === profile.agentId && p.host === profile.host);
  if (!validProfile ||
      typeof p.challenge !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(p.challenge) ||
      (typeof p.result !== "string" || !["PASS", "BLOCKED", "FAIL"].includes(p.result)) ||
      !SUMMARY_CODES.includes(p.summaryCode as (typeof SUMMARY_CODES)[number]) ||
      typeof p.responseSha256 !== "string" || !/^[0-9a-f]{64}$/.test(p.responseSha256) ||
      typeof p.sessionSha256 !== "string" || !/^[0-9a-f]{64}$/.test(p.sessionSha256)) return null;
  return p as ExternalObservation;
}

/** These checks establish record consistency, not authenticity of an agent. */
export function checkExternalObservation(input: ExternalObservation, challenge: string): boolean {
  return allowedExternalProfiles(input.role).some(expected =>
    input.host === expected.host && input.agentId === expected.agentId) &&
    input.challenge === challenge;
}

export type RecordedExternalObservation = {
  eventType: string;
  phase: string | null;
  status: string | null;
  workerId: string | null;
  signatureVerified: boolean;
  payload: unknown;
};

/** Fail closed before accepting the QA handoff: labels alone are insufficient.
 * These records remain operator-collected and UNSIGNED, not agent attestation.
 */
export function validatePriorReviewEvidence(
  records: RecordedExternalObservation[], challenge: string,
): boolean {
  const preceding = records.filter(x => x.eventType.startsWith("team.external."));
  const required: TeamRole[] = ["coding", "infrastructure", "security"];
  if (preceding.length !== required.length) return false;
  return required.every(role => {
    const matching = preceding.filter(x => x.phase === role);
    if (matching.length !== 1) return false;
    const r = matching[0];
    if (r.eventType !== "team.external.observed" || r.status !== "observed" ||
        r.signatureVerified !== false || !r.payload || typeof r.payload !== "object") return false;
    const p = r.payload as Record<string, unknown>;
    const profile = EXTERNAL_TEAM_AGENTS[role];
    return r.workerId === externalObservationWorkerId({ role, ...profile }) &&
      p.operatorCollected === true && p.proofLevel === EXTERNAL_REVIEW_PROOF &&
      p.challenge === challenge && Boolean(parseExternalObservation({
        role, host: profile.host, agentId: profile.agentId, challenge: p.challenge,
        result: p.result, summaryCode: p.summaryCode,
        responseSha256: p.responseSha256, sessionSha256: p.sessionSha256,
      }));
  });
}

export function projectExternalObservations(
  records: RecordedExternalObservation[], challenge: string,
): { recordedRoles: TeamRole[]; internallyConsistent: boolean;
     evidenceType: typeof EXTERNAL_REVIEW_PROOF; operationalVerified: false;
     independentFinalAckVerified: false; qaReviewRecorded: boolean } {
  const observed = records.filter(x => x.eventType.startsWith("team.external."));
  const roles = new Set<TeamRole>();
  let valid = observed.length <= TEAM_ROLES.length;
  for (const r of observed) {
    const role = r.phase;
    if (!TEAM_ROLES.includes(role as TeamRole) || roles.has(role as TeamRole) ||
        r.eventType !== "team.external.observed" || r.status !== "observed" ||
        r.signatureVerified !== false || !r.payload || typeof r.payload !== "object") {
      valid = false; continue;
    }
    const p = r.payload as Record<string, unknown>;
    const expected = allowedExternalProfiles(role as TeamRole).find(profile =>
      r.workerId === externalObservationWorkerId({role:role as TeamRole, ...profile}));
    if (!expected || p.proofLevel !== EXTERNAL_REVIEW_PROOF || p.challenge !== challenge ||
        p.operatorCollected !== true ||
        !parseExternalObservation({
          role, agentId: expected?.agentId, host: expected?.host,
          challenge: p.challenge, result: p.result, summaryCode: p.summaryCode,
          responseSha256: p.responseSha256, sessionSha256: p.sessionSha256,
        })) { valid = false; continue; }
    roles.add(role as TeamRole);
  }
  if (roles.has("qa") && !["coding", "infrastructure", "security"].every(role => roles.has(role as TeamRole))) valid = false;
  return { recordedRoles: TEAM_ROLES.filter(role => roles.has(role)),
    internallyConsistent: valid && roles.size === TEAM_ROLES.length,
    evidenceType: EXTERNAL_REVIEW_PROOF,
    operationalVerified: false, independentFinalAckVerified: false,
    qaReviewRecorded: roles.has("qa") && valid };
}
