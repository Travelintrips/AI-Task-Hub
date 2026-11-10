import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {canonicalOperatorLink} from '../src/lib/gpt02-operator-link.mjs';
import {createGpt02TrustedFactReader,HUB_SQL,CORE_SQL,
 validRequestedIdentity} from '../src/lib/gpt02-trusted-facts-readonly.mjs';

const now=Date.now();
const U=()=>randomUUID();
function fixture(){
 const coreTaskId=U(),executionId=U(),commandId=U(),attemptId=U(),linkId=U();
 const link={v:1,environment:'DEV',audience:'GPT02_DUAL_ACCOUNT_COMMAND_LINK',
  linkId,companyId:'default',hubTaskId:137,hubExecutionId:executionId,
  coreTaskId,coreCommandId:commandId,attemptId,attemptNumber:1,
  assigneeId:5,accountableOwnerId:'fixture_owner',
  hubOperatorNamespace:'ai-task-hub.public.users',
  hubOperatorId:'google_fixture_super_admin',hubRole:'super_admin',hubActive:true,
  coreOperatorNamespace:'ai-core.ai_platform.internal_users',coreOperatorUserId:77,
  coreRole:'admin',coreActive:true,corePasswordChanged:true,
  workerId:'openclaw-dell-chatgpt-wake-dev',approvalDigest:'e'.repeat(64),
  nonce:'A'.repeat(44),issuedAt:now-1000,expiresAt:now+45000};
 const meta={commandCandidateId:commandId,coreTaskId,attemptId,
  memberId:5,memberAuditId:4567,operatorSubject:link.hubOperatorId,
  attemptNumber:1,dispatchStarted:false,autoContinue:false,
  accountAlias:'GPT02',environment:'development',
  verificationMode:'chatgpt-attested',productionAllowed:false,
  executionType:'managed_prepared',lifecycleStart:false};
 const audit={taskId:137,companyId:'default',memberId:5,
  memberName:'Synthetic PIC',actorIdentity:{
   version:1,role:'super_admin',id:link.hubOperatorId,email:'admin@example.invalid'
  }};
 const hub={
  company_id:'default',hub_task_id:137,member_id:5,member_audit_id:4567,
  operator_subject:link.hubOperatorId,core_task_id:coreTaskId,
  hub_execution_id:executionId,command_candidate_id:commandId,attempt_id:attemptId,
  expires_ms:now+60000,assigned_to_id:5,assigned_to:'Synthetic PIC',
  task_status:'open',task_title:'Synthetic new task',
  member_name:'Synthetic PIC',member_active:true,
  hub_user_id:link.hubOperatorId,hub_role:'super_admin',
  hub_active:true,hub_status:'active',hub_company_id:null,
  hub_email:'admin@example.invalid',
  audited_member_record:4567,audit_company_id:'default',
  audit_action:'gpt02_pic_assigned',audit_entity_id:'137',
  audit_payload:audit,audit_user_email:'admin@example.invalid',
  latest_pic_audit_id:4567,
  job_company_id:'default',job_task_id:137,job_status:'prepared',
  job_source:'AI_TASK',job_external_id:'ai-task:default:137',
  job_idempotency_key:'gpt02-managed-preparation:default:137',
  job_title:'Synthetic new task',job_instruction:'Synthetic instruction',
  job_progress:0,callback_verified:false,attestation_verified:false,
  final_ack_verified:false,hub_execution_count:1,
  job_command_id:null,job_worker_id:null,job_assigned_client_id:null,job_metadata:meta,
  link_id:linkId,accountable_owner_id:link.accountableOwnerId,
  hub_operator_id:link.hubOperatorId,core_operator_user_id:77,
  signed_link_claims:link,approval_digest:link.approvalDigest,
  link_digest:createHash('sha256').update(canonicalOperatorLink(link)).digest('hex'),
  hub_signature:'A'.repeat(86),core_signature:'B'.repeat(86)};
 const core={core_task_id:coreTaskId,core_status:'PENDING',
  core_task_number:'GPT02DEV-137-abcdef',core_repository:'Travelintrips/Core-AI-Foundation',
  core_branch:'develop',core_instruction:'Synthetic instruction',
  core_operator_user_id:77,core_role:'admin',core_operator_status:'active',
  must_change_password:false,run_count:0,command_count:0};
 return {hub,core,lookup:{companyId:'default',hubTaskId:137,
  commandCandidateId:commandId,attemptId}};
}
function instance({hub,core,lookup}=fixture(),patch={}){
 const calls=[],released=[];
 function client(which){
  const role=which==='hub'?'gpt02_hub_evidence_reader':'gpt02_core_evidence_reader';
  return {
   async query(sql,params){
    calls.push({which,sql,params});
    if(patch.error===which&&sql===(which==='hub'?HUB_SQL:CORE_SQL))
      throw Error('synthetic_database_secret');
    if(sql.includes("current_setting('transaction_read_only')")){
     return {rows:[{db:'postgres',login:role,session:role,read_only:'on',
       restricted:true,no_memberships:true,no_global_read:true,
       no_global_write:true,no_db_create:true,
       ...(patch.identity?.[which]||{})}]};
    }
    if(sql===HUB_SQL)return {rows:patch.hubRows??[hub]};
    if(sql===CORE_SQL)return {rows:patch.coreRows??[core]};
    return {rows:[]};
   },
   release(force){released.push({which,force});}
  };
 }
 const hubClient=client('hub'),coreClient=client('core');
 const hubPool={connect:async()=>hubClient};
 const corePool={connect:async()=>patch.sameSession?hubClient:coreClient};
 return {reader:createGpt02TrustedFactReader({hubPool,corePool,clock:()=>now}),
   lookup,calls,released};
}
test('two authenticated scoped READ ONLY sessions reconstruct exact signed-sidecar Hub/Core facts',async()=>{
 const x=instance();
 const v=await x.reader(x.lookup);
 assert.equal(v.prepared.hubTaskId,137);
 assert.equal(v.core.operatorUserId,77);
 assert.equal(v.core.workerId,'openclaw-dell-chatgpt-wake-dev');
 assert.equal(v.hubOperator.accountableOwnerId,'fixture_owner');
 assert.equal(v.job.status,'prepared');
 assert.equal(v.observedAt,now);
 assert.equal(x.calls.filter(c=>c.sql==='BEGIN READ ONLY').length,2);
 assert.equal(x.calls.filter(c=>c.sql==='ROLLBACK').length,2);
 assert.equal(x.calls.filter(c=>c.sql===HUB_SQL).length,1);
 assert.equal(x.calls.filter(c=>c.sql===CORE_SQL).length,1);
 assert.deepEqual(x.released,[{which:'hub',force:true},{which:'core',force:true}]);
});
test('reject historical Tasks135/136, wrong tenant, caller-supplied fields and invalid IDs before opening DB',async()=>{
 const x=instance();
 for(const q of [
  {...x.lookup,hubTaskId:135},{...x.lookup,hubTaskId:136},
  {...x.lookup,companyId:'other'}, {...x.lookup,coreTaskId:U()},
  {...x.lookup,attemptId:'broken'},{...x.lookup,commandCandidateId:x.lookup.attemptId}
 ]){
  assert.equal(validRequestedIdentity(q),false);
  await assert.rejects(x.reader(q),e=>e.code==='UNTRUSTED_TASK_IDENTITY');
 }
 assert.equal(x.calls.length,0);
});
for(const change of [
 {login:'postgres'},{session:'postgres'},{read_only:'off'},
 {restricted:false},{no_memberships:false},{no_global_read:false},
 {no_global_write:false},{no_db_create:false},{db:'production'}
])test('deny forged or privileged Hub DB identity '+JSON.stringify(change),async()=>{
 const x=instance(fixture(),{identity:{hub:change}});
 await assert.rejects(x.reader(x.lookup),e=>e.code==='TWO_INDEPENDENT_RESTRICTED_DB_LOGINS_REQUIRED');
 assert.equal(x.calls.some(c=>c.sql===HUB_SQL),false);
});
test('two distinct pools cannot masquerade as one backend connection',async()=>{
 const x=instance(fixture(),{sameSession:true});
 await assert.rejects(x.reader(x.lookup),e=>e.code==='SEPARATE_DB_SESSIONS_REQUIRED');
});
test('absence, duplicate signed Hub sidecar and missing Core operator fail closed',async()=>{
 for(const opts of [{hubRows:[]},{hubRows:[fixture().hub,fixture().hub]},{coreRows:[]}]){
  const x=instance(fixture(),opts);
  await assert.rejects(x.reader(x.lookup));
 }
});
for(const [where,change] of [
 ['hub',{member_active:false}],['hub',{hub_active:false}],
 ['hub',{audit_action:'unrelated'}],['hub',{audit_entity_id:'138'}],
 ['hub',{latest_pic_audit_id:4568}],['hub',{audit_payload:'{}'}],
 ['hub',{hub_company_id:3}],['hub',{hub_email:'different@example.invalid'}],
 ['hub',{job_source:'OTHER'}],['hub',{job_idempotency_key:'replayed'}],
 ['hub',{job_progress:30}],['hub',{callback_verified:true}],
 ['hub',{final_ack_verified:true}],['hub',{hub_execution_count:2}],
 ['hub',{job_external_id:'wrong'}],['hub',{job_instruction:'changed'}],
 ['hub',{job_title:'changed'}],['core',{core_repository:'other/repo'}],
 ['core',{core_branch:'main'}],
 ['hub',{hub_status:'suspended'}],['hub',{job_status:'running'}],
 ['hub',{job_command_id:U()}],['hub',{task_status:'completed'}],
 ['hub',{assigned_to_id:11}],['hub',{audit_company_id:'another'}],
 ['hub',{core_operator_user_id:78}],['hub',{link_digest:'f'.repeat(64)}],
 ['hub',{hub_signature:'invalid'}],
 ['core',{command_count:1}],['core',{run_count:1}],
 ['core',{core_role:'staff'}],['core',{core_operator_status:'suspended'}],
 ['core',{must_change_password:true}],['core',{core_task_id:U()}]
])test('deny incompatible hosted immutable '+where+' record '+Object.keys(change)[0],async()=>{
 const v=fixture();v[where]={...v[where],...change};
 const x=instance(v);
 await assert.rejects(x.reader(x.lookup));
});
test('canonical numeric/string audit identifiers both match preparer SQL semantics',async()=>{
 const v=fixture();
 v.hub.audit_payload={...v.hub.audit_payload,taskId:'137',memberId:'5',
  actorIdentity:{...v.hub.audit_payload.actorIdentity,version:'1'}};
 const x=instance(v);
 const result=await x.reader(x.lookup);
 assert.equal(result.prepared.hubTaskId,137);
 assert.equal(result.hubOperator.role,'super_admin');
});
test('a newer Super Admin PIC audit blocks a stale signed preparation',async()=>{
 const v=fixture();v.hub.latest_pic_audit_id=4569;
 const x=instance(v);
 await assert.rejects(x.reader(x.lookup),e=>e.code==='SUPER_ADMIN_ASSIGNMENT_AUDIT_MISMATCH');
});
test('malformed or forged assignment actor identity blocks future nonce',async()=>{
 for(const patch of [
  {actorIdentity:{version:1,role:'staff',id:'google_fixture_super_admin',email:'admin@example.invalid'}},
  {memberId:6},
  {companyId:'other'}
 ]){
  const v=fixture();v.hub.audit_payload={...v.hub.audit_payload,...patch};
  const x=instance(v);
  await assert.rejects(x.reader(x.lookup),e=>e.code==='SUPER_ADMIN_ASSIGNMENT_AUDIT_MISMATCH');
 }
});
test('altered signed worker claim fails the canonical digest and cannot become a worker lease',async()=>{
 const v=fixture();
 v.hub.signed_link_claims={...v.hub.signed_link_claims,workerId:'other-worker'};
 const x=instance(v);
 await assert.rejects(x.reader(x.lookup),e=>e.code==='SIGNED_LINK_LEDGER_DIGEST_MISMATCH');
});
test('prepared snapshot expiry never becomes trusted evidence',async()=>{
 const v=fixture();v.hub.expires_ms=now-1;
 const x=instance(v);
 await assert.rejects(x.reader(x.lookup),e=>e.code==='SIGNED_PREPARATION_EXPIRED');
});
test('query failure is sanitized and both transactions roll back',async()=>{
 const x=instance(fixture(),{error:'core'});
 await assert.rejects(x.reader(x.lookup),e=>e.code==='INDEPENDENT_READ_FAILED_CLOSED');
 assert.equal(x.calls.filter(c=>c.sql==='ROLLBACK').length,2);
 assert.equal(x.released.length,2);
});
test('source SQL is strictly parameterized SELECT and contains no dispatch/mutation paths',()=>{
 for(const sql of [HUB_SQL,CORE_SQL]){
  assert.match(sql,/^SELECT /);
  const normalized=sql.replace(/'(?:''|[^'])*'/g,"''");
  assert.doesNotMatch(normalized,/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|CALL|COPY)\b/i);
 }
 assert.match(HUB_SQL,/gpt02_private\.operator_links/);
 assert.match(HUB_SQL,/\$3::uuid/);
 assert.match(CORE_SQL,/ai_platform\.internal_users/);
 const src=readFileSync(new URL('../src/lib/gpt02-trusted-facts-readonly.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(src,/submitAiTaskChatGptCommand\(|dispatchCommand\(|sendCommand\(/);
});
