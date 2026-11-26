import test from 'node:test';
import assert from 'node:assert/strict';
import {hasExplicitSopFailure} from '../src/lib/verified-sop-outcome.ts';
test('rejects real DEV blocker reply even if outer response is COMPLETED',()=>{
 assert.equal(hasExplicitSopFailure('**BLOCKER — dev-auto-checkpoint-20261027-01**\n- **E2E_VERIFIED:** FALSE\n- **FINAL_ACK_VERIFIED:** FALSE'),true);
});
test('does not reject ordinary completed reply',()=>{
 assert.equal(hasExplicitSopFailure('Step passed. E2E verified via authenticated MCP receipt.'),false);
});
test('rejects negative explicit final verification',()=>{
 assert.equal(hasExplicitSopFailure('FINAL_ACK_VERIFIED: FALSE'),true);
});
