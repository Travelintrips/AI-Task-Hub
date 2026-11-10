/** Historical delivery evidence only. Does not replace the strict lifecycle gate. */
export type Gpt02OutcomeEvidence = {
  execution_id?: unknown; command_id?: unknown;
  execution_status?: unknown; core_status?: unknown;
  callback_verified?: unknown; attestation_verified?: unknown; final_ack_verified?: unknown;
  direct_wake_route?: unknown; transport_context_matched?: unknown;
  completed_response_count?: unknown; exact_native_response_count?: unknown;
  completion_response_id?: unknown; completion_acknowledged_at?: unknown;
};
const uuid = (v: unknown): v is string => typeof v === 'string' &&
  /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v);
export function evaluateGpt02ExecutionOutcome(row: Gpt02OutcomeEvidence) {
  const reasons: string[] = [];
  if (!uuid(row.execution_id) || !uuid(row.command_id)) reasons.push('EXACT_EXECUTION_COMMAND_REQUIRED');
  if (row.direct_wake_route !== true) reasons.push('DIRECT_CHATGPT_ROUTE_NOT_PROVEN');
  if (row.transport_context_matched !== true) reasons.push('TENANT_CORRELATION_WORKER_BINDING_NOT_MATCHED');
  if (row.execution_status !== 'completed' || row.core_status !== 'COMPLETED') reasons.push('EXECUTION_NOT_COMPLETED');
  if (row.callback_verified !== true || row.attestation_verified !== true || row.final_ack_verified !== true)
    reasons.push('PERSISTED_VERIFICATION_FLAGS_MISSING');
  if (row.completed_response_count !== 1 || row.exact_native_response_count !== 1)
    reasons.push('EXACT_COMPLETED_RECEIPT_NOT_UNIQUE');
  if (!uuid(row.completion_response_id) || typeof row.completion_acknowledged_at !== 'string' ||
      !Number.isFinite(Date.parse(row.completion_acknowledged_at))) reasons.push('FINAL_RECEIPT_ACK_MISSING');
  const verified = reasons.length === 0;
  return {
    status: verified ? 'completed_verified' : 'not_verified',
    verified,
    route: row.direct_wake_route === true ? 'direct_chatgpt_command' : 'unclassified',
    responseId: verified ? row.completion_response_id as string : null,
    acknowledgedAt: verified ? row.completion_acknowledged_at as string : null,
    evidenceSource: 'persisted_exact_native_receipt',
    signatureReverifiedByThisRead: false,
    diagnosticReasons: reasons,
    // A successful old response cannot mint a new approval or replay grant.
    grantsAuthority: false, readOnly: true,
  } as const;
}
