/**
 * DEV GPT02 Hub/Core lineage audit result, intentionally NEVER authorization.
 * Facts are produced by an exact tenant-scoped read-only DB join, not copied
 * from a browser, a task label, or a caller-supplied command ID.
 */
export type Gpt02LineageEvidence = {
  task_id: unknown; task_status: unknown; pic_name: unknown;
  assigned_to_id: unknown; verified_pic_id: unknown;
  execution_id: unknown; execution_status: unknown; command_id: unknown;
  correlation_id: unknown; callback_verified: unknown;
  attestation_verified: unknown; final_ack_verified: unknown;
  core_command_found: unknown; core_task_id: unknown; core_task_found: unknown;
  core_status: unknown; claim_id: unknown; binding_verified: unknown;
  claim_attempt_id: unknown; claim_core_task_id: unknown;
  claim_assignee_id: unknown; claim_operator_id: unknown;
  nonce: unknown; nonce_grant_allowed: unknown;
  nonce_dispatch_allowed: unknown; claim_dispatch_allowed: unknown;
  claim_close_allowed: unknown; verified_completed_responses: unknown;
};
const text = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;
const count = (v: unknown): number | null =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;

export function evaluateGpt02LineageEvidence(row: Gpt02LineageEvidence) {
  const reasons: string[] = [];
  const add = (code: string, missing: boolean) => { if (missing) reasons.push(code); };
  const taskId = typeof row.task_id === "number" && Number.isSafeInteger(row.task_id)
    ? row.task_id : null;
  const executionId = text(row.execution_id);
  const commandId = text(row.command_id);
  const claimId = text(row.claim_id);
  const nonce = text(row.nonce);
  const coreTaskId = text(row.core_task_id);
  const verifiedResponses = count(row.verified_completed_responses);

  add("PIC_ID_NOT_BOUND", row.verified_pic_id == null || row.assigned_to_id == null);
  add("ATTEMPT_MISSING", !executionId);
  add("COMMAND_ID_MISSING", !commandId);
  add("CORE_COMMAND_NOT_MATCHED", row.core_command_found !== true);
  add("CORE_TASK_ID_MISSING", !coreTaskId || row.core_task_found !== true);
  add("IMMUTABLE_ATTEMPT_BINDING_MISSING", !claimId ||
      row.binding_verified !== true ||
      !text(row.claim_attempt_id) ||
      row.claim_core_task_id !== coreTaskId ||
      row.claim_assignee_id !== row.verified_pic_id ||
      row.claim_operator_id == null);
  add("ATTESTATION_NONCE_MISSING", !nonce);
  add("ATTESTATION_NOT_VERIFIED", row.attestation_verified !== true);
  add("FINAL_ACK_NOT_VERIFIED", row.final_ack_verified !== true ||
      verifiedResponses !== 1);
  add("EXECUTION_NOT_COMPLETED", row.execution_status !== "completed" ||
      row.core_status !== "COMPLETED");
  if (row.execution_status === "failed" || row.core_status === "FAILED")
    reasons.push("FAILED_PARENT_MUST_NOT_REPLAY");

  return {
    taskId, executionId, commandId,
    correlationId: text(row.correlation_id),
    taskStatus: text(row.task_status),
    executionStatus: text(row.execution_status),
    coreStatus: text(row.core_status),
    picName: text(row.pic_name),
    picIdPresent: row.verified_pic_id != null,
    coreCommandMatched: row.core_command_found === true,
    bindingSchemaReady: !!claimId && !!nonce,
    callbackVerified: row.callback_verified === true,
    attestationVerified: row.attestation_verified === true,
    finalAckVerified: row.final_ack_verified === true && verifiedResponses === 1,
    coreTaskIdPresent: !!coreTaskId && row.core_task_found === true,
    exactBindingVerified: !!claimId && row.binding_verified === true &&
      row.claim_core_task_id === coreTaskId &&
      row.claim_assignee_id === row.verified_pic_id,
    noncePresent: !!nonce,
    verifiedFinalResponseCount: verifiedResponses,
    diagnosticReasons: reasons,
    // Even an all-green readback is not a durable grant or native attestation.
    lineageDiagnosticClear: reasons.length === 0,
    nativeLineageAttested: false, operatorApprovalGranted: false,
    dispatchPermitted: false, resumePermitted: false, completionPermitted: false,
    readOnly: true,
  } as const;
}
