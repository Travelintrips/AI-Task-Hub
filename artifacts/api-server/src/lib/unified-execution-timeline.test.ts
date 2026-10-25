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
