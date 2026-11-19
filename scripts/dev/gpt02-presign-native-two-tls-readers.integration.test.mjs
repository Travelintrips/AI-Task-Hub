import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createGpt02PreSignFactReader} from '../../pr196-verifier-reference/artifacts/api-server/src/lib/gpt02-presign-facts-readonly.mjs';
import {createGpt02SingleOwnerTrustedFactAdapter} from '../../artifacts/api-server/src/lib/gpt02-single-owner-trusted-facts-adapter.mjs';
if(process.env.GPT02_TWO_TLS_READERS_DISPOSABLE_ONLY!=='1')throw Error('DISPOSABLE_TWO_READER_TEST_REQUIRED');
const {Pool}=createRequire(import.meta.url)('../api-server/node_modules/pg');
const passwords=JSON.parse(readFileSync('/run/fixture-auth.json','utf8'));
const ca=readFileSync('/run/ssl/server.crt','utf8');
const common={host:'synthetic-pg',port:5432,database:'postgres',max:2,
 connectionTimeoutMillis:3000,statement_timeout:5000,
 ssl:{ca,rejectUnauthorized:true}};
const poolFor=user=>new Pool({...common,user,password:passwords[user],
 application_name:'gpt02_isolated_presign_'+user});
const hub=poolFor('gpt02_hub_evidence_reader');
const core=poolFor('gpt02_core_evidence_reader');
const admin=poolFor('postgres');
const query={companyId:'default',hubTaskId:172,
 commandCandidateId:'33333333-3333-4333-8333-333333333333',
 attemptId:'44444444-4444-4444-8444-444444444444'};
const readPreSignFacts=createGpt02PreSignFactReader({hubPool:hub,corePool:core});
const readAdapter=createGpt02SingleOwnerTrustedFactAdapter({
 readPreSignFacts,env:{NODE_ENV:'development',APP_ENV:'development'},maxAgeMs:2000});
test('two independently authenticated SCRAM/TLS reader roles map real PostgreSQL facts without authority',async()=>{
 const x=await readAdapter(query);
 assert.equal(x.prepared.hubTaskId,172);
 assert.equal(x.job.commandId,null);
 assert.equal(x.job.dispatchStarted,false);
 assert.equal(x.core.status,'PENDING');
 assert.equal(x.core.operatorUserId,77);
 assert.equal(x.hubOperator.subject,'fixture_owner_7');
 assert.equal(Object.isFrozen(x),true);
 for(const y of Object.values(x))assert.equal(Object.isFrozen(y),true);
});
test('both real sessions enforce read-only role defaults, independent identities and SSL',async()=>{
 const [h,c]=await Promise.all([hub.connect(),core.connect()]);
 try{
  const check=async(client,user)=>{
   const r=(await client.query(`SELECT session_user,current_user,
    current_setting('default_transaction_read_only') AS default_read_only,
    EXISTS(SELECT 1 FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl) AS ssl`)).rows[0];
   assert.equal(r.session_user,user);assert.equal(r.current_user,user);
   assert.equal(r.default_read_only,'on');assert.equal(r.ssl,true);
   assert.equal(client.connection.stream.encrypted,true);
   assert.equal(client.connection.stream.authorized,true);
  };
  await Promise.all([check(h,'gpt02_hub_evidence_reader'),check(c,'gpt02_core_evidence_reader')]);
  for(const p of [h,c])await assert.rejects(
    p.query("INSERT INTO public.ai_tasks(id,company_id) VALUES(2999,'default')"));
 }finally{h.release(true);c.release(true)}
});
test('actual reader and adapter reject mismatched immutable Core ledger source',async()=>{
 await admin.query("UPDATE ai_platform.ai_coding_tasks SET status='COMPLETED' WHERE id=$1",
 ['11111111-1111-4111-8111-111111111111']);
 try{
  await assert.rejects(readAdapter(query),e=>e?.code==='PRESIGN_CORE_OPERATOR_BINDING_MISMATCH');
 }finally{
  await admin.query("UPDATE ai_platform.ai_coding_tasks SET status='PENDING' WHERE id=$1",
   ['11111111-1111-4111-8111-111111111111']);
 }
});
test('actual reader and adapter reject current PIC audit mismatch',async()=>{
 await admin.query("UPDATE public.audit_logs SET after='{}'::jsonb WHERE id=9801");
 try{
  await assert.rejects(readAdapter(query),e=>e?.code==='PRESIGN_HUB_BINDING_MISMATCH');
 }finally{
  await admin.query("UPDATE public.audit_logs SET after=$1::jsonb WHERE id=9801",
   [JSON.stringify({actorIdentity:{id:'fixture_owner_7',role:'super_admin',email:'owner@example.invalid'}})]);
 }
});
test('historical Task171 and wrong-company query rejected before DB connection',async()=>{
 for(const bad of [{...query,hubTaskId:171},{...query,companyId:'other'},
  {...query,unexpected:true}]){
  await assert.rejects(readAdapter(bad),/FRESH_DEV_TASK_BINDING_REQUIRED/);
 }
});
test.after(async()=>{await Promise.all([hub.end(),core.end(),admin.end()])});
