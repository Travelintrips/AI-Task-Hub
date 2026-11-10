import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {QUERY,assess,probe} from './gpt02-preparer-dedicated-login-readonly.mjs';

const ref='xssrfshdrtdfupgqwfdw';
const ca=readFileSync(new URL('./fixtures/supabase-root-ca-2021.crt',import.meta.url),'utf8');
const secret='synthetic-not-for-remote-databases';
const env=Object.freeze({
 NODE_ENV:'development',APP_ENV:'development',
 GPT02_CORE_PREP_DEV_PROJECT_REF:ref,GPT02_HUB_DEV_PROJECT_REF:ref,
 GPT02_PROD_PROJECT_REF:'p'.repeat(20),
 GPT02_CORE_PREP_DEV_POOLER_HOST:'aws-1-ap-southeast-2.pooler.supabase.com',
 GPT02_CORE_PREP_DEV_CA:ca,
 GPT02_CORE_PREP_DATABASE_URL_DEV:
   `postgresql://gpt02_core_prep_login.${ref}:${secret}@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres`
});
const good=Object.freeze({
 db:'postgres',login:'gpt02_core_prep_login',session:'gpt02_core_prep_login',
 in_readonly_tx:true,bounded_role:true,no_memberships:true,no_database_create:true,
 temp_available:true,no_stage_usage:true,no_core_schema_usage:true,
 dormant_unusable:true,no_operational_function:true,
 exact_owner_grants_no_direct_dml:true,exact_rls:true,dormant_other_roles:true
});
function fake(rows=[good],options={}){
 const queries=[],configs=[];
 let opened=0,closed=0;
 class Client{
  constructor(config){configs.push(config);}
  async connect(){opened++;if(options.failConnect)throw Error('synthetic credentials leaked: '+secret);}
  async query(sql){
   queries.push(sql);
   if(options.failQuery && sql===QUERY)throw Error('synthetic DSN '+secret);
   if(sql===QUERY)return {rows};
   return {rows:[]};
  }
  async end(){closed++;}
 }
 return {Client,queries,configs,metrics:()=>({opened,closed})};
}
test('missing dedicated credential never opens a connection or falls back to postgres',async()=>{
 const f=fake();
 for(const patch of [
  {GPT02_CORE_PREP_DATABASE_URL_DEV:undefined},
  {GPT02_CORE_PREP_DATABASE_URL_DEV:''},
  {GPT02_CORE_PREP_DATABASE_URL_DEV:env.GPT02_CORE_PREP_DATABASE_URL_DEV.replace('gpt02_core_prep_login','postgres')},
  {GPT02_CORE_PREP_DATABASE_URL_DEV:env.GPT02_CORE_PREP_DATABASE_URL_DEV.replace(':5432',':6543')},
  {GPT02_CORE_PREP_DEV_POOLER_HOST:'db.'+ref+'.supabase.co'},
  {GPT02_CORE_PREP_DEV_CA:ca+ca},
  {GPT02_CORE_PREP_DEV_PROJECT_REF:'p'.repeat(20)},
  {NODE_ENV:'production'},{APP_ENV:'production'},
  {NODE_TLS_REJECT_UNAUTHORIZED:'0'}
 ]){
  const result=await probe({...env,...patch},{ClientClass:f.Client});
  assert.equal(result.releaseDecision,'NO_GO');
  assert.equal(result.scopedLoginAuthenticated,false);
  assert.equal(result.permissionsVerified,false);
 }
 assert.equal(f.metrics().opened,0);
});
test('synthetic dedicated identity proof is informational and never grants a command',async()=>{
 const f=fake();
 const result=await probe(env,{ClientClass:f.Client});
 assert.equal(result.scopedLoginAuthenticated,true);
 assert.equal(result.dbReadOnlyVerified,true);
 assert.equal(result.permissionsVerified,true);
 assert.equal(result.tempPrivilegeViaDatabasePublic,true);
 assert.equal(result.releaseDecision,'NO_GO');
 for(const key of ['signedApprovalGranted','issuerLeaseGranted','dispatchPermitted','lifecyclePermitted','taskCreated','commandCreated','dormantFunctionInvoked'])
  assert.equal(result[key],false,key);
 assert.equal(result.reason,'DEDICATED_LOGIN_READONLY_PASS_NO_AUTHORITY');
 assert.equal(f.metrics().opened,1);assert.equal(f.metrics().closed,1);
 assert.deepEqual(f.queries,['BEGIN READ ONLY',"SET LOCAL statement_timeout='5s'",QUERY,'ROLLBACK']);
 assert.equal(f.configs[0].ssl.rejectUnauthorized,true);
 assert.equal(f.configs[0].max,1);
 assert.equal(JSON.stringify(result).includes(secret),false);
});
test('wrong database user, inherited role, expired login or leaked privilege fails closed',async()=>{
 for(const row of [
  {...good,login:'postgres'}, {...good,session:'postgres'},
  {...good,db:'template1'}, {...good,bounded_role:false},
  {...good,no_memberships:false}, {...good,no_database_create:false},
  {...good,no_stage_usage:false}, {...good,no_core_schema_usage:false},
  {...good,dormant_unusable:false}, {...good,no_operational_function:false},
  {...good,exact_owner_grants_no_direct_dml:false}, {...good,exact_rls:false},
  {...good,dormant_other_roles:false},{...good,in_readonly_tx:false}
 ]){
  const result=await probe(env,{ClientClass:fake([row]).Client});
  assert.equal(result.permissionsVerified,false,JSON.stringify(row));
  assert.equal(result.dispatchPermitted,false);
  assert.equal(result.releaseDecision,'NO_GO');
 }
});
test('result missing, duplicate, or invalid fields cannot become proof',async()=>{
 for(const rows of [[],[good,good],[{...good,no_memberships:1}],null]){
  const f=fake(rows);
  const output=await probe(env,{ClientClass:f.Client});
  assert.equal(output.permissionsVerified,false);
  assert.equal(output.dispatchPermitted,false);
  assert.equal(f.metrics().closed,1);
 }
});
test('connection and query errors are sanitized and never retried',async()=>{
 for(const options of [{failConnect:true},{failQuery:true}]){
  const f=fake([good],options);
  const output=await probe(env,{ClientClass:f.Client});
  assert.equal(output.releaseDecision,'NO_GO');
  assert.equal(output.permissionsVerified,false);
  assert.equal(JSON.stringify(output).includes(secret),false);
  assert.equal(f.metrics().opened,1);
  assert.equal(f.metrics().closed,1);
  if(options.failQuery)assert.equal(f.queries.at(-1),'ROLLBACK');
 }
});
test('static query is catalogue-only, no task-row retrieval or function execution',()=>{
 assert.match(QUERY,/current_setting\('transaction_read_only'\)='on'/);
 assert.match(QUERY,/pg_auth_members/);
 assert.match(QUERY,/gpt02_preparer_%/);
 assert.match(QUERY,/current_user AS login/);
 assert.match(QUERY,/has_function_privilege/);
 assert.match(QUERY,/count\(\*\)=8/);
 assert.match(QUERY,/c\.relname IN \('ai_execution_jobs','ai_coding_tasks'\)/);
 assert.match(QUERY,/b157e1fbfe1a844309373db42743257f1996895316dc87166d385637c9f8031d/);
 const sanitized=QUERY.replace(/'(?:''|[^'])*'/g,"''");
 assert.doesNotMatch(sanitized,/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|CALL|COPY)\b/i);
 assert.doesNotMatch(QUERY,/SELECT\s+\*\s+FROM\s+(?:public\.ai_tasks|gpt02_private\.approvals)/i);
 assert.doesNotMatch(QUERY,/rolpassword|password_hash|secret|access_token/i);
 assert.equal(QUERY.trim().toUpperCase().startsWith('SELECT'),true);
});
test('public TEMP privilege is reported, not confused with CREATE or a dispatch grant',()=>{
 for(const value of [true,false]){
  const result=assess({...good,temp_available:value});
  assert.equal(result.tempPrivilegeViaDatabasePublic,value);
  assert.equal(result.permissionsVerified,true);
  assert.equal(result.releaseDecision,'NO_GO');
 }
});
