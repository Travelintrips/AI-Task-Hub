import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('../src/routes/executions.ts',import.meta.url),'utf8');
const start=code.indexOf('router.get("/bridge/jobs/by-external-id/:externalId"');
const end=code.indexOf('// AI Core -> AI Task passive ledger registration.',start);
const route=code.slice(start,end);
test('bridge readback route requires the existing token guard and exact command external ID',()=>{
 assert.ok(start>=0&&end>start);
 assert.match(route,/requireBridgeToken/);
 assert.match(route,/AI_TASK_BRIDGE_READBACK_ENABLED !== "true"/);
 assert.match(route,/process\.env\.APP_ENV !== "development"/);
 assert.match(route,/process\.env\.NODE_ENV === "production"/);
 assert.match(route,/bridge-command:/);
 assert.match(route,/res\.status\(400\)/);
});
test('only AI_CORE plus exact externalId may be read; 404 is explicit',()=>{
 assert.match(route,/eq\(aiExecutionJobsTable\.source, "AI_CORE"\)/);
 assert.match(route,/eq\(aiExecutionJobsTable\.externalId, externalId\)/);
 assert.match(route,/res\.status\(404\)/);
 assert.match(route,/safeSourceTimelineMetadata\(job\.metadata\)/);
});
test('response is non-authorizing and does not mutate data or invoke a worker',()=>{
 assert.match(route,/Cache-Control", "no-store"/);
 assert.match(route,/mayIssueGrant: false, mayDispatchWorker: false/);
 assert.match(route,/verifiedExecution: false/);
 assert.doesNotMatch(route,/db\.insert\(|db\.delete\(|db\.update\(|fetch\(|submitAiTaskCommand\(/);
});
