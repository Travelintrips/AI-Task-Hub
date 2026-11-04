import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const root = new URL('../src/', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8');

test('intake failure is retained, not submitted with zero task ID', () => {
  const engine = read('lib/intake-engine.ts');
  const webhook = read('routes/whatsapp.ts');
  assert.match(engine, /status: "creation_failed", taskId: null, needsAdminReview: true/);
  assert.match(engine, /Cannot submit intake without a valid task ID/);
  assert.doesNotMatch(webhook, /markIntakeSubmitted\([^\n]*,\s*0\)/);
  assert.match(webhook, /markIntakeCreationFailed\(activeSession\.id\)/);
  assert.match(webhook, /markIntakeCreationFailed\(intakeResult\.session\.id\)/);
});

test('recovery queue is authenticated, scoped and before dynamic task route', () => {
  const routes = read('routes/ai-tasks.ts');
  const queue = routes.indexOf('router.get("/ai-tasks/intake-failures"');
  const detail = routes.indexOf('router.get("/ai-tasks/:id"');
  assert.ok(queue >= 0 && queue < detail);
  assert.match(routes, /"\/ai-tasks\/intake-failures", requireAuth, requireRole\("supervisor"\)/);
  assert.match(routes, /eq\(intakeSessionsTable\.companyId, companyId\)/);
});

test('message-linked task recovery is company-scoped', () => {
  const service = read('lib/task-service.ts');
  assert.match(service, /eq\(whatsappMessagesTable\.id, savedMsgId\), eq\(whatsappMessagesTable\.companyId, companyId\)/);
  assert.match(service, /eq\(aiTasksTable\.id, linkedMessage\.taskId\), eq\(aiTasksTable\.companyId, companyId\)/);
});
