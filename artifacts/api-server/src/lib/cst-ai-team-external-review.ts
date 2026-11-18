/** DEV-only, operator-collected OpenClaw text observations. NOT agent attestation. */
import { canRunDevTeam, TEAM_ROLES, type TeamRole } from "./cst-ai-team-contract.ts";

export const EXTERNAL_REVIEW_SOURCE = "cst-ai-team-dev-external-review";
export const EXTERNAL_REVIEW_PROOF = "DEV_OPERATOR_COLLECTED_UNATTESTED";
export const EXTERNAL_REVIEW_SCENARIO = "operator_collected_read_only_review";
export const EXTERNAL_TEAM_AGENTS: Record<TeamRole, { host: string; agentId: string }> = {
  coding: { host: "Travelintrips", agentId: "main" },
  infrastructure: { host: "DELL", agentId: "dell-recovery" },
  security: { host: "DELL", agentId: "dell-verifier" },
  qa: { host: "DELL", agentId: "dell-browser" },
};

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
  const profile = EXTERNAL_TEAM_AGENTS[p.role as TeamRole];
  if (p.agentId !== profile.agentId || p.host !== profile.host ||
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
  const expected = EXTERNAL_TEAM_AGENTS[input.role];
  return input.host === expected.host && input.agentId === expected.agentId &&
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
    const expected = EXTERNAL_TEAM_AGENTS[role as TeamRole];
    if (r.workerId !== `openclaw:${expected.host}:${expected.agentId}` ||
        p.proofLevel !== EXTERNAL_REVIEW_PROOF || p.challenge !== challenge ||
        p.operatorCollected !== true ||
        !parseExternalObservation({
          role, agentId: expected.agentId, host: expected.host,
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
