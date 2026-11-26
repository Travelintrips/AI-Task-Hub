import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { transformSync } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ts = readFileSync(join(root, "src/lib/gpt02-lineage-gate.ts"), "utf8");
const js = transformSync(ts, { loader: "ts", format: "esm", target: "es2022" }).code;
const { evaluateGpt02LineageEvidence: evaluate } =
  await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
const uuid = "4eb75fa9-f9e4-4573-8e00-d3084b4c2c8a";
const cmd = "83db99f5-cbda-4e60-be71-3090fb411bbb";
const valid = {
  task_id: 9001, task_status: "in_progress", pic_name: "Fixture",
  assigned_to_id: 2, verified_pic_id: 2,
  execution_id: uuid, execution_status: "completed", command_id: cmd,
  correlation_id: "fixture", callback_verified: true,
  attestation_verified: true, final_ack_verified: true,
  core_command_found: true, core_task_id: "abcdef-1234",
  core_task_found: true, core_status: "COMPLETED",
  claim_id: "claim-1", binding_verified: true,
  claim_attempt_id: "attempt-1", claim_core_task_id: "abcdef-1234",
  claim_assignee_id: 2, claim_operator_id: 301,
  nonce: "nonce-1", nonce_grant_allowed: true,
  nonce_dispatch_allowed: true, claim_dispatch_allowed: true,
  claim_close_allowed: true, verified_completed_responses: 1,
};
let tests = 0;
function check(label, row, expectedReason, clear = false) {
  const v = evaluate(row);
  assert.equal(v.lineageDiagnosticClear, clear, label);
  if (expectedReason) assert.ok(v.diagnosticReasons.includes(expectedReason), label);
  for (const k of ["dispatchPermitted", "resumePermitted", "completionPermitted",
    "nativeLineageAttested", "operatorApprovalGranted"]) {
    assert.equal(v[k], false, label + ":" + k);
  }
  assert.equal(v.readOnly, true);
  tests++;
}
check("fully green still read-only", valid, null, true);
check("missing PIC", { ...valid, verified_pic_id: null }, "PIC_ID_NOT_BOUND");
check("missing core task", { ...valid, core_task_id: null }, "CORE_TASK_ID_MISSING");
check("missing claim", { ...valid, claim_id: null }, "IMMUTABLE_ATTEMPT_BINDING_MISSING");
check("wrong claim task", { ...valid, claim_core_task_id: "different" }, "IMMUTABLE_ATTEMPT_BINDING_MISSING");
check("wrong claim PIC", { ...valid, claim_assignee_id: 99 }, "IMMUTABLE_ATTEMPT_BINDING_MISSING");
check("missing binding signature", { ...valid, binding_verified: false }, "IMMUTABLE_ATTEMPT_BINDING_MISSING");
check("missing nonce", { ...valid, nonce: null }, "ATTESTATION_NONCE_MISSING");
check("no attestation", { ...valid, attestation_verified: false }, "ATTESTATION_NOT_VERIFIED");
check("no final ACK", { ...valid, final_ack_verified: false }, "FINAL_ACK_NOT_VERIFIED");
check("forged reply count", { ...valid, verified_completed_responses: 0 }, "FINAL_ACK_NOT_VERIFIED");
check("duplicated reply", { ...valid, verified_completed_responses: 2 }, "FINAL_ACK_NOT_VERIFIED");
check("malformed count", { ...valid, verified_completed_responses: "1" }, "FINAL_ACK_NOT_VERIFIED");
check("failed parent", { ...valid, core_status: "FAILED", execution_status: "failed" }, "FAILED_PARENT_MUST_NOT_REPLAY");
check("failed only Hub", { ...valid, execution_status: "failed" }, "FAILED_PARENT_MUST_NOT_REPLAY");
check("dispatched not completed", { ...valid, execution_status: "dispatched" }, "EXECUTION_NOT_COMPLETED");
check("no command", { ...valid, command_id: null, core_command_found: false }, "COMMAND_ID_MISSING");
check("no execution", { ...valid, execution_id: null }, "ATTEMPT_MISSING");
// The real Job135 failure vector must remain denied even when callback is true.
check("Job135 real blocker shape", {
  ...valid, task_id: 135, task_status: "new_inquiry", assigned_to_id: null,
  verified_pic_id: null, execution_status: "failed", core_status: "FAILED",
  attestation_verified: false, final_ack_verified: false, core_task_id: null,
  core_task_found: false, claim_id: null, binding_verified: null,
  claim_attempt_id: null, claim_core_task_id: null, claim_assignee_id: null,
  claim_operator_id: null, nonce: null, verified_completed_responses: 0,
}, "FAILED_PARENT_MUST_NOT_REPLAY");
console.log("GPT02_LINEAGE_GATE_PASS " + tests + "/" + tests +
  " negative/positive scenarios, zero authority granted");
