// Strictly presentational. This evaluator never authorizes a GPT02 command.
export type ApprovalEvidenceState = "verified" | "missing" | "unverified";
export type ApprovalReadinessInput = {
  assignmentReady?: boolean;
  auditMatchesCurrent?: boolean;
  executionId?: string | null;
  coreTaskIdPresent?: boolean;
  coreCommandMatched?: boolean;
  bindingSchemaReady?: boolean;
  diagnosticReasons?: readonly string[];
};
export type ApprovalEvidenceStep = {
  id: string;
  label: string;
  state: ApprovalEvidenceState;
  detail: string;
};
export function evaluateGpt02ApprovalReadiness(input: ApprovalReadinessInput) {
  const reasons = new Set(input.diagnosticReasons ?? []);
  const pic = input.assignmentReady === true && input.auditMatchesCurrent === true;
  const core = input.coreTaskIdPresent === true && input.coreCommandMatched === true;
  const bound = core && typeof input.executionId === "string" &&
    input.executionId.length > 0 && input.bindingSchemaReady === true &&
    !reasons.has("ATTEMPT_MISSING") &&
    !reasons.has("IMMUTABLE_ATTEMPT_BINDING_MISSING") &&
    !reasons.has("CORE_TASK_ID_MISSING");
  const steps: ApprovalEvidenceStep[] = [
    { id: "pic", label: "PIC dan audit penugasan", state: pic ? "verified" : "missing",
      detail: pic ? "Identitas PIC dan audit penugasan cocok." :
      "Menunggu identitas PIC aktif beserta audit penugasan yang cocok." },
    { id: "core", label: "Core Task dan command resmi", state: core ? "verified" : "missing",
      detail: core ? "Core Task dan command dilaporkan cocok pada ledger." :
      "Belum ada bukti Core Task dan command yang cocok." },
    { id: "binding", label: "Attempt dan binding immutable", state: bound ? "verified" : "missing",
      detail: bound ? "Bukti attempt dan binding teridentifikasi pada lineage." :
      "Attempt/binding terikat belum dapat dibuktikan pada lineage." },
    { id: "approval", label: "Persetujuan operator per-command", state: "unverified",
      detail: "Tanda tangan operator belum dapat diverifikasi melalui endpoint UI ini." },
    { id: "issuer", label: "Nonce konsumsi dan lease issuer", state: "unverified",
      detail: "Hanya issuer independen yang boleh membuktikan nonce, lease, dan fencing." },
  ];
  // A green PIC/lineage is NOT signing authority. Neither signed approval
  // nor issuer proof can come from a browser flag or this read-only API.
  return {steps, releaseDecision: "NO_GO" as const,
    signingPermitted: false as const, authorizationGranted: false as const,
    dispatchPermitted: false as const};
}
