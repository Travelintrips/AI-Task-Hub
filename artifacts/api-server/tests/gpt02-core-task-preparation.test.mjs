import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Gpt02CoreTaskPreparer,validateCorePreparationInput as validate,corePreparationPoolConfig,createCoreTaskPreparer} from '../src/lib/gpt02-core-task-preparation.mjs';
const request={companyId:'default',hubTaskId:137,projectName:'GPT02 DEV coding lifecycle',
 repository:'Travelintrips/Core-AI-Foundation',branch:'develop',instruction:'PREPARE ONLY, never issue a command.'};
const ids={core_task_id:'11111111-1111-4111-8111-111111111111',command_candidate_id:'22222222-2222-4222-8222-222222222222',attempt_id:'33333333-3333-4333-8333-333333333333',hub_execution_id:'44444444-4444-4444-8444-444444444444',created:true,dispatch_permitted:false};
const login={login:'gpt02_core_prep_login',session:'gpt02_core_prep_login',limited:true,no_membership:true,no_db_create:true};
const acl={can_dispatch:false,direct_core_write:false,direct_preparation_write:false,direct_hub_write:false};
const actualSchema={hub_operator_id_text:true,hub_numeric_company_nullable:true,hub_tenant_text:true,audit_email_text:true,core_task_uuid:true,hub_execution_uuid:true,hub_task_id_integer_nullable:true,hub_command_uuid_nullable:true,hub_external_id_text:true,hub_source_text:true,hub_status_text:true,hub_metadata_jsonb:true};
function harness({identity=login,permissions=acl,schema=actualSchema,rows=[ids],errorAt=null}={}){
 const statements=[];let destroyed=false;
 const client={async query(sql,params){statements.push({sql,params});if(errorAt&&sql.includes(errorAt))throw Error('synthetic secret must never surface');
  if(sql.includes('current_user AS login'))return {rows:[identity]};
  if(sql.includes('has_table_privilege'))return {rows:[permissions]};
  if(sql.includes('catalog_rows'))return {rows:[{catalog_rows:12,compatible:Object.values(schema).every(Boolean)}]};
  if(sql.includes('gpt02_stage.prepare_core_task'))return {rows};
  return {rows:[]};},release(v){destroyed=v;}};
 const preparer=new Gpt02CoreTaskPreparer({pool:{async connect(){return client}}});
 return {preparer,statements,isDestroyed:()=>destroyed};
}
test('atomic Core PENDING task plus prepared Hub execution never dispatches',async()=>{
 const h=harness(),r=await h.preparer.prepare(request);
 assert.equal(r.preparedNew,true);assert.equal(r.coreTaskId,ids.core_task_id);
 assert.equal(r.commandCandidateId,ids.command_candidate_id);assert.equal(r.attemptId,ids.attempt_id);assert.equal(r.hubExecutionId,ids.hub_execution_id);assert.equal(r.hubExecutionStatus,'prepared');assert.equal(r.commandIssued,false);
 assert.equal(r.dispatchPermitted,false);assert.equal(r.lifecycleStartPermitted,false);
 assert.equal(r.issuerGrantReady,false);assert.equal(r.operatorApprovalRecorded,false);
 assert.deepEqual(h.statements.filter(x=>x.sql.includes('gpt02_stage.prepare_core_task')).map(x=>x.params),[
  ['default',137,'GPT02 DEV coding lifecycle','Travelintrips/Core-AI-Foundation','develop',request.instruction]
 ]);
 assert.ok(h.statements.some(x=>x.sql==='BEGIN')&&h.statements.some(x=>x.sql==='COMMIT'));
 assert.equal(h.isDestroyed(),true);
});
test('prepared existing attempt is never a fresh grant or new task',async()=>{
 const h=harness({rows:[{...ids,created:false}]}),r=await h.preparer.prepare(request);
 assert.equal(r.preparedNew,false);assert.equal(r.attemptId,ids.attempt_id);assert.equal(r.hubExecutionId,ids.hub_execution_id);assert.equal(r.dispatchPermitted,false);
});
test('Task135, Task136, wrong tenant, repo, branch or workflow are denied before connect',async()=>{
 let connects=0;const p=new Gpt02CoreTaskPreparer({pool:{async connect(){connects++;throw Error('should not connect')}}});
 for(const patch of [{hubTaskId:135},{hubTaskId:136},{hubTaskId:0},{hubTaskId:137.5},{companyId:'other'},
  {repository:'Travelintrips/Sport-Center-Admin'},{branch:'main'},{projectName:'text-only'},
  {instruction:''},{instruction:'a'.repeat(2001)},{instruction:'multiline\nnot allowed'},{operatorApprovalGranted:true},
  {issuerPermitted:true},{coreTaskId:ids.core_task_id},{commandCandidateId:ids.command_candidate_id},
  {nonce:'fake'},{superAdminId:'google_fake'}])
  await assert.rejects(p.prepare({...request,...patch}),e=>e.code==='OUT_OF_SCOPE_PREPARATION'||e.code==='UNTRUSTED_PREPARATION_INPUT');
 assert.equal(connects,0);
});
test('wrong login, membership, admin grants or direct DML all fail closed with rollback',async()=>{
 for(const change of [
  {identity:{...login,login:'postgres'}},{identity:{...login,session:'postgres'}},
  {identity:{...login,limited:false}},{identity:{...login,no_membership:false}},
  {identity:{...login,no_db_create:false}},{permissions:{...acl,can_dispatch:true}},
  {permissions:{...acl,direct_core_write:true}},{permissions:{...acl,direct_preparation_write:true}},{permissions:{...acl,direct_hub_write:true}}]){
  const h=harness(change);await assert.rejects(h.preparer.prepare(request),e=>e.code==='UNSAFE_PREPARER_DATABASE_IDENTITY'||e.code==='DIRECT_CORE_TABLE_PRIVILEGES_FORBIDDEN');
  assert.equal(h.statements.some(x=>x.sql.includes('gpt02_stage.prepare_core_task')),false);
  assert.equal(h.statements.some(x=>x.sql==='ROLLBACK'),true);assert.equal(h.isDestroyed(),true);
 }
});
test('wrong hosted user/company/tenant/core column shape blocks preparer before any SQL write',async()=>{
 for(const key of Object.keys(actualSchema)){
  const h=harness({schema:{...actualSchema,[key]:false}});
  await assert.rejects(h.preparer.prepare(request),e=>e.code==='HOSTED_IDENTITY_SCHEMA_MISMATCH');
  assert.equal(h.statements.some(x=>x.sql.includes('gpt02_stage.prepare_core_task')),false);
  assert.ok(h.statements.some(x=>x.sql==='ROLLBACK'));
 }
 const h=harness({schema:{...actualSchema,hub_numeric_company_nullable:null}});
 await assert.rejects(h.preparer.prepare(request),e=>e.code==='HOSTED_IDENTITY_SCHEMA_MISMATCH');
 assert.equal(h.statements.some(x=>x.sql.includes('gpt02_stage.prepare_core_task')),false);
});
test('malformed DB output never becomes false evidence of preparation',async()=>{
 for(const rows of [[],[ids,ids],[{...ids,dispatch_permitted:true}],[{...ids,command_candidate_id:ids.core_task_id}],[{...ids,core_task_id:'fake'}],[{...ids,created:'true'}],[{...ids,hub_execution_id:ids.core_task_id}],[{...ids,hub_execution_id:null}]]){
  const h=harness({rows});await assert.rejects(h.preparer.prepare(request),e=>e.code==='PREPARATION_RESULT_NOT_TRUSTWORTHY');
  assert.equal(h.statements.at(-1).sql,'ROLLBACK');assert.equal(h.isDestroyed(),true);
 }
});
test('database errors are sanitized, transaction is rolled back and connection destroyed',async()=>{
 const h=harness({errorAt:'gpt02_stage.prepare_core_task'});
 await assert.rejects(h.preparer.prepare(request),e=>e.code==='CORE_PREPARATION_TRANSACTION_FAILED'&&!e.message.includes('secret'));
 assert.equal(h.statements.at(-1).sql,'ROLLBACK');assert.equal(h.isDestroyed(),true);
});
const ref='xssrfshdrtdfupgqwfdw',other='p'.repeat(20);
const pinnedCa=readFileSync(new URL('../../../scripts/dev/fixtures/supabase-root-ca-2021.crt',import.meta.url),'utf8');
const env={NODE_ENV:'development',APP_ENV:'development',GPT02_CORE_PREP_DEV_PROJECT_REF:ref,GPT02_HUB_DEV_PROJECT_REF:ref,
 GPT02_PROD_PROJECT_REF:other,GPT02_CORE_PREP_DEV_POOLER_HOST:'aws-1-ap-southeast-2.pooler.supabase.com',
 GPT02_CORE_PREP_DEV_CA:pinnedCa,
 GPT02_CORE_PREP_DATABASE_URL_DEV:`postgresql://gpt02_core_prep_login.${ref}:synthetic@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres`};
