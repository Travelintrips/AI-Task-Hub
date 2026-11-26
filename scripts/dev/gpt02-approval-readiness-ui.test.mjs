import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { evaluateGpt02ApprovalReadiness } from "../../artifacts/ai-task-center/src/lib/gpt02-approval-readiness.ts";

test("Task149 audited PIC is not operator signing approval", () => {
  const x = evaluateGpt02ApprovalReadiness({
    assignmentReady:true,auditMatchesCurrent:true,executionId:null,
    coreTaskIdPresent:false,coreCommandMatched:false,bindingSchemaReady:true,
    diagnosticReasons:["ATTEMPT_MISSING","CORE_TASK_ID_MISSING","IMMUTABLE_ATTEMPT_BINDING_MISSING"],
  });
  assert.deepEqual(x.steps.map(s => s.state),["verified","missing","missing","unverified","unverified"]);
  assert.equal(x.releaseDecision,"NO_GO");
  assert.equal(x.signingPermitted,false);
  assert.equal(x.authorizationGranted,false);
  assert.equal(x.dispatchPermitted,false);
});

test("Forged all-green lineage never unlocks approval/dispatch", () => {
  const x = evaluateGpt02ApprovalReadiness({
    assignmentReady:true,auditMatchesCurrent:true,
    executionId:"00000000-0000-4000-8000-000000000001",
    coreTaskIdPresent:true,coreCommandMatched:true,bindingSchemaReady:true,diagnosticReasons:[],
  });
  assert.deepEqual(x.steps.slice(0,3).map(s => s.state),["verified","verified","verified"]);
  assert.deepEqual(x.steps.slice(3).map(s => s.state),["unverified","unverified"]);
  assert.equal(x.authorizationGranted,false);
  assert.equal(x.dispatchPermitted,false);
});

test("Missing or partial readbacks fail closed", () => {
  for (const item of [{},{assignmentReady:true},{auditMatchesCurrent:true},{coreTaskIdPresent:true},{executionId:"fake"}]) {
    const x=evaluateGpt02ApprovalReadiness(item);
    assert.notEqual(x.steps[0].state,"verified");
    assert.notEqual(x.steps[2].state,"verified");
    assert.equal(x.releaseDecision,"NO_GO");
    assert.equal(x.signingPermitted,false);
  }
});

test("Approval UI has a disabled control, not a signing/dispatch callback", () => {
  const src=readFileSync("artifacts/ai-task-center/src/pages/ai-task-detail.tsx","utf8");
  assert.match(src,/data-testid="gpt02-operator-readiness"/);
  assert.match(src,/Persetujuan operator \(belum diaktifkan\)/);
  assert.match(src,/disabled=\{true\}/);
  assert.doesNotMatch(src,/onClick=\{\(\)\s*=>\s*.*(?:approveGpt02|signGpt02)/);
});
