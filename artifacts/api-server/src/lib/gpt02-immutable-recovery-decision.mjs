/**
 * DEV Task recovery disposition, based ONLY on independently read database
 * evidence. This is a technical audit decision, never a second admin approval
 * and NEVER a command-bound grant, amendment of an immutable reservation,
 * dispatch, activation of an issuer or creation of a new Task.
 *
 * The hosted PostgreSQL preparation is keyed by (company_id, hub_task_id) and
 * protected from UPDATE/DELETE/TRUNCATE; expired attempt IDs must not be reused.
 */
const freshInt = n => Number.isSafeInteger(n) && n >= 0;
export function decideGpt02ImmutableRecovery(review, proof) {
  const safeReview = review && typeof review === "object" && !Array.isArray(review) ? review : {};
  const safeProof = proof && typeof proof === "object" && !Array.isArray(proof) ? proof : {};
  const archiveConsistent = safeProof.archiveChecked === true &&
    freshInt(safeProof.archiveMatchCount) && safeProof.archiveMatchCount === 0;
  const originalIsImmutable = safeProof.immutableTriggerVerified === true;
  const clean = safeReview.reviewReason === "EXPIRED_PREPARED_RESERVATION_REQUIRES_INDEPENDENT_REVIEW" &&
    safeReview.evidenceComplete === true && safeReview.readOnly === true &&
    safeReview.status === "prepared" && safeReview.matchCount === 0 &&
    safeReview.commandId == null && safeReview.dispatchPermitted === false &&
    safeReview.resumePermitted === false &&
    safeReview.operatorApprovalGranted === false &&
    archiveConsistent && originalIsImmutable;

  return Object.freeze({
    technicalEvidenceReviewed: clean,
    technicalReviewMode: "AUTOMATED_INDEPENDENT_LEDGER_VERIFICATION",
    reason: clean ? "EXPIRED_IMMUTABLE_RESERVATION_LINKED_NEW_TASK_REQUIRED"
      : "RECOVERY_EVIDENCE_INCOMPLETE_OR_CONFLICTING",
    nextAction: clean ? "CREATE_LINKED_FRESH_DEV_TASK_WITH_EXPLICIT_OWNER_CONSENT"
      : "HOLD_NO_REPLAY",
    oldTaskId: Number.isSafeInteger(safeReview.taskId) ? safeReview.taskId : null,
    historicalReservationPreserved: true,
    sameTaskRepreparePermitted: false,
    newTaskCreated: false,
    approvalRecorded: false,
    // The user requires a single authorized Owner/Super Admin approval, not a
    // second independent HUMAN approver. Independent issuer checks still apply.
    secondHumanAdminApprovalRequired: false,
    singleOwnerApprovalRequiredForExecution: true,
    issuerVerificationStillRequired: true,
    archiveChecked: safeProof.archiveChecked === true,
    archiveMatchCount: freshInt(safeProof.archiveMatchCount) ? safeProof.archiveMatchCount : null,
    immutableTriggerVerified: originalIsImmutable,
    readOnly: true,
    dispatchPermitted: false,
    resumePermitted: false,
  });
}
