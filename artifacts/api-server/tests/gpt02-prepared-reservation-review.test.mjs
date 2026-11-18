import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assessGpt02PreparedReservationReview as review } from "../src/lib/gpt02-prepared-reservation-review.mjs";

const job = () => ({
  id:"11111111-1111-4111-8111-111111111171", taskId:171,companyId:"default",
  status:"prepared",progress:0,commandId:null,workerId:null,
  callbackVerified:false,attestationVerified:false,finalAckVerified:false,
  metadata:{environment:"development",executionType:"managed_prepared",
    lifecycleStart:false,autoContinue:false,dispatchStarted:false,productionAllowed:false},
});
const facts = () => ({
  companyId:"default",hubTaskId:171,
  hubExecutionId:"11111111-1111-4111-8111-111111111171",
  expired:true,coreStatus:"PENDING",
  executionCount:1,hubEventCount:0,coreCommandCount:0,
  responseCount:0,coreRunCount:0,approvalCount:0,issuerEvidenceCount:0,
  leaseCount:0,receiptCount:0,coreReceiptCount:0,
});
const neverAuthorizes = result => {
  assert.equal(result.independentReviewRequired,true);
  assert.equal(result.dispatchPermitted,false);
  assert.equal(result.resumePermitted,false);
  assert.equal(result.operatorApprovalGranted,false);
  assert.equal(result.automaticDispatch,false);
  assert.equal(result.statusChanged,false);
  assert.equal(result.readOnly,true);
  assert.equal(result.uniqueCommandMatch,false);
};

