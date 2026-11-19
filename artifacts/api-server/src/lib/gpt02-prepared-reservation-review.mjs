/**
 * Classification ONLY for an existing GPT02 Hub/Core prepared reservation.
 * Never grants permission to prepare, dispatch, resume, approve, or delete.
 * The facts are server-read from the exact tenant/task/execution, not caller data.
 */
const positiveInt = n => Number.isSafeInteger(n) && n >= 0;

export function assessGpt02PreparedReservationReview(job, evidenceRows) {
  const rows = Array.isArray(evidenceRows) ? evidenceRows : [];
  const one = rows.length === 1 ? rows[0] : null;
  const evidence = one && typeof one === "object" ? one : {};
  const flags = job && typeof job.metadata === "object" && !Array.isArray(job.metadata)
    ? job.metadata : {};
  const counts = [
    "executionCount", "hubEventCount", "coreCommandCount", "responseCount",
    "coreRunCount", "approvalCount", "issuerEvidenceCount", "leaseCount",
    "receiptCount", "coreReceiptCount",
  ];
  const countsValid = counts.every(k => positiveInt(evidence[k]));
  const allEvidenceAbsent = countsValid && counts.every(k =>
    k === "executionCount" ? evidence[k] === 1 : evidence[k] === 0);
  const exactLink = one && evidence.companyId === job?.companyId &&
    evidence.hubTaskId === job?.taskId &&
    evidence.hubExecutionId === String(job?.id) &&
    typeof evidence.coreStatus === "string";
  const idle = job?.status === "prepared" && job?.progress === 0 &&
    job?.commandId == null && job?.workerId == null &&
    job?.callbackVerified === false && job?.attestationVerified === false &&
    job?.finalAckVerified === false && flags.environment === "development" &&
    flags.executionType === "managed_prepared" &&
    flags.lifecycleStart === false && flags.autoContinue === false &&
    flags.dispatchStarted === false && flags.productionAllowed === false;
  const status = !one || !exactLink || !countsValid
    ? "PREPARATION_LINEAGE_NOT_UNIQUE_OR_INCOMPLETE"
    : !idle || !allEvidenceAbsent || evidence.coreStatus !== "PENDING"
      ? "PREPARED_RESERVATION_CONFLICTING_EVIDENCE"
      : evidence.expired === true
        ? "EXPIRED_PREPARED_RESERVATION_REQUIRES_INDEPENDENT_REVIEW"
        : "PREPARED_RESERVATION_EXISTS_NO_AUTHORITY";

  return Object.freeze({
    taskId: job?.taskId ?? null,
    executionId: job?.id ?? null,
    status: job?.status ?? null,
    correlationId: null,
    matchCount: positiveInt(evidence.coreCommandCount) ? evidence.coreCommandCount : 0,
    uniqueCommandMatch: false,
    archiveAvailable: false,
    archiveChecked: false,
    commandId: typeof job?.commandId === "string" ? job.commandId : null,
    sources: [],
    callbackVerified: job?.callbackVerified === true,
    attestationVerified: job?.attestationVerified === true,
    finalAckVerified: job?.finalAckVerified === true,
    preparationExpired: evidence.expired === true,
    coreStatus: typeof evidence.coreStatus === "string" ? evidence.coreStatus : null,
    independentReviewRequired: true,
    reviewReason: status,
    evidenceComplete: Boolean(one && exactLink && idle && allEvidenceAbsent &&
      evidence.coreStatus === "PENDING"),
    automaticDispatch: false,
    statusChanged: false,
    resumePermitted: false,
    dispatchPermitted: false,
    operatorApprovalGranted: false,
    readOnly: true,
  });
}
