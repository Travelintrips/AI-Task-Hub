/** Read-only GPT02 admission classifier. Never grants authorization or changes DB state. */
export function classifyGpt02Admission(input) {
  const i = input ?? {};
  if (i.environment !== "development" || i.companyId !== "default" || !Number.isInteger(i.taskId) || i.taskId <= 139) {
    return { code: "OUT_OF_SCOPE", canProceed: false };
  }
  if (i.hubJobCount !== 1 || i.hubStatus !== "prepared" ||
      i.coreStatus !== "PENDING" || i.commandIssued !== false ||
      i.callbackVerified !== false || i.finalAckVerified !== false) {
    return { code: "HISTORY_OR_LIFECYCLE_MISMATCH", canProceed: false };
  }
  if (i.preparationMatches !== true) {
    return { code: "PREPARATION_BINDING_MISSING", canProceed: false };
  }
  if (!Number.isFinite(i.expiresAtMs) || !Number.isFinite(i.observedAtMs)) {
    return { code: "EXPIRY_UNVERIFIABLE", canProceed: false };
  }
  if (i.expiresAtMs <= i.observedAtMs) {
    return { code: "PREPARATION_EXPIRED_NO_REPREPARE", canProceed: false };
  }
  // A fresh preparation alone is NOT signed approval or dispatch authority.
  return { code: "PREPARATION_ONLY_APPROVAL_REQUIRED", canProceed: false };
}
