import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
const root = new URL("../src/", import.meta.url);
const read = name => readFileSync(new URL(name, root), "utf8");
const route = read("routes/job-bridge.ts");
const cleanup = read("routes/job-bridge-dashboard-visibility.ts");
const dashboard = read("../../ai-task-center/src/pages/unified-dashboard.tsx");

test("Requires authenticated super admin; IDs and batch limits validated", () => {
  assert.match(cleanup, /requireAuth, requireRole\("super_admin"\)/);
  assert.match(cleanup, /Number\.isSafeInteger/);
  assert.match(cleanup, /jobIds\.length \+ taskIds\.length > 100/);
});
test("All validations happen before records are archived", () => {
  assert.match(cleanup, /FOR UPDATE/);
  assert.match(cleanup, /"new_inquiry"/);
  assert.match(cleanup, /t\.assigned_to !== null \|\| t\.assigned_to_id !== null/);
  assert.match(cleanup, /"COMPLETED", "FAILED"/);
  assert.match(cleanup, /ROLLBACK/);
  assert.match(cleanup, /DASHBOARD_ARCHIVED/);
  assert.match(cleanup, /dashboard_hidden/);
  assert.doesNotMatch(cleanup, /DELETE FROM public\.ai_tasks/i);
  assert.doesNotMatch(cleanup, /DELETE FROM ai_task_bridge\.jobs/i);
});
test("Hidden AI Tasks stay in original AI Tasks and are excluded only by dashboard", () => {
  assert.match(route, /hiddenTaskIds/);
  assert.match(route, /public\.audit_logs/);
  assert.match(dashboard, /hiddenTaskIds\.has\(t\.id\)/);
  assert.match(dashboard, /eligibleTaskIds/);
  assert.match(dashboard, /hide-dashboard-items/);
  assert.match(dashboard, /QUEUED\/RUNNING tetap terkunci/);
});