test('candidate connector pins CST-DEV, dedicated identity, session-port and TLS',()=>{
 const config=corePreparationPoolConfig(env);
 assert.equal(config.max,1);assert.equal(config.ssl.rejectUnauthorized,true);
 assert.equal(config.ssl.ca,pinnedCa);
 assert.ok(config.connectionString.includes(`gpt02_core_prep_login.${ref}`));
});
test('configuration refuses PROD, unapproved project, insecure transport and pooler fallback',()=>{
 for(const patch of [{NODE_ENV:'production'},{APP_ENV:'production'},{NODE_TLS_REJECT_UNAUTHORIZED:'0'},
  {GPT02_CORE_PREP_DEV_PROJECT_REF:other},{GPT02_HUB_DEV_PROJECT_REF:other},
  {GPT02_CORE_PREP_DEV_PROJECT_REF:other,GPT02_HUB_DEV_PROJECT_REF:other},
  {GPT02_PROD_PROJECT_REF:ref},{GPT02_PROD_PROJECT_REF:null},
  {GPT02_CORE_PREP_DEV_CA:'none'},
  {GPT02_CORE_PREP_DEV_CA:'-----BEGIN CERTIFICATE-----\nsynthetic fixture only\n-----END CERTIFICATE-----'},
  {GPT02_CORE_PREP_DEV_CA:pinnedCa+pinnedCa},
  {GPT02_CORE_PREP_DEV_CA:pinnedCa+'\n-----BEGIN CERTIFICATE-----\nmalicious\n-----END CERTIFICATE-----'},
  {GPT02_CORE_PREP_DEV_CA:pinnedCa.replace('BEGIN CERTIFICATE','BEGIN OTHER')},
  {GPT02_CORE_PREP_DEV_CA:pinnedCa+'unexpected trailing characters'},
  {GPT02_CORE_PREP_DEV_POOLER_HOST:'127.0.0.1'},
  {GPT02_CORE_PREP_DATABASE_URL_DEV:env.GPT02_CORE_PREP_DATABASE_URL_DEV.replace('gpt02_core_prep_login','postgres')},
  {GPT02_CORE_PREP_DATABASE_URL_DEV:env.GPT02_CORE_PREP_DATABASE_URL_DEV.replace(':5432',':6543')},
  {GPT02_CORE_PREP_DATABASE_URL_DEV:env.GPT02_CORE_PREP_DATABASE_URL_DEV+'?sslmode=disable'}])
  assert.throws(()=>corePreparationPoolConfig({...env,...patch}));
});
test('failed config validation never constructs a pool or reveals secrets',()=>{
 let constructed=false;class Pool{constructor(){constructed=true}}
 const secret='shouldneverappear';
 try{createCoreTaskPreparer({env:{...env,GPT02_CORE_PREP_DATABASE_URL_DEV:`postgresql://postgres:${secret}@localhost:5432/postgres`},PoolClass:Pool});assert.fail('expected denial')}
 catch(e){assert.equal(e.message.includes(secret),false);assert.equal(constructed,false)}
});
test('module is not imported by any live HTTP route or worker',()=>{
 const routes=readFileSync(new URL('../src/routes/executions.ts',import.meta.url),'utf8');
 assert.equal(routes.includes('gpt02-core-task-preparation'),false);
 assert.equal(routes.includes('gpt02_stage.prepare_core_task'),false);
 assert.match(routes,/GPT02_LIFECYCLE_PRE_DISPATCH_PROOF_REQUIRED/);
});

