import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {passiveBridgeSourceProgress as project} from '../src/lib/bridge-ledger-source-progress.ts';

test('FAILED and BLOCKED never manufacture completion from terminal source events',()=>{
 for(const status of ['FAILED','BLOCKED','DEPLOYED','MERGED']){
  assert.equal(project(status,0,false),0);
  assert.equal(project(status,65,false),65);
  assert.equal(project(status,100,false),90);
 }
});
test('COMPLETED without verified final ACK stays at or below 90%',()=>{
 assert.equal(project('COMPLETED',30,false),90);
 assert.equal(project('COMPLETED',100,false),90);
 assert.equal(project('COMPLETED',90,false),90);
});
test('verified native final ACK is sole path to source-ledger 100%',()=>{
 assert.equal(project('COMPLETED',10,true),100);
 assert.equal(project('FAILED',10,false),10);
 for (const status of ['FAILED','BLOCKED','DEPLOYED','MERGED','RUNNING']) {
  assert.notEqual(project(status,10,true),100);
 }
});
test('normal source events remain bounded and invalid previous values do not grant completion',()=>{
 assert.equal(project('RUNNING',10,false),25);
 assert.equal(project('RUNNING',86,false),86);
 assert.equal(project('RUNNING',100,false),90);
 assert.equal(project('RUNNING',NaN,false),25);
});
test('bridge source-event route uses guarded projection, not terminal=100 shortcut',()=>{
 const source=readFileSync(new URL('../src/routes/executions.ts',import.meta.url),'utf8');
 const begin=source.indexOf('router.post("/bridge/jobs/:id/source-event"');
 const end=source.indexOf('router.',begin+12);
 assert.ok(begin>0&&end>begin);
 const route=source.slice(begin,end);
 assert.match(route,/passiveBridgeSourceProgress\(normalized, job\.progress, verifiedFinal\)/);
 assert.doesNotMatch(route,/terminal\s*\?\s*100/);
});

test('GPT02 assignment guard cannot be bypassed by omitting lifecycleStart',()=>{
 const source=readFileSync(new URL('../src/routes/executions.ts',import.meta.url),'utf8');
 const start=source.indexOf('router.post("/ai-tasks/:id/execution", requireAuth');
 const end=source.indexOf('const externalId = buildAiTaskExternalCommandId',start);
 assert.ok(start>0&&end>start);
 const intake=source.slice(start,end);
 assert.match(intake,/accountAlias = typeof body\.accountAlias/);
 assert.match(intake,/AI_TASK_DEFAULT_GPT_ALIAS/);
 assert.match(intake,/if \(mode === "chatgpt" && accountAlias === "GPT02"\)/);
 assert.match(intake,/!task\.assignedToId/);
 assert.match(intake,/!task\.assignedTo\?\.trim\(\)/);
 assert.match(intake,/eq\(teamMembersTable\.companyId,companyId\)/);
 assert.match(intake,/member\.isActive !== true/);
 assert.match(intake,/member\.name !== task\.assignedTo/);
 assert.match(intake,/GPT02_PIC_IDENTITY_NOT_VERIFIED/);
 assert.match(intake,/GPT02_TASK_ASSIGNMENT_NOT_READY/);
 assert.doesNotMatch(intake,/if \(body\.lifecycleStart === true &&\s*\([^)]*!task\.assignedTo/);
});

test('DEV PIC assignment is scoped, explicit, and cannot dispatch a command',()=>{
 const source=readFileSync(new URL('../src/routes/executions.ts',import.meta.url),'utf8');
 const start=source.indexOf('router.post("/ai-tasks/:id/gpt02-assign-pic", requireAuth');
 const end=source.indexOf('router.post("/ai-tasks/:id/execution", requireAuth',start);
 assert.ok(start>0&&end>start);
 const route=source.slice(start,end);
 for(const requirement of [
  'process.env.NODE_ENV !== "development"',
  'process.env.APP_ENV === "production"',
  'req.user?.role !== "super_admin"',
  'Number.isSafeInteger(memberId)',
  'eq(teamMembersTable.companyId,companyId)',
  'eq(teamMembersTable.isActive,true)',
  'eq(aiTasksTable.companyId,companyId)',
  "NOT IN ('completed','cancelled')",
  'assignedToId:member.id',
  'operatorApprovalGranted:false',
  'commandDispatched:false',
 ]) assert.ok(route.includes(requirement),requirement);
 assert.doesNotMatch(route,/submitAiTaskCommand\(|scheduleExecutionTracking\(|scheduleChatGptDispatchRetry\(/);
});

test('DEV PIC options are read-only, tenant-scoped and never attest operator approval',()=>{
 const source=readFileSync(new URL('../src/routes/executions.ts',import.meta.url),'utf8');
 const start=source.indexOf('router.get("/ai-tasks/:id/gpt02-pic-options", requireAuth');
 const end=source.indexOf('router.post("/ai-tasks/:id/gpt02-assign-pic", requireAuth',start);
 assert.ok(start>0&&end>start);
 const route=source.slice(start,end);
 for(const requirement of [
  'req.user?.role !== "super_admin"',
  'process.env.NODE_ENV !== "development"',
  'eq(aiTasksTable.companyId,companyId)',
  'eq(teamMembersTable.companyId,companyId)',
  'eq(teamMembersTable.isActive,true)',
  'assignedToId:aiTasksTable.assignedToId',
  'taskAssignmentPresent:!!selected',
  'taskOwnerAuthenticated:false',
  'operatorApprovalGranted:false',
  'commandDispatched:false',
  'choicesTruncated:members.length===100'
 ]) assert.ok(route.includes(requirement),requirement);
 assert.doesNotMatch(route,/db\.update\(|db\.insert\(|db\.delete\(|submitAiTaskCommand\(/);
});
