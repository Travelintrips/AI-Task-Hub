import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {IDENTITY_QUERY,probe} from './gpt02-two-reader-native-readonly.mjs';

const ref='xssrfshdrtdfupgqwfdw';
const host='aws-1-ap-southeast-2.pooler.supabase.com';
const ca=readFileSync(new URL('./fixtures/supabase-root-ca-2021.crt',import.meta.url),'utf8');
const dsn=(role,secret)=>`postgresql://${role}.${ref}:${secret}@${host}:5432/postgres`;
const env=Object.freeze({
 NODE_ENV:'test',APP_ENV:'development',
 GPT02_HUB_READER_DATABASE_URL_DEV:dsn('gpt02_hub_evidence_reader','hub-secret'),
 GPT02_CORE_READER_DATABASE_URL_DEV:dsn('gpt02_core_evidence_reader','core-secret'),
 GPT02_READER_DEV_CA:ca
});
const row=(role,backendPid)=>({
 db:'postgres',login:role,session:role,in_readonly_tx:true,
 default_readonly:true,search_path_locked:true,statement_timeout_locked:true,
 lock_timeout_locked:true,idle_tx_timeout_locked:true,
 backend_pid:backendPid,tls_verified:true,bounded_role:true,
 no_memberships:true,exact_management_member:true,
 no_global_read:true,no_global_write:true,no_database_create:true,no_schema_create:true,
 no_owned_objects:true,
 no_special_admin_roles:true,no_sequence_privileges:true,
 no_foreign_server_usage:true,no_foreign_table_select:true,no_view_select:true,
 no_callable_security_definer_routines:true,
 exact_callable_routines:true,no_callable_mutating_routines:true
});
function fake({hub=row('gpt02_hub_evidence_reader',41001),core=row('gpt02_core_evidence_reader',41002),
 sameClient=false,fail=false}={}){
 const created=[],queries=[];
 class Client{
  constructor(role){this.role=role;}
  async query(sql){
   queries.push({role:this.role,sql});
   if(fail&&sql===IDENTITY_QUERY)throw Error('synthetic hub-secret core-secret');
   if(sql===IDENTITY_QUERY)return {rows:[this.role==='hub'?hub:core]};
   return {rows:[]};
  }
  release(){}
 }
 class Pool{
  constructor(config){
   this.config=config;
   const role=config.application_name.includes('hub')?'hub':'core';
   this.client=sameClient?(created[0]?.client||new Client(role)):new Client(role);
   created.push(this);
  }
  async connect(){return this.client;}
  async end(){}
 }
 return {Pool,created,queries};
}
test('two exact native reader identities prove only read-only evidence, never authority',async()=>{
 const f=fake();
 const r=await probe(env,{Pool:f.Pool});
 assert.equal(r.hubAuthenticated,true);
 assert.equal(r.coreAuthenticated,true);
 assert.equal(r.twoSessionsVerified,true);
 assert.equal(r.permissionsVerified,true);
 assert.equal(r.reason,'TWO_NATIVE_READERS_PASS_NO_AUTHORITY');
 assert.equal(r.dispatchPermitted,false);
 assert.equal(r.issuerLeaseGranted,false);
 assert.equal(r.releaseDecision,'NO_GO');
 assert.equal(f.created.length,2);
 for(const x of f.created)assert.equal(x.config.max,1);
 assert.equal(f.queries.filter(x=>x.sql==='BEGIN READ ONLY').length,2);
 assert.equal(f.queries.filter(x=>x.sql===IDENTITY_QUERY).length,2);
});

test('missing dedicated credentials fails before any pool is constructed',async()=>{
 let calls=0;
 class Pool{constructor(){calls++;}}
 const r=await probe({...env,GPT02_CORE_READER_DATABASE_URL_DEV:''},{Pool});
 assert.equal(r.permissionsVerified,false);
 assert.equal(r.reason,'NO_VERIFIED_TWO_READER_CREDENTIALS_OR_CST_DEV_TLS');
 assert.equal(calls,0);
});

test('wrong identity, membership or elevated privilege fails closed',async()=>{
 for(const [which,patch] of [
  ['hub',{login:'postgres'}],['hub',{session:'postgres'}],
  ['hub',{no_memberships:false}],['hub',{exact_management_member:false}],
  ['hub',{no_global_read:false}],
  ['core',{no_global_write:false}],['core',{no_database_create:false}],
  ['hub',{no_schema_create:false}],['hub',{no_owned_objects:false}],
  ['core',{bounded_role:false}],['core',{in_readonly_tx:false}],
  ['hub',{no_special_admin_roles:false}],['hub',{no_owned_objects:false}],
  ['hub',{default_readonly:false}],['hub',{search_path_locked:false}],
  ['core',{statement_timeout_locked:false}],['core',{lock_timeout_locked:false}],
  ['core',{idle_tx_timeout_locked:false}],
  ['hub',{no_sequence_privileges:false}],
  ['hub',{no_foreign_server_usage:false}],['core',{no_foreign_table_select:false}],
  ['hub',{no_view_select:false}],
  ['core',{no_callable_security_definer_routines:false}],
  ['hub',{exact_callable_routines:false}],
  ['hub',{no_callable_mutating_routines:false}]
 ]){
  const base=row(which==='hub'?'gpt02_hub_evidence_reader':'gpt02_core_evidence_reader');
  const f=fake({[which]:{...base,...patch}});
  const r=await probe(env,{Pool:f.Pool});
  assert.equal(r.permissionsVerified,false,JSON.stringify([which,patch]));
  assert.equal(r.dispatchPermitted,false);
  assert.equal(r.releaseDecision,'NO_GO');
 }
});

