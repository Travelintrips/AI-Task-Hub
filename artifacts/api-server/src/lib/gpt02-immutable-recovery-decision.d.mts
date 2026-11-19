export interface Gpt02ImmutableRecoveryProof {
  archiveChecked?: boolean;
  archiveMatchCount?: number | null;
  immutableTriggerVerified?: boolean;
}
export interface Gpt02PreparedReview {
  taskId?: number | null;
  status?: string | null;
  reviewReason?: string;
  evidenceComplete?: boolean;
  readOnly?: boolean;
  matchCount?: number;
  commandId?: string | null;
  dispatchPermitted?: boolean;
  resumePermitted?: boolean;
  operatorApprovalGranted?: boolean;
}
export interface Gpt02ImmutableRecoveryDecision {
  technicalEvidenceReviewed: boolean;
  technicalReviewMode: "AUTOMATED_INDEPENDENT_LEDGER_VERIFICATION";
  reason: string;
  nextAction: string;
  oldTaskId: number | null;
  historicalReservationPreserved: true;
  sameTaskRepreparePermitted: false;
  newTaskCreated: false;
  approvalRecorded: false;
  secondHumanAdminApprovalRequired: false;
  singleOwnerApprovalRequiredForExecution: true;
  issuerVerificationStillRequired: true;
  archiveChecked: boolean;
  archiveMatchCount: number | null;
  immutableTriggerVerified: boolean;
  readOnly: true;
  dispatchPermitted: false;
  resumePermitted: false;
}
export function decideGpt02ImmutableRecovery(
  review: Gpt02PreparedReview | null | undefined,
  proof: Gpt02ImmutableRecoveryProof | null | undefined
): Gpt02ImmutableRecoveryDecision;
