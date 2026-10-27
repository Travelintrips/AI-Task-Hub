import { verifyDevCheckpointReceipt, type DevCheckpointReceipt } from "./dev-checkpoint-crypto.ts";
/** Fail-closed extraction of a continuation checkpoint from AI Core's attested timeline. */
export type ContinuationEvent = {
  eventType: string;
  signatureVerified: boolean;
  payload: Record<string, unknown>;
};
export type VerifiedContinuation = {
  jobId: string;
  checkpointId: string;
  stepId: string;
  sopVersion: string;
};
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const identifier = (value: unknown): string | null =>
  typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(value.trim())
    ? value.trim() : null;
const verified = (value: unknown) => value === true;
/** Per-response proof only: no inherited ACK or unrelated response may sign a checkpoint. */
/** Cryptographic proof checked against the selected AI Core command and correlation. */
export function isAttestedCheckpointResponse(
  kind: string, metadata: unknown,
  expected?: { commandId: string; correlationId: string; publicKeyDerBase64?: string },
  checkpoint?: unknown,
): boolean {
  if (kind !== "CHECKPOINT" || !expected?.publicKeyDerBase64) return false;
  const fields = record(metadata);
  const cp = record(checkpoint);
  const receipt = record(fields.checkpointReceipt) as Partial<DevCheckpointReceipt>;
  if (receipt.commandId !== expected.commandId || receipt.correlationId !== expected.correlationId ||
      receipt.jobId !== (fields.jobId ?? cp.jobId) ||
      receipt.checkpointId !== (cp.checkpointId ?? fields.checkpointId) ||
      receipt.nextStepId !== (cp.nextStepId ?? fields.nextStepId) ||
      receipt.sopVersion !== (fields.sopVersion ?? cp.sopVersion)) return false;
  return verifyDevCheckpointReceipt(receipt as DevCheckpointReceipt, expected.publicKeyDerBase64);
}

export function verifiedContinuation(events: ContinuationEvent[]): VerifiedContinuation | null {
  // Caller passes newest-first events; choose the latest signed checkpoint.
  for (const event of events) {
    if (event.eventType !== "CHECKPOINT" || !event.signatureVerified) continue;
    const payload = record(event.payload);
    const checkpoint = record(payload.checkpoint);
    const metadata = record(payload.metadata);
    const attestation = record(metadata.attestation);
    // A mere CHECKPOINT event, an ACK, or a user-written template is never proof.
    if (!verified(metadata.checkpointVerified) || !verified(metadata.verified) ||
        attestation.algorithm !== "Ed25519" ||
        typeof attestation.signature !== "string" || attestation.signature.length < 80) continue;
    const jobId = identifier(metadata.jobId ?? checkpoint.jobId);
    const checkpointId = identifier(checkpoint.checkpointId ?? metadata.checkpointId);
    const stepId = identifier(checkpoint.nextStepId ?? metadata.nextStepId);
    const sopVersion = identifier(metadata.sopVersion ?? checkpoint.sopVersion);
    if (jobId && checkpointId && stepId && sopVersion) {
      return { jobId, checkpointId, stepId, sopVersion };
    }
  }
  return null;
}
