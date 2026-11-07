import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const route = readFileSync(new URL("../src/routes/job-bridge.ts", import.meta.url), "utf8");
const cleanup = readFileSync(new URL("../src/routes/job-bridge-admin-cleanup.ts", import.meta.url), "utf8");

test("bulk cleanup endpoints remain super_admin only", () => {
  assert.match(cleanup, /requireAuth, requireRole\("super_admin"\)/);
  assert.match(cleanup, /router.post\("\/bridge\/admin\/hide-jobs", \.\.\.adminOnly/);
  assert.match(cleanup, /router.post\("\/bridge\/admin\/delete-sessions", \.\.\.adminOnly/);
  assert.match(cleanup, /raw.length > 100/);
});
test("terminal job cleanup archives presentation while preserving ACK and history", () => {
  assert.match(cleanup, /\["COMPLETED","FAILED"\]/);
  assert.match(cleanup, /FOR UPDATE/);
  assert.match(cleanup, /DASHBOARD_ARCHIVED/);
  assert.match(cleanup, /ON CONFLICT \(event_id\) DO NOTHING/);
  assert.doesNotMatch(cleanup, /DELETE FROM ai_task_bridge\.jobs/i);
  assert.doesNotMatch(cleanup, /DELETE FROM ai_task_bridge\.job_events/i);
  assert.match(route, /NOT EXISTS/);
  assert.match(route, /e\.kind='DASHBOARD_ARCHIVED'/);
});
test("only stale inactive sessions can be removed, keeping linked active jobs", () => {
  assert.match(cleanup, /"IDLE","DISCONNECTED","AUTH_REQUIRED"/);
  assert.match(cleanup, /Date\.now\(\)-Date\.parse\(row\.last_seen_at\)<5\*60\*1000/);
  assert.match(cleanup, /job\.rows\[0\] && !\["COMPLETED","FAILED"\]/);
  assert.match(cleanup, /last_seen_at<now\(\)-interval '5 minutes'/);
  assert.match(cleanup, /ROLLBACK/);
});
