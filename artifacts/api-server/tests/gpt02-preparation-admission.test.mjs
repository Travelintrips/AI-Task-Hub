import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  assessGpt02PreparationAdmission as assess,
  assessGpt02HistoricalInstructionRepair as repair,
} from '../src/lib/gpt02-preparation-admission.mjs';

const task={
  id:171,companyId:'default',source:'manual',title:'GPT02 DEV E2E Task #171',
  description:'DEV-only GPT02 Task #171 E2E. Reply exactly GPT02_DEV_E2E_171_ACK. No external writes.',
  status:'new_inquiry',assignedToId:5,assignedTo:'Admin Cahaya sejati teknologi',
};
const member={id:5,name:'Admin Cahaya sejati teknologi',isActive:true};
const actor={id:'google_103728868378401731050',role:'super_admin',email:'admcst001@gmail.com'};
const payload={
  actorIdentity:{version:1,id:actor.id,role:'super_admin',email:actor.email},
  memberId:5,memberName:member.name,taskId:171,companyId:'default',
  operatorApprovalGranted:false,commandDispatched:false,
};
const audit={id:2622,userEmail:actor.email,after:JSON.stringify(payload)};
const good={task,member,actor,audit,companyId:'default',existingExecutionCount:0};
const deny=(data,reason)=>{const r=assess(data);assert.equal(r.eligible,false);assert.equal(r.reason,reason);assert.equal(r.dispatchPermitted,false);assert.equal(r.operatorApprovalGranted,false)};
test('fresh Task #171 with matching Super Admin PIC audit is PREPARATION ELIGIBLE ONLY',()=>{
  const r=assess(good);
  assert.equal(r.eligible,true);assert.equal(r.reason,'PREPARATION_ELIGIBLE_NO_DISPATCH_AUTHORITY');
  assert.equal(r.instruction,task.description);assert.equal(r.taskId,171);assert.equal(r.auditId,2622);
  assert.equal(r.dispatchPermitted,false);assert.equal(r.operatorApprovalGranted,false);
});
test('actual Task #171 old command-like instruction is rejected',()=>{
  deny({...good,task:{...task,title:'AI Core bridge command 057d9f3d',
    description:'AI Core bridge command 057d9f3d'}},'FRESH_TASK_INSTRUCTION_REQUIRED');
  deny({...good,task:{...task,description:'bridge-command:057d9f3c-f74c-4c4c-ab51-fa43a65dea69'}},
    'FRESH_TASK_INSTRUCTION_REQUIRED');
  deny({...good,task:{...task,description:'DEV replay TASK167_LOCALCACHE_FINAL'}},
    'FRESH_TASK_INSTRUCTION_REQUIRED');
});
test('cross-tenant, historic, wrong status, non-manual source all fail before preparation',()=>{
  for(const patch of [{id:136},{id:0},{companyId:'other'},{status:'completed'},
    {status:'assigned'},{source:'whatsapp'}])
    deny({...good,task:{...task,...patch}},'TASK_SCOPE_OR_STATUS_NOT_READY');
  deny({...good,companyId:'other'},'TASK_SCOPE_OR_STATUS_NOT_READY');
});
test('only active exact PIC FK/name in tenant is eligible',()=>{
  for(const patch of [{id:4},{name:'Robby'},{isActive:false}])
    deny({...good,member:{...member,...patch}},'ACTIVE_PIC_NOT_VERIFIED');
  deny({...good,member:null},'ACTIVE_PIC_NOT_VERIFIED');
  deny({...good,task:{...task,assignedToId:null}},'ACTIVE_PIC_NOT_VERIFIED');
});
test('fresh approved-looking claim cannot bypass identity or actual audit',()=>{
  for(const patch of [{id:'other'},{role:'user'},{email:'other@example.com'}])
    deny({...good,actor:{...actor,...patch}},patch.role?'SUPER_ADMIN_REQUIRED':'PIC_AUDIT_ACTOR_OR_ASSIGNMENT_MISMATCH');
  deny({...good,actor:null},'SUPER_ADMIN_REQUIRED');
  deny({...good,audit:null},'PIC_AUDIT_MISSING');
  deny({...good,audit:{...audit,after:'{broken'}},'PIC_AUDIT_INVALID');
});
test('PIC audit digest, actor ID, and false-only approval fields are mandatory',()=>{
  for(const patch of [
    {taskId:167},{companyId:'other'},{memberId:4},{memberName:'Robby'},
    {operatorApprovalGranted:true},{commandDispatched:true},
    {actorIdentity:{...payload.actorIdentity,role:'user'}},
    {actorIdentity:{...payload.actorIdentity,id:'google_other'}},
    {actorIdentity:{...payload.actorIdentity,version:0}}
  ]) deny({...good,audit:{...audit,after:JSON.stringify({...payload,...patch})}},
    'PIC_AUDIT_ACTOR_OR_ASSIGNMENT_MISMATCH');
});
test('no existing execution may be silently re-prepared or replayed',()=>{
  deny({...good,existingExecutionCount:1},'EXISTING_EXECUTION_REQUIRES_INDEPENDENT_REVIEW');
  deny({...good,existingExecutionCount:Infinity},'EXISTING_EXECUTION_REQUIRES_INDEPENDENT_REVIEW');
});
test('instruction content must be fresh and structurally bounded',()=>{
  for(const instruction of [null,'','short','Contains\nnewline', 'x'.repeat(2001)])
    deny({...good,task:{...task,description:instruction}},'FRESH_TASK_INSTRUCTION_REQUIRED');
});
test('route is off by default, super admin + same origin + intent + scoped pool only',async()=>{
  const route=await readFile(new URL('../src/routes/gpt02-preparation.ts',import.meta.url),'utf8');
  const routes=await readFile(new URL('../src/routes/index.ts',import.meta.url),'utf8');
  for(const expected of ['req.user?.role !== "super_admin"','SAME_ORIGIN_REQUIRED',
    'EXPLICIT_PREPARE_ONLY_INTENT_REQUIRED','GPT02_CORE_PREPARATION_ENABLED',
    'createCoreTaskPreparer({env:process.env,PoolClass:Pool})','assessGpt02PreparationAdmission',
    'operatorApprovalGranted:false','dispatchPermitted:false','continuationScheduled:false',
    'commandDispatched:false']) assert.ok(route.includes(expected),expected);
  assert.ok(routes.includes('router.use(gpt02PreparationRouter);'));
  for(const forbidden of ['submitAiTaskCommand(', 'submitAiTaskChatGptCommand(',
    'createCommand(', 'startExecutionMutation(', 'process.env.SUPABASE_DATABASE_URL_DEV'])
    assert.equal(route.includes(forbidden),false,forbidden);
});

