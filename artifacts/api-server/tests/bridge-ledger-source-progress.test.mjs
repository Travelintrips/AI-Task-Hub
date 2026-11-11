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
 assert.match(intake,/normalizedAccountAlias = typeof body\.accountAlias/);
 assert.match(intake,/let accountAlias = normalizedAccountAlias;/);
 assert.match(intake,/body\.lifecycleStart === true && body\.mode === "chatgpt" && normalizedAccountAlias === "GPT02"/);
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
  'NOT EXISTS (',
  'FROM ai_execution_jobs e',
  'e.task_id = ${taskId} AND e.company_id = ${companyId}',
  'TASK_NOT_FOUND_TERMINAL_OR_ALREADY_EXECUTING',
  'db.transaction(async (tx) =>',
  'await tx.insert(auditLogsTable).values({',
  'action:"gpt02_pic_assigned"',
  'userId:null',
  'actorIdentity:{version:1,id:req.user!.id',
  'userEmail:req.user!.email',
  'operatorApprovalGranted:false,commandDispatched:false',

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

test('existing AI Task detail UI uses verified member-ID picker, not display-name dispatch gate',()=>{
 const ui=readFileSync(new URL('../../ai-task-center/src/pages/ai-task-detail.tsx',import.meta.url),'utf8');
 for(const expected of [
  'gpt02-pic-options',
  'gpt02-assign-pic',
  'gpt02PicOptions?.assignmentReady',
  'gpt02AssignPicMutation.mutate(memberId)',
  'currentUser?.role === "super_admin"',
  'PIC aktif terhubung berdasarkan ID',
  'Nama saja tidak mengizinkan lifecycle GPT02',
 ]) assert.ok(ui.includes(expected),expected);
 assert.doesNotMatch(ui,/disabled=\{!executionData\?\.bridgeConfigured \|\| !task\.assignedTo/);
});

test('GPT02 PIC audit is written in the same transaction as task assignment',()=>{
 const source=readFileSync(new URL('../src/routes/executions.ts',import.meta.url),'utf8');
 const begin=source.indexOf('router.post("/ai-tasks/:id/gpt02-assign-pic", requireAuth');
 const end=source.indexOf('router.post("/ai-tasks/:id/execution", requireAuth',begin);
 const route=source.slice(begin,end);
 const transactionStart=route.indexOf('db.transaction(async (tx) =>');
 const taskWrite=route.indexOf('tx.update(aiTasksTable)',transactionStart);
 const auditWrite=route.indexOf('tx.insert(auditLogsTable)',taskWrite);
 const transactionEnd=route.indexOf('return updated;',auditWrite);
 assert.ok(transactionStart>=0 && taskWrite>transactionStart &&
    auditWrite>taskWrite && transactionEnd>auditWrite);
 assert.match(route,/userId:null/);
 assert.match(route,/actorIdentity:\\{version:1,id:req\\.user!\\.id/);
 assert.match(route,/userEmail:req\\.user!\\.email/);
 assert.match(route,/companyId,/);
 assert.doesNotMatch(route,/await db\.insert\(auditLogsTable\)/);
});

test('AI Task direct dispatch failures cannot report 100 percent without final ACK',()=>{
 const source=readFileSync(new URL('../src/routes/executions.ts',import.meta.url),'utf8');
 const start=source.indexOf('router.post("/ai-tasks/:id/execution", requireAuth');
 const end=source.indexOf('// Read-only preview and readiness check.',start);
 assert.ok(start>0&&end>start);
 const handler=source.slice(start,end);
 const failedAt=handler.indexOf('const [failed] = await db.update(aiExecutionJobsTable).set({');
 assert.ok(failedAt>0);
 const failureWrite=handler.slice(failedAt,failedAt+450);
 assert.match(failureWrite,/status: "failed"/);
 assert.match(failureWrite,/progress: Math\.max\(0, Math\.min\(90, execution\.progress\)\)/);
 assert.doesNotMatch(failureWrite,/progress: 100/);
});

test('no failed execution path, retry event or continuation can report 100 percent',()=>{
 const source=readFileSync(new URL('../src/routes/executions.ts',import.meta.url),'utf8');
 assert.doesNotMatch(source,/status:\s*"failed",\s*progress:\s*100\b/);
 const guarded=[...source.matchAll(/status:\s*"failed",\s*progress:\s*Math\.max\(0, Math\.min\(90/g)];
 assert.ok(guarded.length>=5,'All direct, retry and continuation failure paths must be guarded');
});

test('assignment and first execution share transaction-scoped advisory fence',()=>{
 const source=readFileSync(new URL('../src/routes/executions.ts',import.meta.url),'utf8');
 const assignment=source.slice(
  source.indexOf('router.post("/ai-tasks/:id/gpt02-assign-pic"'),
  source.indexOf('router.post("/ai-tasks/:id/execution"'));
 const execution=source.slice(
  source.indexOf('router.post("/ai-tasks/:id/execution"'),
  source.indexOf('// Read-only preview and readiness check.'));
 const fence="pg_advisory_xact_lock(hashtextextended(";
 assert.ok(assignment.includes(fence));
 assert.ok(execution.includes(fence));
 const write=assignment.indexOf('tx.update(aiTasksTable)');
 assert.ok(assignment.indexOf(fence)<write);
 const lock=execution.indexOf(fence);
 const check=execution.indexOf('const [currentTask] = await tx.select',lock);
 const create=execution.indexOf('tx.insert(aiExecutionJobsTable)',check);
 assert.ok(lock>=0&&check>lock&&create>check);
 assert.ok(execution.includes('GPT02_PIC_CHANGED_DURING_ADMISSION'));
 assert.ok(execution.includes('dispatchNotStarted:true'));
 assert.ok(execution.indexOf('submitAiTaskChatGptCommand(')>create);
});

test('legacy PATCH refuses to replace verified GPT02 member ID with free-text PIC',()=>{
 const source=readFileSync(new URL('../src/routes/ai-tasks.ts',import.meta.url),'utf8');
 const start=source.indexOf('router.patch("/ai-tasks/:id", requireAuth');
 const end=source.indexOf('// ─── POST /ai-tasks/:id/comments',start);
 assert.ok(start>=0&&end>start);
 const route=source.slice(start,end);
 assert.ok(route.includes('const changingPicName = assignedTo !== undefined && assignedTo !== current.assignedTo'));
 assert.ok(route.includes('current.assignedToId != null'));
 assert.ok(route.includes('sql`${aiTasksTable.assignedToId} IS NULL`'));
 assert.ok(route.includes('VERIFIED_PIC_REQUIRES_ID_ASSIGNMENT'));
 assert.ok(route.indexOf('const changingPicName')<route.indexOf('.update(aiTasksTable)'));
});

test('GPT02 PIC audit readback is DEV-only, company-scoped, and cannot authorize runtime',()=>{
 const src=readFileSync(new URL('../src/routes/executions.ts',import.meta.url),'utf8');
 const begin=src.indexOf('router.get("/ai-tasks/:id/gpt02-pic-audit", requireAuth');
 const end=src.indexOf('router.post("/ai-tasks/:id/gpt02-assign-pic", requireAuth',begin);
 assert.ok(begin>0 && end>begin);
 const route=src.slice(begin,end);
 for(const item of [
  'process.env.NODE_ENV !== "development"',
  'process.env.APP_ENV === "production"',
  'req.user?.role !== "super_admin"',
  'eq(aiTasksTable.companyId,companyId)',
  'eq(auditLogsTable.companyId,companyId)',
  'eq(auditLogsTable.entityId,taskId)',
  'eq(auditLogsTable.action,"gpt02_pic_assigned")',
  'recorded["memberId"]===task.assignedToId',
  'recorded["memberName"]===task.assignedTo',
  'recorded["companyId"]===companyId',
  'actorIdentity["role"]==="super_admin"',
  'actorEmail===audit.actorEmail?.trim().toLowerCase()',
  'auditMatchesCurrent',
  'operatorApprovalGranted:false',
  'commandDispatched:false',
  'nativeAckVerified:false',
 ]) assert.ok(route.includes(item),item);
 assert.doesNotMatch(route,/db\.update\(|db\.insert\(|submitAiTaskCommand\(/);
});
test('GPT02 task detail requires matched audit before lifecycle button can dispatch',()=>{
 const src=readFileSync(new URL('../../ai-task-center/src/pages/ai-task-detail.tsx',import.meta.url),'utf8');
 assert.ok(src.includes('gpt02-pic-audit'));
 assert.ok(src.includes('!gpt02PicAudit?.auditMatchesCurrent'));
 assert.ok(src.includes('queryKey:["gpt02-pic-audit",id,task?.companyId]'));
 assert.ok(src.includes('Audit PIC belum cocok'));
});

test('direct GPT02 execution requires matching PIC audit within transaction fence',()=>{
 const src=readFileSync(new URL('../src/routes/executions.ts',import.meta.url),'utf8');
 const start=src.indexOf('router.post("/ai-tasks/:id/execution", requireAuth');
 const end=src.indexOf('// Read-only preview and readiness check.',start);
 const handler=src.slice(start,end);
 const lock=handler.indexOf('pg_advisory_xact_lock');
 const audit=handler.indexOf('const [latestAudit]=await tx.select',lock);
 const create=handler.indexOf('tx.insert(aiExecutionJobsTable)',audit);
 const dispatch=handler.indexOf('submitAiTaskChatGptCommand(',create);
 assert.ok(lock>=0 && audit>lock && create>audit && dispatch>create);
 for(const requirement of [
  'eq(auditLogsTable.companyId,companyId)',
  'eq(auditLogsTable.entityId,taskId)',
  'eq(auditLogsTable.action,"gpt02_pic_assigned")',
  'auditPayload["memberId"]!==currentTask.assignedToId',
  'auditPayload["memberName"]!==currentTask.assignedTo',
  'auditPayload["companyId"]!==companyId',
  'auditPayload["taskId"]!==taskId',
  'GPT02_PIC_AUDIT_NOT_VERIFIED',
  'picAssignmentAuditId:verifiedPicAuditId',
  'picAssignedMemberId:currentTask.assignedToId',
  'dispatchNotStarted:true'
 ]) assert.ok(handler.includes(requirement), requirement);
});

test('legacy failed/blocked GPT02 execution cannot restart without supervised recovery',()=>{
 const source=readFileSync(new URL('../src/routes/executions.ts',import.meta.url),'utf8');
 const start=source.indexOf('router.post("/ai-tasks/:id/execution", requireAuth');
 const end=source.indexOf('// Read-only preview and readiness check.',start);
 const handler=source.slice(start,end);
 const guard=handler.indexOf('GPT02_EXISTING_ATTEMPT_REQUIRES_AUTHORIZED_RECOVERY');
 const reset=handler.indexOf('const [reset] = await db.update(aiExecutionJobsTable)');
 assert.ok(guard>0 && reset>guard);
 assert.ok(handler.slice(0,reset).includes('mode === "chatgpt" && accountAlias === "GPT02"'));
 assert.ok(handler.slice(0,reset).includes('asRecord(existing.metadata)["accountAlias"] === "GPT02"'));
 assert.match(handler.slice(guard-250,guard+400),/dispatchNotStarted: true/);
});
test('worker reasoning route cannot bypass GPT02 PIC audit by automatic handoff',()=>{
 const source=readFileSync(new URL('../src/routes/executions.ts',import.meta.url),'utf8');
 const start=source.indexOf('router.post("/ai-tasks/:id/execution", requireAuth');
 const end=source.indexOf('// Read-only preview and readiness check.',start);
 const handler=source.slice(start,end);
 const reasoning=handler.indexOf('AI_CORE_REASONING_ROUTE_REQUIRED');
 const blocked=handler.indexOf('GPT02_REASONING_HANDOFF_REQUIRES_AUTHORIZED_ADMISSION');
 const promotion=handler.indexOf('mode = "chatgpt";',reasoning);
 assert.ok(reasoning>=0 && blocked>reasoning && promotion>blocked);
 assert.match(handler.slice(blocked-100,blocked+85),/if \(accountAlias === "GPT02"\)/);
});

test('scheduled GPT02 account-session retry is disabled until supervised recovery',()=>{
 const source=readFileSync(new URL('../src/routes/executions.ts',import.meta.url),'utf8');
 const section=source.slice(source.indexOf('async function retryChatGptDispatch('),
  source.indexOf('function scheduleChatGptDispatchRetry(',source.indexOf('async function retryChatGptDispatch(')));
 const block=section.indexOf('if (accountAlias === "GPT02")');
 const claim=section.indexOf('const [claimed] = await db.update(aiExecutionJobsTable)');
 const dispatch=section.indexOf('submitAiTaskChatGptCommand(');
 assert.ok(block>=0 && claim>block && dispatch>claim);
 assert.match(section.slice(block,claim),/stopChatGptDispatchRetry\(executionId\)/);
});
test('GPT02 automatic and manual continuations require new authorized admission',()=>{
 const source=readFileSync(new URL('../src/routes/executions.ts',import.meta.url),'utf8');
 const autoStart=source.indexOf('async function recoverVerifiedSopContinuations(');
 const autoEnd=source.indexOf('router.post("/ai-tasks/:id/continue"',autoStart);
 assert.ok(autoStart>=0 && autoEnd>autoStart);
 const auto=source.slice(autoStart,autoEnd);
 assert.ok(auto.includes('if (alias === "GPT02") continue;'));
 assert.ok(auto.indexOf('if (alias === "GPT02") continue;')<auto.indexOf('submitAiTaskChatGptCommand('));
 const manual=source.slice(autoEnd,source.indexOf('router.post("/ai-tasks/:id/gpt02-pic-options"',autoEnd)>0?
 source.indexOf('router.post("/ai-tasks/:id/gpt02-pic-options"',autoEnd):source.indexOf('router.post("/ai-tasks/:id/execution"',autoEnd));
 const deny=manual.indexOf('GPT02_CONTINUATION_REQUIRES_NEW_AUTHORIZED_ADMISSION');
 const create=manual.indexOf('db.insert(aiExecutionJobsTable)');
 assert.ok(deny>=0 && create>deny);
 assert.match(manual.slice(deny,create),/dispatchNotStarted:true/);
});

test('GPT02 native lineage diagnostic is scoped, read-only and permanently non-authorizing',()=>{
 const src=readFileSync(new URL('../src/routes/executions.ts',import.meta.url),'utf8');
 const begin=src.indexOf('router.get("/ai-tasks/:id/gpt02-lineage", requireAuth');
 const end=src.indexOf('export default router;',begin);
 assert.ok(begin>0 && end>begin);
 assert.equal(src.split('router.get("/ai-tasks/:id/gpt02-lineage", requireAuth').length-1,1);
 const route=src.slice(begin,end);
 for(const expected of [
  'process.env.NODE_ENV !== "development"',
  'process.env.APP_ENV === "production"',
  'req.user?.role !== "super_admin"',
  'WHERE t.id=${taskId} AND t.company_id=${companyId}',
  "source='AI_TASK'", 'c.id=j.command_id',
  'bc.core_coding_task_id=c.task_id',
  'bc.hub_execution_job_id=j.id',
  'n.attempt_id=bc.attempt_id',
  'n.expires_at>clock_timestamp()',
  'verified_completed_responses',
  'evaluateGpt02LineageEvidence(result.rows[0] as never)',
  'GPT02_LINEAGE_DIAGNOSTIC_UNAVAILABLE',
  'dispatchPermitted: false',
 ]) assert.ok(route.includes(expected),expected);
 assert.doesNotMatch(route,/db\.update\(|db\.insert\(|db\.delete\(|submitAiTaskChatGptCommand\(|scheduleExecutionTracking\(/);
 const gate=readFileSync(new URL('../src/lib/gpt02-lineage-gate.ts',import.meta.url),'utf8');
 for(const token of ['FAILED_PARENT_MUST_NOT_REPLAY','IMMUTABLE_ATTEMPT_BINDING_MISSING','ATTESTATION_NONCE_MISSING',
  'FINAL_ACK_NOT_VERIFIED','nativeLineageAttested: false','dispatchPermitted: false',
  'resumePermitted: false','completionPermitted: false','readOnly: true']) assert.ok(gate.includes(token),token);
});
test('GPT02 lineage diagnostic appears on existing task detail with no resume control',()=>{
 const src=readFileSync(new URL('../../ai-task-center/src/pages/ai-task-detail.tsx',import.meta.url),'utf8');
 assert.ok(src.includes('gpt02-lineage'));
 assert.ok(src.includes('Diagnostik lineage GPT02 — baca-saja'));
 assert.ok(src.includes('NO-GO:'));
 assert.ok(src.includes('bukan persetujuan operator, izin resume'));
});

test('GPT02 PIC assignment stores string auth subject in actorIdentity, never integer audit user_id',()=>{
 const src=readFileSync(new URL('../src/routes/executions.ts',import.meta.url),'utf8');
 const begin=src.indexOf('router.post("/ai-tasks/:id/gpt02-assign-pic", requireAuth');
 const end=src.indexOf('router.post("/ai-tasks/:id/execution", requireAuth',begin);
 assert.ok(begin>0&&end>begin);
 const route=src.slice(begin,end);
 assert.ok(route.includes('userId:null'));
 assert.ok(route.includes('actorIdentity:{version:1,id:req.user!.id'));
 assert.ok(route.includes('email:req.user!.email.trim().toLowerCase(),role:"super_admin"'));
 assert.doesNotMatch(route,/userId:req\.user!\.id/);
});

