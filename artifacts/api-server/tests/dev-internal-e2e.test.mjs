import assert from 'node:assert/strict';
import test from 'node:test';
import { isSilentInternalE2eJob } from '../src/lib/dev-internal-e2e.ts';

const snapshot = Object.fromEntries(['NODE_ENV','APP_ENV','AI_TASK_DEV_SILENT_E2E_ENABLED'].map(k => [k, process.env[k]]));
test('internal E2E opt-in is DEV-only and does not affect ordinary jobs', () => {
  try {
    process.env.NODE_ENV='development';delete process.env.APP_ENV;process.env.AI_TASK_DEV_SILENT_E2E_ENABLED='true';
    assert.equal(isSilentInternalE2eJob('[INTERNAL-E2E] isolated test'),true);
    assert.equal(isSilentInternalE2eJob('customer booking'),false);
    assert.equal(isSilentInternalE2eJob('Other [INTERNAL-E2E] text'),false);
    process.env.AI_TASK_DEV_SILENT_E2E_ENABLED='false';
    assert.equal(isSilentInternalE2eJob('[INTERNAL-E2E] isolated test'),false);
    process.env.AI_TASK_DEV_SILENT_E2E_ENABLED='true';process.env.NODE_ENV='production';
    assert.equal(isSilentInternalE2eJob('[INTERNAL-E2E] isolated test'),false);
    process.env.NODE_ENV='development';process.env.APP_ENV='production';
    assert.equal(isSilentInternalE2eJob('[INTERNAL-E2E] isolated test'),false);
  } finally { for(const [k,v] of Object.entries(snapshot)){if(v===undefined)delete process.env[k];else process.env[k]=v;} }
});
