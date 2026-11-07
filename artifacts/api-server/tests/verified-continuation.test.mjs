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


test('accepts only a receipt signed for this command and correlation', async () => {
  const { generateKeyPairSync, sign } = await import('node:crypto');
  const { canonicalDevCheckpointReceipt } = await import('../src/lib/dev-checkpoint-crypto.ts');
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const key = publicKey.export({format:'der',type:'spki'}).toString('base64');
  const unsigned = {version:1,jobId:'job-1',commandId:'cmd-1',correlationId:'corr-1',checkpointId:'cp-1',sopVersion:'v1',nextStepId:'step-2',issuedAt:'2026-10-27T08:00:00.000Z'};
  const receipt = {...unsigned,signature:sign(null,Buffer.from(canonicalDevCheckpointReceipt(unsigned)),privateKey).toString('base64')};
  const metadata={jobId:'job-1',sopVersion:'v1',checkpointReceipt:receipt};
  const checkpoint={checkpointId:'cp-1',nextStepId:'step-2'};
  assert.equal(isAttestedCheckpointResponse('CHECKPOINT',metadata,{commandId:'cmd-1',correlationId:'corr-1',publicKeyDerBase64:key},checkpoint),true);
  assert.equal(isAttestedCheckpointResponse('CHECKPOINT',metadata,{commandId:'cmd-2',correlationId:'corr-1',publicKeyDerBase64:key},checkpoint),false);
  assert.equal(isAttestedCheckpointResponse('CHECKPOINT',metadata,{commandId:'cmd-1',correlationId:'corr-2',publicKeyDerBase64:key},checkpoint),false);
  assert.equal(isAttestedCheckpointResponse('CHECKPOINT',metadata,{commandId:'cmd-1',correlationId:'corr-1',publicKeyDerBase64:key},{...checkpoint,nextStepId:'step-3'}),false);
});
