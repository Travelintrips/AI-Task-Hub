import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

// Reuse original PR196 evaluators; do not reimplement a second Final ACK gate.
// No DB connection, credentials, HTTP request, signer, DELL, or PROD side effect.
const reference = path.resolve(
  process.env.GPT02_PR196_REFERENCE || 'pr196-verifier-reference'
);
const original = (file) =>
  pathToFileURL(path.join(reference, 'artifacts/api-server/src/lib', file)).href;
const {hasVerifiedSourceFinalAck} =
  await import(original('verified-source-final-ack.ts'));
const {evaluateGpt02ExecutionOutcome} =
  await import(original('gpt02-execution-outcome.ts'));

const commandId = '4b5663cc-5bac-40df-b55b-95295dd16e96';
const responseId = '816ce08e-fbf0-4dab-bc6b-2d57d508ad04';
const at = '2026-11-19T12:00:00.000Z';
const source = {
  source: 'AI_CORE',
  externalId: 'bridge-command:' + commandId,
  status: 'COMPLETED',
  metadata: {
    commandId,
    mcpReceiptPersisted: true,
    mcpAckAt: at,
    finalE2eVerified: true,
    finalE2eVerifiedAt: at,
    finalE2eMethod: 'AI_CORE_VERIFIED_MCP_HANDSHAKE_V1',
  },
};
const outcome = {
  execution_id: responseId,
  command_id: commandId,
  execution_status: 'completed',
  core_status: 'COMPLETED',
  callback_verified: true,
  attestation_verified: true,
  final_ack_verified: true,
  direct_wake_route: true,
  transport_context_matched: true,
  completed_response_count: 1,
  exact_native_response_count: 1,
  completion_response_id: responseId,
  completion_acknowledged_at: at,
};

test('source: exact original AI Core handshake shape is recognized', () => {
  assert.equal(hasVerifiedSourceFinalAck(source), true);
});
test('source: transport-only ACK never becomes Final ACK', () => {
  assert.equal(hasVerifiedSourceFinalAck({
    ...source, metadata: {commandId, mcpReceiptPersisted:true, mcpAckAt:at},
  }), false);
});
test('source: non-Core origin or non-COMPLETED state is denied', () => {
  assert.equal(hasVerifiedSourceFinalAck({...source,source:'AI_TASK'}),false);
  assert.equal(hasVerifiedSourceFinalAck({...source,status:'RUNNING'}),false);
});
test('source: wrong external command namespace or command identity is denied', () => {
  assert.equal(hasVerifiedSourceFinalAck({
    ...source, externalId:'bridge-command:' + responseId,
  }), false);
  assert.equal(hasVerifiedSourceFinalAck({
    ...source, metadata:{...source.metadata,commandId:responseId},
  }), false);
});
test('source: wrong method or incomplete receipt is denied', () => {
  assert.equal(hasVerifiedSourceFinalAck({
    ...source, metadata:{...source.metadata,finalE2eMethod:'TRANSPORT_ACK'},
  }), false);
  assert.equal(hasVerifiedSourceFinalAck({
    ...source, metadata:{...source.metadata,mcpReceiptPersisted:false},
  }), false);
});
test('source: mismatched Final ACK and MCP timestamps are denied', () => {
  assert.equal(hasVerifiedSourceFinalAck({
    ...source,
    metadata:{...source.metadata,finalE2eVerifiedAt:'2026-11-19T12:01:00.000Z'},
  }), false);
});

test('outcome: original evaluator recognizes a complete synthetic native receipt', () => {
  const v=evaluateGpt02ExecutionOutcome(outcome);
  assert.equal(v.verified,true);
  assert.equal(v.status,'completed_verified');
  assert.equal(v.evidenceSource,'persisted_exact_native_receipt');
  assert.equal(v.grantsAuthority,false);
  assert.equal(v.readOnly,true);
  assert.equal(v.signatureReverifiedByThisRead,false);
});
test('outcome: Core COMPLETED alone without native ACK remains unverified', () => {
  const v=evaluateGpt02ExecutionOutcome({
    ...outcome, final_ack_verified:false, exact_native_response_count:0,
  });
  assert.equal(v.verified,false);
  assert.ok(v.diagnosticReasons.includes('PERSISTED_VERIFICATION_FLAGS_MISSING'));
  assert.ok(v.diagnosticReasons.includes('EXACT_COMPLETED_RECEIPT_NOT_UNIQUE'));
});
test('outcome: duplicate or absent native completed receipt is rejected', () => {
  for(const count of [0,2]){
    const v=evaluateGpt02ExecutionOutcome({
      ...outcome,completed_response_count:count,
    });
    assert.equal(v.verified,false);
    assert.ok(v.diagnosticReasons.includes('EXACT_COMPLETED_RECEIPT_NOT_UNIQUE'));
  }
});
test('outcome: wrong worker route or tenant correlation is rejected', () => {
  const v=evaluateGpt02ExecutionOutcome({
    ...outcome,direct_wake_route:false,transport_context_matched:false,
  });
  assert.equal(v.verified,false);
  assert.ok(v.diagnosticReasons.includes('DIRECT_CHATGPT_ROUTE_NOT_PROVEN'));
  assert.ok(v.diagnosticReasons.includes('TENANT_CORRELATION_WORKER_BINDING_NOT_MATCHED'));
});
test('outcome: missing native response ID or ACK timestamp is rejected', () => {
  for(const patch of [{completion_response_id:null},{completion_acknowledged_at:null}]){
    const v=evaluateGpt02ExecutionOutcome({...outcome,...patch});
    assert.equal(v.verified,false);
    assert.ok(v.diagnosticReasons.includes('FINAL_RECEIPT_ACK_MISSING'));
  }
});
test('outcome: incorrect canonical Core and execution statuses are denied', () => {
  const v=evaluateGpt02ExecutionOutcome({
    ...outcome,execution_status:'verifying',core_status:'PENDING',
  });
  assert.equal(v.verified,false);
  assert.ok(v.diagnosticReasons.includes('EXECUTION_NOT_COMPLETED'));
  assert.equal(v.grantsAuthority,false);
});
