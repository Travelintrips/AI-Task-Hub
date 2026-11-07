import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const source = readFileSync(new URL("../src/routes/ai-tasks.ts", import.meta.url), "utf8");
const start = source.indexOf('router.get("/ai-tasks/:id/timeline"');
const end = source.indexOf('router.post("/ai-tasks/:id/generate-token"', start);
const route = source.slice(start, end);

test("timeline is not the former empty-result stub", () => {
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(route, /res\.json\(\[\]\)/);
  assert.match(route, /\.from\(taskTimelineTable\)/);
  assert.match(route, /\.where\(eq\(taskTimelineTable\.taskId, id\)\)/);
});
test("timeline checks task existence and company scope before returning history", () => {
  assert.match(route, /requireAuth/);
  assert.match(route, /Number\.isSafeInteger\(id\)/);
  assert.match(route, /getCompanyId\(req\)/);
  assert.match(route, /eq\(aiTasksTable\.companyId, companyId\)/);
  assert.match(route, /if \(!task\)/);
  assert.match(route, /status\(404\)/);
  assert.ok(route.indexOf("if (!task)") < route.indexOf(".from(taskTimelineTable)"));
});
test("timeline returns bounded fresh records without changing lifecycle", () => {
  assert.match(route, /Cache-Control", "no-store"/);
  assert.match(route, /\.limit\(200\)/);
  assert.match(route, /createdAt: event\.createdAt\.toISOString\(\)/);
  assert.doesNotMatch(route, /\.update\(|\.insert\(|\.delete\(/);
});
