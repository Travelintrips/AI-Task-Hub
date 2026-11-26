import { test } from "node:test";
import assert from "node:assert/strict";
import { hasVerifiedSourceFinalAck } from "./verified-source-final-ack.js";

const id = "4b5663cc-5bac-40df-b55b-95295dd16e96";
const at = "2026-10-25T19:47:41.000Z";
const input = {
  source: "AI_CORE",
  externalId: "bridge-command:" + id,
  status: "COMPLETED",
  metadata: {
    commandId: id,
    mcpReceiptPersisted: true,
    mcpAckAt: at,
    finalE2eVerified: true,
    finalE2eVerifiedAt: at,
    finalE2eMethod: "AI_CORE_VERIFIED_MCP_HANDSHAKE_V1",
  },
};
test("authenticated source may mirror a fully bound verified handshake", () => {
  assert.equal(hasVerifiedSourceFinalAck(input), true);
});
test("transport ACK never becomes E2E final", () => {
  assert.equal(hasVerifiedSourceFinalAck({ ...input,
    metadata: { commandId: id, mcpReceiptPersisted: true, mcpAckAt: at },
  }), false);
});
test("wrong source, status and command identity are rejected", () => {
  assert.equal(hasVerifiedSourceFinalAck({ ...input, source: "AI_TASK" }), false);
  assert.equal(hasVerifiedSourceFinalAck({ ...input, status: "FAILED" }), false);
  assert.equal(hasVerifiedSourceFinalAck({ ...input, externalId: "coding-task:" + id }), false);
  assert.equal(hasVerifiedSourceFinalAck({ ...input,
    metadata: { ...input.metadata, commandId: "fake" },
  }), false);
});
test("incorrect verification method or timestamp fails closed", () => {
  assert.equal(hasVerifiedSourceFinalAck({ ...input,
    metadata: { ...input.metadata, finalE2eMethod: "worker-completed" },
  }), false);
  assert.equal(hasVerifiedSourceFinalAck({ ...input,
    metadata: { ...input.metadata, finalE2eVerifiedAt: "2026-10-25T19:48:41.000Z" },
  }), false);
});
