export type PreparedReservationJob = {
  id: string;
  taskId: number | null;
  companyId: string;
  status: string;
  progress: number;
  commandId: string | null;
  workerId: string | null;
  callbackVerified: boolean;
  attestationVerified: boolean;
  finalAckVerified: boolean;
  metadata: unknown;
};

export type PreparedReservationEvidence = {
  companyId: string;
  hubTaskId: number;
  hubExecutionId: string;
  expired: boolean;
  coreStatus: string | null;
  executionCount: number;
  hubEventCount: number;
  coreCommandCount: number;
  responseCount: number;
  coreRunCount: number;
  approvalCount: number;
  issuerEvidenceCount: number;
  leaseCount: number;
  receiptCount: number;
  coreReceiptCount: number;
};

export type PreparedReservationReport = {
  taskId: number | null;
  executionId: string | null;
  status: string | null;
  correlationId: null;
  matchCount: number;
  uniqueCommandMatch: false;
  archiveAvailable: false;
  archiveChecked: false;
  commandId: string | null;
  sources: readonly [];
  callbackVerified: boolean;
  attestationVerified: boolean;
  finalAckVerified: boolean;
  preparationExpired: boolean;
  coreStatus: string | null;
  independentReviewRequired: true;
  reviewReason: string;
  evidenceComplete: boolean;
  automaticDispatch: false;
  statusChanged: false;
  resumePermitted: false;
  dispatchPermitted: false;
  operatorApprovalGranted: false;
  readOnly: true;
};
export function assessGpt02PreparedReservationReview(
  job: PreparedReservationJob,
  evidenceRows: readonly unknown[],
): PreparedReservationReport;