test('exact historical placeholder for Task #171 can be replaced as audited edit, never dispatched',()=>{
  const old='AI Core bridge command 057d9f3d';
  const r=repair({...good,task:{...task,title:old,description:old}});
  assert.equal(r.eligible,true);
  assert.equal(r.taskId,171);
  assert.equal(r.title,'GPT02 DEV fresh E2E Task #171');
  assert.match(r.description,/GPT02_DEV_E2E_171_ACK/);
  assert.doesNotMatch(r.description,/057d9f3[cd]/i);
  assert.equal(r.operatorApprovalGranted,false);
  assert.equal(r.dispatchPermitted,false);
  assert.equal(assess({...good,task:{...task,title:r.title,description:r.description}}).eligible,true);
});
test('only exact old placeholder can be rewritten, not an arbitrary task',()=>{
  const old='AI Core bridge command 057d9f3d';
  for(const patch of [
    {title:'Something else',description:old},
    {title:old,description:'Different body'},
    {title:'AI Core bridge command '+ 'f'.repeat(32),description:'AI Core bridge command '+ 'f'.repeat(32)},
    {title:task.title,description:task.description},
    {title:old,description:old+' extra'},
  ]) {
    const r=repair({...good,task:{...task,...patch}});
    assert.equal(r.eligible,false);
    assert.equal(r.reason,'HISTORICAL_PLACEHOLDER_NOT_VERIFIED');
  }
});
test('no cross-tenant edits, PIC mismatch, or replays can repair an instruction',()=>{
  const old='AI Core bridge command 057d9f3d';
  const input={...good,task:{...task,title:old,description:old}};
  for(const patch of [
    {companyId:'other'},{actor:{...actor,role:'user'}},
    {member:{...member,id:4}},{existingExecutionCount:1},
    {audit:{...audit,after:JSON.stringify({...payload,memberId:4})}},
  ]) {
    const r=repair({...input,...patch});
    assert.equal(r.eligible,false);
    assert.equal(r.dispatchPermitted,false);
  }
});
test('instruction repair route updates only existing task under audit transaction',async()=>{
  const route=await readFile(new URL('../src/routes/gpt02-preparation.ts',import.meta.url),'utf8');
  for(const required of ['gpt02-replace-historical-reference','replace-historical-reference',
    'replaceHistoricalReference!==true','db.transaction(async (tx)','pg_advisory_xact_lock',
    'assessGpt02HistoricalInstructionRepair','eq(aiTasksTable.title,task.title)',
    'eq(aiTasksTable.status,"new_inquiry")','gpt02_e2e_instruction_replaced',
    'commandDispatched:false'])
      assert.ok(route.includes(required),required);
  for(const forbidden of ['submitAiTaskCommand(', 'submitAiTaskChatGptCommand(', 'executeWorker('])
    assert.ok(!route.includes(forbidden),forbidden);
});
test('Super Admin UI correction is explicit, confirmation-gated, and non-dispatching',async()=>{
  const ui=await readFile(new URL('../../ai-task-center/src/pages/ai-task-detail.tsx',import.meta.url),'utf8');
  for(const value of ['gpt02RepairInstructionMutation','replaceHistoricalReference:true',
    'X-GPT02-Intent','replace-historical-reference','window.confirm(',
    'gpt02PicAudit?.auditMatchesCurrent','!executionData?.execution',
    'Perbaiki instruksi Task ini (tanpa dispatch)'])
    assert.ok(ui.includes(value),value);
});
test('DEV Super Admin preparation readiness GET returns evidence only and never prepares',async()=>{
  const route=await readFile(new URL('../src/routes/gpt02-preparation.ts',import.meta.url),'utf8');
  const start=route.indexOf('router.get("/ai-tasks/:id/gpt02-preparation-readiness"');
  const end=route.indexOf('router.post("/ai-tasks/:id/gpt02-prepare"');
  assert.ok(start>0 && end>start);
  const getRoute=route.slice(start,end);
  for(const value of [
    'requireAuth','req.user?.role!=="super_admin"','CST_DEV_COMPANY_SCOPE_REQUIRED',
    'readPreparationFacts(taskId,companyId','process.env.GPT02_CORE_PREPARATION_ENABLED',
    'historicalRepairAvailable:facts.historicalRepair.eligible',
    'canRequestPreparation:featureEnabled&&facts.preparation.eligible',
    'readOnly:true','operatorApprovalGranted:false','dispatchPermitted:false',
    'issuerGrantReady:false','commandDispatched:false',
  ]) assert.ok(getRoute.includes(value),value);
  for(const forbidden of [
    '.prepare(', 'submitAiTaskCommand(', 'submitAiTaskChatGptCommand(',
    'db.update(', 'db.insert(', 'process.env.SUPABASE_DATABASE_URL_DEV',
  ]) assert.equal(getRoute.includes(forbidden),false,forbidden);
});
test('Task detail shows verified readiness and explicit prepare-only button, never worker shortcut',async()=>{
  const ui=await readFile(new URL('../../ai-task-center/src/pages/ai-task-detail.tsx',import.meta.url),'utf8');
  const start=ui.indexOf('data-testid="gpt02-preparation-readiness"');
  const end=ui.indexOf('data-testid="gpt02-operator-readiness"',start);
  assert.ok(start>0 && end>start);
  const section=ui.slice(start,end);
  for(const required of [
    'gpt02PreparationReadiness?.canRequestPreparation',
    'gpt02PrepareOnlyMutation.isPending',
    'gpt02PreparationReadinessFetching',
    'Boolean(executionData?.execution)',
    'window.confirm(', 'Siapkan Core Task (tanpa dispatch)',
    'signed approval, nonce, binding dan issuer lease',
  ]) assert.ok(section.includes(required),required);
  assert.ok(ui.includes('gpt02-preparation-readiness?companyId='));
  assert.ok(ui.includes('gpt02-prepare?companyId='));
  assert.ok(ui.includes('X-GPT02-Intent":"prepare-only"'));
  assert.ok(ui.includes('prepareOnly:true'));
  for(const forbidden of [
    'startExecutionMutation.mutate("worker")', 'startExecutionMutation.mutate("chatgpt")',
  ]) assert.ok(!section.includes(forbidden),forbidden);
});
test('existing GPT02 lifecycle gate and worker fallback gate are unchanged',async()=>{
  const route=await readFile(new URL('../src/routes/executions.ts',import.meta.url),'utf8');
  assert.ok(route.includes('GPT02_PIC_AUDITED_WORKER_FALLBACK_FORBIDDEN'));
  assert.ok(route.includes('GPT02_LIFECYCLE_PRE_DISPATCH_PROOF_REQUIRED'));
  assert.ok(route.includes('GPT02_PREPARED_HUB_CORE_REQUIRES_AUTHORIZED_ISSUER'));
});

test('audited replacement preserves Google subject without inserting it into integer audit FK',async()=>{
  const route=await readFile(new URL('../src/routes/gpt02-preparation.ts',import.meta.url),'utf8');
  const p=route.indexOf('action:"gpt02_e2e_instruction_replaced"');
  assert.ok(p>0,'AUDITED_TASK_REPAIR_ROUTE_REQUIRED');
  const section=route.slice(p,p+1100);
  assert.match(section,/entityType:"ai_task",entityId:taskId,companyId,userId:null/);
  assert.match(section,/actorIdentity:\{version:1,id:String\(req\.user!\.id\)/);
  assert.match(section,/email:req\.user!\.email\.trim\(\)\.toLowerCase\(\),role:"super_admin"/);
  assert.doesNotMatch(section,/userId:req\.user!\.id/);
  assert.match(section,/operatorApprovalGranted:false/);
  assert.match(section,/dispatchPermitted:false/);
});
