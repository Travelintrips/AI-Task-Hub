/** Only the authenticated AI Core ledger endpoint may use this receipt gate.
 * AI Task never verifies a browser itself and never dispatches this job.
 */
export const VERIFIED_MCP_E2E_METHOD = "AI_CORE_VERIFIED_MCP_HANDSHAKE_V1" as const;
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const validTime = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value));

export function hasVerifiedSourceFinalAck(input: {
  source: string;
  externalId: string;
  status: string;
  metadata: Record<string, unknown>;
}): boolean {
  if (input.source !== "AI_CORE" || input.status !== "COMPLETED") return false;
  const match = /^bridge-command:([a-f0-9-]+)$/i.exec(input.externalId);
  if (!match || !uuid.test(match[1])) return false;
  const proof = input.metadata;
  return proof["commandId"] === match[1] &&
    proof["mcpReceiptPersisted"] === true &&
    proof["finalE2eVerified"] === true &&
    proof["finalE2eMethod"] === VERIFIED_MCP_E2E_METHOD &&
    validTime(proof["mcpAckAt"]) &&
    validTime(proof["finalE2eVerifiedAt"]) &&
    proof["finalE2eVerifiedAt"] === proof["mcpAckAt"];
}
