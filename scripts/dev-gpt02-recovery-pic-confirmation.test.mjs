import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src=readFileSync(new URL("../artifacts/api-server/src/routes/executions.ts", import.meta.url),"utf8");
const ui=readFileSync(new URL("../artifacts/ai-task-center/src/pages/ai-task-detail.tsx", import.meta.url),"utf8");
const begin=src.indexOf('router.post("/ai-tasks/:id/gpt02-confirm-recovery-pic", requireAuth');
const end=src.indexOf('router.post("/ai-tasks/:id/execution", requireAuth',begin);
assert.ok(begin>0&&end>begin,"Existing execution route follows the narrow recovery PIC route");
const route=src.slice(begin,end);

test("recovery PIC link is DEV-only, Super Admin-only, and same-origin",()=>{
  for(const required of [
    'process.env.NODE_ENV !== "development"',
    'process.env.APP_ENV === "production"',
    'req.user?.role !== "super_admin"',
    'SAME_ORIGIN_REQUIRED',
    'Number.isSafeInteger(reviewId)',
    'Number.isSafeInteger(memberId)',
    'eq(teamMembersTable.companyId,companyId)',
    'eq(teamMembersTable.isActive,true)',
  ]) assert.ok(route.includes(required),required);
});

test("review must belong to the exact failed execution and same named PIC",()=>{
  for(const required of [
    "h.source_module='ai_core_lifecycle'",
    "h.status='accepted'",
    "lower(h.assigned_user)=lower(",
    "h.payload_json->>'executionId'=e.id::text",
    "h.payload_json->>'commandId'=e.command_id::text",
    "h.payload_json->>'picName'=",
    "h.payload_json->>'resumeAllowed'='false'",
    "e.source='AI_TASK' AND e.status='failed'",
    "e.final_ack_verified IS FALSE",
    "t.assigned_to_id IS NULL",
    "other.id<>e.id",
    "RECOVERY_REVIEW_OR_TERMINAL_EXECUTION_NOT_VERIFIED",
  ]) assert.ok(route.includes(required),required);
});

test("existing task admission remains serialized, no duplicate work or authority",()=>{
  const ordinary=src.slice(src.indexOf('router.post("/ai-tasks/:id/gpt02-assign-pic"'),begin);
  const fence="pg_advisory_xact_lock(hashtextextended(";
  assert.ok(route.includes(fence)&&ordinary.includes(fence));
  assert.ok(route.indexOf(fence)<route.indexOf("tx.update(aiTasksTable)"));
  assert.ok(route.includes("isNull(aiTasksTable.assignedToId)"));
  assert.ok(route.includes("LIMIT 1 FOR SHARE OF h,e"));
  assert.ok(route.includes("NOT IN ('completed','cancelled')"));
  assert.ok(route.includes("await tx.insert(auditLogsTable).values("));
  assert.ok(route.includes('action:"gpt02_pic_assigned"'));
  assert.ok(route.includes("operatorApprovalGranted:false,commandDispatched:false"));
  assert.ok(route.includes("nativeAckVerified:false,resumeAllowed:false"));
  assert.doesNotMatch(route,/submitAiTaskCommand|submitAiTaskChatGptCommand|scheduleExecutionTracking|scheduleChatGptDispatchRetry|tx.update\(aiExecutionJobsTable\)/);
});

test("UI explicitly selects member ID only for accepted failed review, with confirmation",()=>{
  for(const required of [
    "gpt02-confirm-recovery-pic",
    'recoveryReview?.humanTask?.status==="accepted"',
    "gpt02RecoveryPicMutation.mutate({memberId,reviewId})",
    'window.confirm("Konfirmasi anggota tim ID "',
    "Job lama tetap FAILED dan penerbitan attempt baru tetap terkunci",
    "gpt02AssignPicMutation.mutate(memberId)",
  ]) assert.ok(ui.includes(required),required);
  assert.match(ui,/Mulai Lifecycle GPT02 \(belum diaktifkan\)/);
});

test("successful PIC link cannot report retry, grant or historical success",()=>{
  for(const name of [
    "recoveryPicOnly:true",
    "operatorApprovalGranted:false",
    "commandDispatched:false",
    "nativeAckVerified:false",
    "resumeAllowed:false",
  ]) assert.ok(route.includes(name),name);
  assert.doesNotMatch(route,/status:"completed"|status:"running"|dispatchPermitted:true|resumeAllowed:true/);
});
