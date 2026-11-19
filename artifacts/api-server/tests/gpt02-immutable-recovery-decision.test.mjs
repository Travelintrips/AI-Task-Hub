import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {assessGpt02PreparedReservationReview as review} from "../src/lib/gpt02-prepared-reservation-review.mjs";
import {decideGpt02ImmutableRecovery as decide} from "../src/lib/gpt02-immutable-recovery-decision.mjs";

const job=()=>({
 id:"11111111-1111-4111-8111-111111111171",
 taskId:171,companyId:"default",status:"prepared",progress:0,
 commandId:null,workerId:null,callbackVerified:false,
 attestationVerified:false,finalAckVerified:false,
 metadata:{environment:"development",executionType:"managed_prepared",
 lifecycleStart:false,autoContinue:false,dispatchStarted:false,productionAllowed:false},
});
const fact=()=>({
 companyId:"default",hubTaskId:171,hubExecutionId:job().id,expired:true,
 coreStatus:"PENDING",executionCount:1,hubEventCount:0,coreCommandCount:0,
 responseCount:0,coreRunCount:0,approvalCount:0,issuerEvidenceCount:0,
 leaseCount:0,receiptCount:0,coreReceiptCount:0,
});
const proof=()=>({archiveChecked:true,archiveMatchCount:0,immutableTriggerVerified:true});
const noAuthority=r=>{
 assert.equal(r.historicalReservationPreserved,true);
 assert.equal(r.sameTaskRepreparePermitted,false);
 assert.equal(r.newTaskCreated,false);
 assert.equal(r.approvalRecorded,false);
 assert.equal(r.secondHumanAdminApprovalRequired,false);
 assert.equal(r.singleOwnerApprovalRequiredForExecution,true);
 assert.equal(r.issuerVerificationStillRequired,true);
 assert.equal(r.dispatchPermitted,false);
 assert.equal(r.resumePermitted,false);
 assert.equal(r.readOnly,true);
};
test("full independent ledger+immutable evidence gives technical disposition, NOT execution permission",()=>{
 const current=review(job(),[fact()]);
 const r=decide(current,proof());
 assert.equal(r.technicalEvidenceReviewed,true);
 assert.equal(r.reason,"EXPIRED_IMMUTABLE_RESERVATION_LINKED_NEW_TASK_REQUIRED");
 assert.equal(r.nextAction,"CREATE_LINKED_FRESH_DEV_TASK_WITH_EXPLICIT_OWNER_CONSENT");
 assert.equal(r.oldTaskId,171);
 assert.equal(r.archiveMatchCount,0);
 assert.equal(r.immutableTriggerVerified,true);
 noAuthority(r);
});
test("a preparation on same Task must NEVER be replayable, even after technical review",()=>{
 const r=decide(review(job(),[fact()]),proof());
 noAuthority(r);
 assert.equal(r.sameTaskRepreparePermitted,false);
 assert.equal(r.newTaskCreated,false);
});
test("missing/unverified archive, archive command and immutable trigger deny resolution",()=>{
 for(const p of [null,{}, {archiveChecked:false,archiveMatchCount:0,immutableTriggerVerified:true},
  {archiveChecked:true,archiveMatchCount:null,immutableTriggerVerified:true},
  {archiveChecked:true,archiveMatchCount:-1,immutableTriggerVerified:true},
  {archiveChecked:true,archiveMatchCount:"0",immutableTriggerVerified:true},
  {archiveChecked:true,archiveMatchCount:1,immutableTriggerVerified:true},
  {archiveChecked:true,archiveMatchCount:0,immutableTriggerVerified:false},
  {archiveChecked:true,archiveMatchCount:0,immutableTriggerVerified:undefined}]){
   const r=decide(review(job(),[fact()]),p);
   assert.equal(r.technicalEvidenceReviewed,false,JSON.stringify(p));
   assert.equal(r.nextAction,"HOLD_NO_REPLAY");
   noAuthority(r);
 }
});
test("each live command/issuer/event/worker conflict blocks technical completion",()=>{
 for(const prop of ["hubEventCount","coreCommandCount","responseCount",
  "coreRunCount","approvalCount","issuerEvidenceCount","leaseCount",
  "receiptCount","coreReceiptCount"]){
   const r=decide(review(job(),[{...fact(),[prop]:1}]),proof());
   assert.equal(r.technicalEvidenceReviewed,false,prop);
   noAuthority(r);
 }
 for(const patch of [
  {commandId:"22222222-2222-4222-8222-222222222222"},
  {workerId:"synthetic-worker"},{progress:1},{status:"dispatched"},
  {finalAckVerified:true},{callbackVerified:true}]){
  const r=decide(review({...job(),...patch},[fact()]),proof());
  assert.equal(r.technicalEvidenceReviewed,false,JSON.stringify(patch));
  noAuthority(r);
 }
});
test("missing/wrong tenant or active (nonexpired) reservation never qualifies",()=>{
 for(const facts of [
  [],[fact(),fact()],[{...fact(),expired:false}],
  [{...fact(),companyId:"other"}],
  [{...fact(),hubTaskId:172}],
  [{...fact(),coreStatus:"COMPLETED"}]
 ]){
  const r=decide(review(job(),facts),proof());
  assert.equal(r.technicalEvidenceReviewed,false);
  noAuthority(r);
 }
});
test("new read-only verification stays inside existing Task171 GET, not creation/writer route",()=>{
 const code=readFileSync(new URL("../src/routes/executions.ts",import.meta.url),"utf8");
 const start=code.indexOf('router.get("/ai-tasks/:id/gpt02-reconciliation"');
 const stop=code.indexOf('router.post("/ai-tasks/:id/gpt02-adopt-existing"',start);
 assert.ok(start>0&&stop>start);
 const route=code.slice(start,stop);
 for(const marker of [
  "decideGpt02ImmutableRecovery(review",
  "immutableTriggerVerified",
  "gpt02_preparation_immutable",
  "reject_preparation_mutation()",
  "gpt02_dev_command_archive_20261030",
  "archiveChecked",
  "archiveMatchCount",
  "coreTaskId",
  "commandCandidateId",
  "res.status(200).json({...review, recoveryDecision})",
 ])assert.ok(route.includes(marker),marker);
 for(const writer of ["db.insert(","db.update(","db.delete(","db.transaction(",
  "scheduleExecutionTracking(","scheduleChatGptDispatchRetry(",
  "submitAiTaskCommand(","submitAiTaskChatGptCommand("])
  assert.ok(!route.includes(writer),writer);
});
test("Task171 UI explains no second admin; only one Owner authorization later",()=>{
 const ui=readFileSync(new URL("../../ai-task-center/src/pages/ai-task-detail.tsx",import.meta.url),"utf8");
 assert.match(ui,/gpt02-immutable-recovery-decision/);
 assert.match(ui,/Audit teknis otomatis selesai/);
 assert.match(ui,/tidak perlu persetujuan admin kedua/i);
 assert.match(ui,/Task DEV E2E baru yang tertaut audit/);
 assert.match(ui,/satu persetujuan Owner\/Super Admin/);
 assert.match(ui,/Belum ada Task baru dibuat oleh pemeriksaan ini/);
 assert.match(ui,/Status eksekusi sekarang tetap NO-GO/);
 assert.match(ui,/gpt02-immutable-recovery-hold/);
});
