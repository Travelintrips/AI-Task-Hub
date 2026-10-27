import test from "node:test";
import assert from "node:assert/strict";
import { isAttestedCheckpointResponse, verifiedContinuation } from "../src/lib/verified-continuation.ts";

test("rejects untrusted self-asserted Ed25519 checkpoint metadata", () => {
  const metadata = {
    verified: true, checkpointVerified: true, verifiedAssistantReply: true,
    attestation: { algorithm: "Ed25519", signature: "A".repeat(88) },
  };
  assert.equal(isAttestedCheckpointResponse("CHECKPOINT", metadata), false);
  assert.equal(isAttestedCheckpointResponse("COMPLETED", metadata), false);
  assert.equal(isAttestedCheckpointResponse("CHECKPOINT", { ...metadata, checkpointVerified: false }), false);
  assert.equal(isAttestedCheckpointResponse("CHECKPOINT", { ...metadata, verifiedAssistantReply: false }), false);
  assert.equal(isAttestedCheckpointResponse("CHECKPOINT", { ...metadata, attestation: {} }), false);
});

const signed = {
  eventType: "CHECKPOINT",
  signatureVerified: true,
  payload: {
    metadata: {
      verified: true,
      checkpointVerified: true,
      jobId: "job-123",
      sopVersion: "sop-v3",
      attestation: { algorithm: "Ed25519", signature: "A".repeat(88) },
    },
    checkpoint: { checkpointId: "cp-7", nextStepId: "step-8" },
  },
};
test("only a signed verified checkpoint supplies concrete resume identity", () => {
  assert.deepEqual(verifiedContinuation([signed]), {
    jobId: "job-123", checkpointId: "cp-7", stepId: "step-8", sopVersion: "sop-v3",
  });
});
test("unsigned, incomplete and user-authored placeholders cannot trigger resume", () => {
  assert.equal(verifiedContinuation([{ ...signed, signatureVerified: false }]), null);
  assert.equal(verifiedContinuation([{ ...signed, eventType: "ACK" }]), null);
  assert.equal(verifiedContinuation([{
    ...signed, payload: { ...signed.payload, checkpoint: { checkpointId: "cp-7" } },
  }]), null);
  assert.equal(verifiedContinuation([{
    ...signed, payload: { ...signed.payload, metadata: { ...signed.payload.metadata, checkpointVerified: false } },
  }]), null);
  assert.equal(verifiedContinuation([{
    ...signed, payload: { ...signed.payload, checkpoint: { checkpointId: "Checkpoint terakhir yang telah PASS", nextStepId: "step-8" } },
  }]), null);
});
test("latest valid signed checkpoint wins", () => {
  const older = { ...signed, payload: { ...signed.payload, checkpoint: { checkpointId: "cp-6", nextStepId: "step-7" } } };
  assert.equal(verifiedContinuation([signed, older])?.checkpointId, "cp-7");
});
