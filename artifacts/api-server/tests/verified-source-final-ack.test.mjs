import test from 'node:test';
import assert from 'node:assert/strict';
import { hasVerifiedSourceFinalAck, VERIFIED_MCP_E2E_METHOD } from '../src/lib/verified-source-final-ack.ts';

const commandId = 'a31d4b20-581e-4f3b-bf02-6c32d5a1e7aa';
const stamp = '2026-10-29T08:00:00.000Z';
const valid = {
  source: 'AI_CORE', externalId: `bridge-command:${commandId}`, status: 'COMPLETED',
  metadata: { commandId, mcpReceiptPersisted: true, finalE2eVerified: true,
    finalE2eMethod: VERIFIED_MCP_E2E_METHOD, mcpAckAt: stamp, finalE2eVerifiedAt: stamp },
};
test('accepts a matching authenticated-ledger final ACK evidence shape', () => {
  assert.equal(hasVerifiedSourceFinalAck(valid), true);
});
test('rejects mismatched command, source, state and timestamps', () => {
  for (const patch of [
    { source: 'BROWSER' }, { status: 'RUNNING' },
    { externalId: 'bridge-command:invalid' },
    { metadata: { ...valid.metadata, commandId: 'different' } },
    { metadata: { ...valid.metadata, finalE2eVerifiedAt: '2026-10-29T08:01:00.000Z' } },
    { metadata: { ...valid.metadata, mcpReceiptPersisted: false } },
    { metadata: { ...valid.metadata, finalE2eMethod: 'SELF_ASSERTED' } },
  ]) assert.equal(hasVerifiedSourceFinalAck({ ...valid, ...patch }), false);
});