test('same PostgreSQL backend PID cannot masquerade as two independent sessions',async()=>{
 const f=fake({
  hub:row('gpt02_hub_evidence_reader',41001),
  core:row('gpt02_core_evidence_reader',41001)
 });
 const r=await probe(env,{Pool:f.Pool});
 assert.equal(r.twoSessionsVerified,false);
 assert.equal(r.reason,'SEPARATE_NATIVE_BACKENDS_REQUIRED');
 assert.equal(r.dispatchPermitted,false);
});
test('TLS must be verified independently for both native readers',async()=>{
 for(const which of ['hub','core']){
  const base=which==='hub'
   ? row('gpt02_hub_evidence_reader',41001)
   : row('gpt02_core_evidence_reader',41002);
  const f=fake({[which]:{...base,tls_verified:false}});
  const r=await probe(env,{Pool:f.Pool});
  assert.equal(r.permissionsVerified,false);
  assert.equal(r.dispatchPermitted,false);
  assert.equal(r.reason,'NATIVE_READER_PRIVILEGE_MISMATCH');
 }
});

test('query error is sanitized and secrets never appear in output',async()=>{
 const f=fake({fail:true});
 const r=await probe(env,{Pool:f.Pool});
 assert.equal(r.permissionsVerified,false);
 assert.equal(r.reason,'NATIVE_READER_LOGIN_OR_CATALOG_PROBE_FAILED');
 assert.equal(JSON.stringify(r).includes('hub-secret'),false);
 assert.equal(JSON.stringify(r).includes('core-secret'),false);
});

test('identity query is catalogue-only and cannot mutate or read task rows',()=>{
 assert.match(IDENTITY_QUERY,/current_user AS login/);
 assert.match(IDENTITY_QUERY,/session_user AS session/);
 assert.match(IDENTITY_QUERY,/transaction_read_only/);
 assert.match(IDENTITY_QUERY,/default_transaction_read_only/);
 assert.match(IDENTITY_QUERY,/search_path/);
 assert.match(IDENTITY_QUERY,/statement_timeout/);
 assert.match(IDENTITY_QUERY,/lock_timeout/);
 assert.match(IDENTITY_QUERY,/idle_in_transaction_session_timeout/);
 assert.match(IDENTITY_QUERY,/pg_backend_pid/);
 assert.match(IDENTITY_QUERY,/pg_stat_ssl/);
 assert.match(IDENTITY_QUERY,/pg_auth_members/);
 assert.match(IDENTITY_QUERY,/exact_management_member/);
 assert.match(IDENTITY_QUERY,/m\.set_option/);
 assert.match(IDENTITY_QUERY,/supabase_admin/);
 assert.match(IDENTITY_QUERY,/no_owned_objects/);
 assert.match(IDENTITY_QUERY,/pg_shdepend/);
 assert.match(IDENTITY_QUERY,/no_special_admin_roles/);
 assert.match(IDENTITY_QUERY,/pg_execute_server_program/);
 assert.match(IDENTITY_QUERY,/pg_read_server_files/);
 assert.match(IDENTITY_QUERY,/no_sequence_privileges/);
 assert.match(IDENTITY_QUERY,/no_foreign_server_usage/);
 assert.match(IDENTITY_QUERY,/has_server_privilege/);
 assert.match(IDENTITY_QUERY,/no_foreign_table_select/);
 assert.match(IDENTITY_QUERY,/no_view_select/);
 assert.match(IDENTITY_QUERY,/has_sequence_privilege/);
 assert.match(IDENTITY_QUERY,/no_callable_security_definer_routines/);
 assert.match(IDENTITY_QUERY,/exact_callable_routines/);
 assert.match(IDENTITY_QUERY,/assert_portal_profile_complete/);
 assert.match(IDENTITY_QUERY,/046a0d067d2b632d0e17af5c6f433bea63794d90c67c55a6475e6fe6b34916c8/);
 assert.match(IDENTITY_QUERY,/p\.prosecdef/);
 assert.match(IDENTITY_QUERY,/no_callable_mutating_routines/);
 assert.match(IDENTITY_QUERY,/pg_get_function_result\(p\.oid\)<>'trigger'/);
 assert.equal(IDENTITY_QUERY.trim().toUpperCase().startsWith('SELECT'),true);
 assert.doesNotMatch(IDENTITY_QUERY,/;\s*(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|CALL|COPY)\b/i);
 assert.doesNotMatch(IDENTITY_QUERY,/\bFROM\s+(?:public\.ai_tasks|gpt02_private\.approvals|gpt02_stage\.core_preparations)\b/i);
});
