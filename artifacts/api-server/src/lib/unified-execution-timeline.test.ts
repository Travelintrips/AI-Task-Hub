import { test } from "node:test";
import assert from "node:assert/strict";
import { projectUnifiedTimeline } from "./unified-execution-timeline.js";

const when = new Date("2026-10-25T20:00:00Z");
const job = {
  id: "4b5663cc-5bac-40df-b55b-95295dd16e96",
  taskId: null,
  source: "AI_CORE",
  externalId: "bridge-command:source-1",
  correlationId: "75aceb0a-72f6-4a6b-9e15-11fd68e74e77",
  commandId: null, workerId: null, assignedClientId: null,
  status: "verifying", createdAt: when, updatedAt: when,
  callbackVerified: false, attestationVerified: false, finalAckVerified: false,
  metadata: { jobId: "JOB-A", commandId: "COMMAND-A", workerId: "openclaw-vps-main",
    operationalSop: { version: "sop/1", title: "Original", steps: ["Observe"] } },
};
const event = {
  executionId: job.id, eventId: "source-event-1", eventType: "ACK",
  status: "PROCESSING", message: "Received", workerId: "openclaw-vps-main",
  createdAt: when,
  payload: { sopSnapshot: { version: "sop/2", title: "Revision", steps: ["Review"] } },
};

test("correlates IDs and preserves SOP revisions without duplicate events", () => {
  const [item] = projectUnifiedTimeline([job], [event, event]);
  assert.equal(item.jobId, "JOB-A");
  assert.equal(item.commandId, "COMMAND-A");
  assert.equal(item.correlationId, job.correlationId);
  assert.equal(item.workerId, "openclaw-vps-main");
  assert.equal(item.events.length, 1);
  assert.deepEqual(item.sopHistory.map((s) => s.version), ["sop/1", "sop/2"]);
});
test("transport ACK does not manufacture final E2E verification", () => {
  const [item] = projectUnifiedTimeline([job], [event]);
  assert.equal(item.ack.received, true);
  assert.equal(item.ack.finalVerified, false);
  assert.equal(item.ack.attestationVerified, false);
});
test("unknown SOP and command ID remain unknown", () => {
  const [item] = projectUnifiedTimeline([{ ...job, metadata: {} }], []);
  assert.equal(item.jobId, null);
  assert.equal(item.commandId, null);
  assert.deepEqual(item.sopHistory, []);
  assert.equal(item.ack.received, false);
});


test("previously mirrored jobs recover identity and SOP from source events", () => {
  const [item] = projectUnifiedTimeline([{ ...job, metadata: {} }], [{
    ...event, eventType: "SOURCE_EVENT",
    payload: { status: "COMPLETED", jobId: "JOB-LEGACY", commandId: "COMMAND-LEGACY",
      correlationId: "CORRELATION-LEGACY", workerId: "openclaw-dell",
      ackReceived: true, callbackObserved: true,
      sopSnapshot: { version: "resource-first-human-last/1", title: "SOP at dispatch", steps: ["Recover", "Verify"] } },
  }]);
  assert.equal(item.jobId, "JOB-LEGACY");
  assert.equal(item.commandId, "COMMAND-LEGACY");
  assert.equal(item.correlationId, "CORRELATION-LEGACY");
  assert.equal(item.workerId, "openclaw-dell");
  assert.equal(item.sopHistory.length, 1);
  assert.equal(item.ack.received, true);
  assert.equal(item.ack.callbackObserved, true);
  assert.equal(item.ack.finalVerified, false);
});

test("persisted MCP receipt is visible but cannot certify E2E Final ACK", () => {
  const [item] = projectUnifiedTimeline([{ ...job, metadata: {} }], [{
    ...event, eventType: "SOURCE_EVENT",
    payload: { status: "COMPLETED", ackReceived: true, callbackObserved: true,
      mcpReceiptPersisted: true, mcpAckAt: "2026-10-25T19:00:00.000Z" },
  }]);
  assert.equal(item.ack.mcpReceiptPersisted, true);
  assert.equal(item.ack.mcpAcknowledgedAt, "2026-10-25T19:00:00.000Z");
  assert.equal(item.ack.finalVerified, false);
  assert.equal(item.ack.attestationVerified, false);
});
test("legacy source transport ACK does not imply MCP receipt", () => {
  const [item] = projectUnifiedTimeline([{ ...job, metadata: {} }], [{
    ...event, eventType: "SOURCE_EVENT",
    payload: { ackReceived: true, callbackObserved: true },
  }]);
  assert.equal(item.ack.received, true);
  assert.equal(item.ack.mcpReceiptPersisted, false);
  assert.equal(item.ack.mcpAcknowledgedAt, null);
  assert.equal(item.ack.finalVerified, false);
});

test("source COMPLETED remains completed even if AI Task ledger is verifying", () => {
  const [result] = projectUnifiedTimeline([{ ...job, status: "verifying" }], [{
    ...event, eventId: "source-completed", eventType: "SOURCE_EVENT",
    status: "COMPLETED", payload: { callbackObserved: true },
  }]);
  assert.equal(result.executionStatus, "COMPLETED");
  assert.equal(result.ledgerStatus, "verifying");
  assert.equal(result.finalAckStatus, "PENDING");
  assert.equal(result.ack.finalVerified, false);
});
test("signed final acknowledgement changes final ACK only, not source completion", () => {
  const [result] = projectUnifiedTimeline([{ ...job, status: "completed", finalAckVerified: true }], [{
    ...event, eventId: "source-completed", eventType: "SOURCE_EVENT", status: "COMPLETED",
    payload: {},
  }]);
  assert.equal(result.executionStatus, "COMPLETED");
  assert.equal(result.ledgerStatus, "completed");
  assert.equal(result.finalAckStatus, "VERIFIED");
});
test("missing source event cannot manufacture a completed execution", () => {
  const [result] = projectUnifiedTimeline([{ ...job, status: "verifying" }], []);
  assert.equal(result.executionStatus, "UNKNOWN");
  assert.equal(result.finalAckStatus, "PENDING");
});
test("a FAILED source remains FAILED even without final ACK", () => {
  const [result] = projectUnifiedTimeline([{ ...job, status: "failed" }], [{
    ...event, eventId: "source-failed", eventType: "SOURCE_EVENT", status: "FAILED", payload: {},
  }]);
  assert.equal(result.executionStatus, "FAILED");
  assert.equal(result.finalAckStatus, "PENDING");
});
test("ordinary AI Task executions still display their own persisted status", () => {
  const [result] = projectUnifiedTimeline([{ ...job, source: "AI_TASK", status: "completed" }], []);
  assert.equal(result.executionStatus, "COMPLETED");
  assert.equal(result.ledgerStatus, "completed");
});
