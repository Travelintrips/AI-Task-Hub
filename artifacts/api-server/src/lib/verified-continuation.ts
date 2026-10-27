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
/** Untrusted timeline metadata cannot prove an Ed25519 signature. */
export function isAttestedCheckpointResponse(_kind: string, _metadata: unknown): boolean {
  // Fail closed until AI Core exposes a cryptographically verified checkpoint receipt.
  // This MUST NOT be replaced by string-length/boolean checks.
  return false;
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
