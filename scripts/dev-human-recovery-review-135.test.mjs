import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const api=readFileSync(new URL('../artifacts/api-server/src/routes/executions.ts',import.meta.url),'utf8');
const ui=readFileSync(new URL('../artifacts/ai-task-center/src/pages/ai-task-detail.tsx',import.meta.url),'utf8');
const route=api.slice(api.indexOf('// DEV-only Human review handoff'),api.indexOf('// Resume only from a signed'));
test('Human review route is DEV-only, authenticated, tenant-scoped and origin fenced',()=>{
  assert.match(route,/requireAuth/);assert.match(route,/NODE_ENV!=="development"/);
  assert.match(route,/CROSS_ORIGIN_DENIED/);assert.match(route,/getCompanyIdForWrite\(req\)/);
  assert.match(route,/eq\(aiTasksTable.companyId,companyId\)/);
  assert.match(route,/eq\(aiExecutionJobsTable.companyId,companyId\)/);
});
test('Human review only for failed unverified job; no fabricated attestation, auto dispatch or resume',()=>{
  assert.match(route,/execution.status!=="failed"/);
  assert.match(route,/execution.finalAckVerified/);
  assert.match(route,/verifiedContinuation\(events\)/);
  assert.match(route,/resumeAllowed:false/);
  assert.match(route,/openClawAttemptVerified:false/);
  assert.doesNotMatch(route,/submitAiTaskCommand|submitAiTaskChatGptCommand|scheduleExecutionTracking/);
});
test('human review idempotency and history are transactional',()=>{
  assert.match(route,/pg_advisory_xact_lock/);
  assert.match(route,/ON CONFLICT DO NOTHING/);
  assert.match(route,/ai_human_task_history/);
  assert.match(route,/status,reason,instructions,payload_json/);
  assert.match(route,/VALUES\(\$\{code\},'ai_core_lifecycle','job'/);
});
test('UI shows real eligibility and requires explicit confirmation',()=>{
  assert.match(ui,/Ajukan Review Human \(tanpa resume\)/);
  assert.match(ui,/window.confirm\("Buat Human Review/);
  assert.match(ui,/recoveryReview\?\.eligibleForHumanReview/);
  assert.match(ui,/humanReviewMutation\.isPending/);
  assert.match(ui,/Belum ditetapkan \(Administrator\)/);
});
