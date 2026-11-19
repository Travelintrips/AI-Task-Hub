import test from "node:test";
import assert from "node:assert/strict";
import { classifyGpt02Admission as classify } from "./gpt02-dev-preparation-admission.mjs";

const base = Object.freeze({
  environment: "development",
  companyId: "default",
  taskId: 171,
  hubJobCount: 1,
  hubStatus: "prepared",
  coreStatus: "PENDING",
  commandIssued: false,
  callbackVerified: false,
  finalAckVerified: false,
  preparationMatches: true,
  observedAtMs: Date.parse("2026-11-19T01:00:00Z"),
  expiresAtMs: Date.parse("2026-11-17T16:15:57Z"),
});
test("Task171 expired immutable preparation must fail closed", () => {
  assert.deepEqual(classify(base), { code: "PREPARATION_EXPIRED_NO_REPREPARE", canProceed: false });
});
test("fresh preparation still cannot authorize without independent approval", () => {
  assert.deepEqual(classify({ ...base, expiresAtMs: base.observedAtMs + 60_000 }), { code: "PREPARATION_ONLY_APPROVAL_REQUIRED", canProceed: false });
});
test("a changed or duplicate Hub job is rejected", () => {
  assert.equal(classify({ ...base, hubJobCount: 2 }).code, "HISTORY_OR_LIFECYCLE_MISMATCH");
  assert.equal(classify({ ...base, commandIssued: true }).code, "HISTORY_OR_LIFECYCLE_MISMATCH");
});
test("missing binding or unverified expiry rejected", () => {
  assert.equal(classify({ ...base, preparationMatches: false }).code, "PREPARATION_BINDING_MISSING");
  assert.equal(classify({ ...base, expiresAtMs: null }).code, "EXPIRY_UNVERIFIABLE");
});
test("PROD, cross-company, and old tasks rejected", () => {
  assert.equal(classify({ ...base, environment: "production" }).code, "OUT_OF_SCOPE");
  assert.equal(classify({ ...base, companyId: "other" }).code, "OUT_OF_SCOPE");
  assert.equal(classify({ ...base, taskId: 135 }).code, "OUT_OF_SCOPE");
});
