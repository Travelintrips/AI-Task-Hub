import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/routes/executions.ts',import.meta.url),'utf8');
function body(from,to){const start=source.indexOf(from);assert.ok(start>=0,`missing ${from}`);const end=source.indexOf(to,start);assert.ok(end>start,`missing ${to}`);return source.slice(start,end);}
test('prepared sync stops before consulting any Core timeline, regardless of caller mode',()=>{
 const fn=body('async function syncExecution(', 'const TERMINAL_EXECUTION_STATUSES');
 const guard=fn.indexOf('if (execution.status === "prepared") return execution;');
 const bridge=fn.indexOf('aiCoreBridgeConfigured()'),fetch=fn.indexOf('fetchAiTaskCommandTimeline(');
 assert.ok(guard>=0&&bridge>guard&&fetch>guard);
 assert.ok(!fn.slice(0,guard).includes('db.update('));
});
test('prepared polling timer is stopped before sync or exponential reschedule',()=>{
 const fn=body('function scheduleExecutionTracking(', '// Read-only, exact external ID readback');
 const match=fn.match(/if \(!current \|\| TERMINAL_EXECUTION_STATUSES\.has\(current\.status\) \|\| current\.status === "prepared"\) \{([\s\S]*?)\}/);
 assert.ok(match,'prepared guard missing');assert.ok(match[1].includes('stopExecutionTracking(executionId);'));assert.ok(match[1].includes('return;'));
 assert.ok(fn.indexOf('current.status === "prepared"')<fn.indexOf('await syncExecution(current)'));
});
test('GET execution status=prepared never schedules dispatch retry or tracking',()=>{
 const fn=body('router.get("/ai-tasks/:id/execution", requireAuth', '// DEV-only Human review handoff');
 const p=fn.indexOf('!TERMINAL_EXECUTION_STATUSES.has(execution.status) && execution.status !== "prepared"');
 assert.ok(p>=0);assert.ok(fn.indexOf('scheduleChatGptDispatchRetry(execution.id)')>p);
 assert.ok(fn.indexOf('scheduleExecutionTracking(execution.id)')>p);
 assert.ok(fn.indexOf('res.json({ execution, events, bridgeConfigured: aiCoreBridgeConfigured() })')>p);
});
test('existing protected lifecycle and prepared POST guards remain in place',()=>{
 const fn=body('router.post("/ai-tasks/:id/execution", requireAuth','router.get("/ai-tasks/:id/gpt02-lineage"');
 assert.ok(fn.includes('GPT02_LIFECYCLE_PRE_DISPATCH_PROOF_REQUIRED'));
 assert.ok(fn.includes('GPT02_PREPARED_HUB_CORE_REQUIRES_AUTHORIZED_ISSUER'));
 assert.ok(fn.indexOf('if (existing?.status === "prepared")')<fn.indexOf('scheduleExecutionTracking(existing.id)'));
 assert.ok(!fn.includes('gpt02_stage.prepare_core_task('));
});