test('preparer certificate is a single pinned Supabase root and cannot be replaced by a second root',()=>{
 const good=corePreparationPoolConfig(env);
 assert.equal(good.ssl.rejectUnauthorized,true);
 for(const wrong of [
  pinnedCa+pinnedCa,
  '\\n'+pinnedCa,
  pinnedCa+'-----BEGIN CERTIFICATE-----\\nATTACKER\\n-----END CERTIFICATE-----',
  pinnedCa.replace('END CERTIFICATE','END OTHER'),
  '-----BEGIN CERTIFICATE-----\\ninvalid\\n-----END CERTIFICATE-----'
 ]) assert.throws(()=>corePreparationPoolConfig({...env,GPT02_CORE_PREP_DEV_CA:wrong}),
  e=>e.code==='PINNED_PREPARER_CA_REQUIRED');
});
test('a matching but foreign project is never treated as CST-DEV and cannot create a PostgreSQL pool',()=>{
 let built=0;
 class Pool{constructor(){built++}}
 const alternate={...env,GPT02_CORE_PREP_DEV_PROJECT_REF:other,GPT02_HUB_DEV_PROJECT_REF:other,
  GPT02_CORE_PREP_DATABASE_URL_DEV:env.GPT02_CORE_PREP_DATABASE_URL_DEV.replaceAll(ref,other)};
 assert.throws(()=>createCoreTaskPreparer({env:alternate,PoolClass:Pool}),e=>e.code==='PINNED_CST_DEV_PROJECT_REQUIRED');
 assert.equal(built,0);
});
