import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const route=readFileSync(new URL('../src/routes/executions.ts',import.meta.url),'utf8');
const start=route.indexOf('router.post("/ai-tasks/:id/execution", requireAuth');
const source=route.slice(start,route.indexOf('router.get("/ai-tasks/:id/gpt02-lineage"',start));
test('persistent prepared execution is rejected ahead of tracking, retry and Core dispatch',()=>{
 const existing=source.indexOf('const [existing] = await db.select()'),guard=source.indexOf('if (existing?.status === "prepared")'),track=source.indexOf('scheduleExecutionTracking(existing.id)'),core=source.indexOf('submitAiTaskChatGptCommand(');
 assert.ok(existing>=0&&guard>existing&&track>guard&&core>guard,{existing,guard,track,core});
 const beforeTracking=source.slice(guard,track);
 for(const t of ['GPT02_PREPARED_HUB_CORE_REQUIRES_AUTHORIZED_ISSUER','dispatchNotStarted: true','continuationScheduled: false','status(409)','return;'])assert.ok(beforeTracking.includes(t),t);
 assert.match(beforeTracking,/Cache-Control", "no-store"/);
});
test('changing mode to worker, account alias or lifecycle flag cannot bypass the stored prepared-state guard',()=>{
 const guard=source.slice(source.indexOf('if (existing?.status === "prepared")'),source.indexOf('scheduleExecutionTracking(existing.id)'));
 assert.doesNotMatch(guard,/mode ===|accountAlias ===|lifecycleStart ===/);
 assert.match(source,/GPT02_LIFECYCLE_PRE_DISPATCH_PROOF_REQUIRED/);
 assert.match(source,/GPT02_EXISTING_ATTEMPT_REQUIRES_AUTHORIZED_RECOVERY/);
});
test('no new Hub reservation or Core task callable appears in live HTTP route',()=>{
 for(const x of ['reserve_hub_core(',"from './gpt02-hub-core-reservation",'createHubCoreReserver(','gpt02_stage.hub_core_reservations'])assert.equal(source.includes(x),false);
});