test("one expired, uncommanded Hub/Core preparation is reviewable but NO-GO",()=>{
  const result=review(job(),[facts()]);
  assert.equal(result.reviewReason,"EXPIRED_PREPARED_RESERVATION_REQUIRES_INDEPENDENT_REVIEW");
  assert.equal(result.preparationExpired,true);
  assert.equal(result.evidenceComplete,true);
  assert.equal(result.matchCount,0);
  assert.equal(result.commandId,null);
  assert.equal(result.coreStatus,"PENDING");
  assert.equal(result.archiveChecked,false);
  neverAuthorizes(result);
});
test("live but uncommanded preparation is still NOT authorization",()=>{
  const result=review(job(),[{...facts(),expired:false}]);
  assert.equal(result.reviewReason,"PREPARED_RESERVATION_EXISTS_NO_AUTHORITY");
  assert.equal(result.evidenceComplete,true);
  neverAuthorizes(result);
});
test("missing and duplicate staged preparations fail closed",()=>{
  for(const rows of [[],[facts(),facts()]]) {
    const result=review(job(),rows);
    assert.equal(result.reviewReason,"PREPARATION_LINEAGE_NOT_UNIQUE_OR_INCOMPLETE");
    assert.equal(result.evidenceComplete,false);
    neverAuthorizes(result);
  }
});
test("cross-company, task, execution id or missing Core link cannot be rubber stamped",()=>{
  for(const row of [
    {...facts(),companyId:"1"},
    {...facts(),hubTaskId:170},
    {...facts(),hubExecutionId:"unrelated"},
    {...facts(),coreStatus:null}
  ]){
    const result=review(job(),[row]);
    assert.equal(result.reviewReason,"PREPARATION_LINEAGE_NOT_UNIQUE_OR_INCOMPLETE");
    neverAuthorizes(result);
  }
});
test("Core Task not PENDING and extra Hub attempts remain NO-GO",()=>{
  for(const update of [{coreStatus:"RUNNING"},{coreStatus:"COMPLETED"},{executionCount:2}]){
    const result=review(job(),[{...facts(),...update}]);
    assert.equal(result.reviewReason,"PREPARED_RESERVATION_CONFLICTING_EVIDENCE");
    assert.equal(result.evidenceComplete,false);
    neverAuthorizes(result);
  }
});
test("any command, response, run, event, approval, issuer, lease or receipt is a conflict",()=>{
  for(const field of [
    "hubEventCount","coreCommandCount","responseCount","coreRunCount",
    "approvalCount","issuerEvidenceCount","leaseCount","receiptCount","coreReceiptCount"
  ]) {
    const report=review(job(),[{...facts(),[field]:1}]);
    assert.equal(report.reviewReason,"PREPARED_RESERVATION_CONFLICTING_EVIDENCE",field);
    assert.equal(report.evidenceComplete,false,field);
    if(field==="coreCommandCount")assert.equal(report.matchCount,1);
    neverAuthorizes(report);
  }
});
test("untrusted counts are never interpreted as zero",()=>{
  for(const row of [{...facts(),coreRunCount:null},{...facts(),approvalCount:"0"},{...facts(),hubEventCount:-1}]){
    const r=review(job(),[row]);
    assert.equal(r.reviewReason,"PREPARATION_LINEAGE_NOT_UNIQUE_OR_INCOMPLETE");
    neverAuthorizes(r);
  }
});
test("command, worker or any verification flag on prepared Hub forces manual investigation",()=>{
  for(const patch of [
    {commandId:"22222222-2222-4222-8222-222222222222"},{workerId:"fake-worker"},
    {progress:20},{callbackVerified:true},{attestationVerified:true},
    {finalAckVerified:true},{status:"dispatched"}
  ]){
    const r=review({...job(),...patch},[facts()]);
    assert.equal(r.reviewReason,"PREPARED_RESERVATION_CONFLICTING_EVIDENCE");
    neverAuthorizes(r);
  }
});
test("signed metadata flags must never be overridden by a caller",()=>{
  for(const key of ["lifecycleStart","autoContinue","dispatchStarted","productionAllowed"]){
    const r=review({...job(),metadata:{...job().metadata,[key]:true}},[facts()]);
    assert.equal(r.reviewReason,"PREPARED_RESERVATION_CONFLICTING_EVIDENCE");
    neverAuthorizes(r);
  }
});
test("correct source requires explicit strict DEV classification",()=>{
  const route=readFileSync(new URL("../src/routes/executions.ts",import.meta.url),"utf8");
  const start=route.indexOf('router.get("/ai-tasks/:id/gpt02-reconciliation"');
  const end=route.indexOf('router.post("/ai-tasks/:id/gpt02-adopt-existing"',start);
  assert.ok(start>=0&&end>start);
  const section=route.slice(start,end);
  assert.match(section,/requireAuth/);
  assert.match(section,/job\.status === "prepared"/);
  assert.match(section,/req\.user\?\.role !== "super_admin"/);
  assert.match(section,/assessGpt02PreparedReservationReview\(job, audited\.rows\)/);
  assert.match(section,/s\.company_id=\$\{companyId\}/);
  assert.match(section,/s\.hub_task_id=\$\{taskId\}/);
  assert.match(section,/s\.hub_execution_id=\$\{job\.id\}::uuid/);
  assert.match(section,/core_preparations/);
  assert.match(section,/issuer_lease_consumptions/);
  assert.match(section,/status\(200\)\.json/);
  const beforeCorrelation=section.indexOf('const correlation = metadata["remoteCorrelationId"]');
  assert.ok(section.indexOf('job.status === "prepared"')<beforeCorrelation);
  for(const forbidden of [
    "db.update(","db.insert(","db.delete(","submitAiTaskCommand(",
    "submitAiTaskChatGptCommand(","scheduleExecutionTracking(","scheduleChatGptDispatchRetry(",
    "operatorApprovalGranted:true","dispatchPermitted:true"
  ])assert.equal(section.includes(forbidden),false,forbidden);
});
test("existing task detail reuses the same reconciliation button, with review NO-GO warning",()=>{
  const ui=readFileSync(new URL("../../ai-task-center/src/pages/ai-task-detail.tsx",import.meta.url),"utf8");
  assert.match(ui,/gpt02-prepared-independent-review/);
  assert.match(ui,/reconciliation\.independentReviewRequired/);
  assert.match(ui,/reviewReason/);
  assert.match(ui,/Review independen wajib/);
  assert.match(ui,/tidak memberikan approval, resume, dispatch/);
  assert.match(ui,/Periksa Rekonsiliasi GPT02 \(baca-saja\)/);
});
