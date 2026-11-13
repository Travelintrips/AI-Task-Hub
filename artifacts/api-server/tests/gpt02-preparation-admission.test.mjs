import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assessGpt02PreparationAdmission as assess} from '../src/lib/gpt02-preparation-admission.mjs';

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
