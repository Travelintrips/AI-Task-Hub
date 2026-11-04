import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/routes/executions.ts', import.meta.url), 'utf8');
const section = source.split('router.post("/ai-tasks/:id/gpt02-adopt-existing"')[1]
  ?.split('router.get("/ai-tasks/:id/execution"')[0];
test('adoption route exists and requires super admin and DEV', () => {
  assert.ok(section);
  assert.match(section, /requireAuth/);
  assert.match(section, /req\.user\?\.role !== "super_admin"/);
  assert.match(section, /APP_ENV === "production"/);
  assert.match(section, /NODE_ENV === "production"/);
  assert.match(section, /getCompanyIdForWrite\(req\)/);
});
test('adoption fails closed unless exactly one remote command exists', () => {
  assert.match(section, /LIMIT 2/);
  assert.match(section, /ids\.length !== 1/);
  assert.match(section, /UNIQUE_REMOTE_COMMAND_NOT_PROVEN/);
  assert.match(section, /gpt02_dev_command_archive_20261030/);
  assert.doesNotMatch(section, /submitAiTaskChatGptCommand|scheduleChatGptDispatchRetry/);
});
test('adoption uses conditional cross-instance database claim', () => {
  assert.match(section, /eq\(aiExecutionJobsTable\.status, "dispatching"\)/);
  assert.match(section, /isNull\(aiExecutionJobsTable\.commandId\)/);
  assert.match(section, /RECOVERY_CLAIM_LOST/);
  assert.match(section, /dispatchState: "adopted_existing"/);
  assert.match(section, /dispatchedNewCommand: false/);
});
