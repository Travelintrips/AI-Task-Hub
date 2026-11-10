import test from 'node:test';
import assert from 'node:assert/strict';
import {IDENTITY_QUERY,probe} from './gpt02-two-reader-native-readonly.mjs';

const ref='xssrfshdrtdfupgqwfdw';
const host='aws-1-ap-southeast-2.pooler.supabase.com';
const dsn=(role,secret)=>`postgresql://${role}.${ref}:${secret}@${host}:5432/postgres`;
const env=Object.freeze({
 NODE_ENV:'test',APP_ENV:'development',
 GPT02_HUB_READER_DATABASE_URL_DEV:dsn('gpt02_hub_evidence_reader','hub-secret'),
 GPT02_CORE_READER_DATABASE_URL_DEV:dsn('gpt02_core_evidence_reader','core-secret')
});
const row=(role,backendPid)=>({
 db:'postgres',login:role,session:role,in_readonly_tx:true,
 backend_pid:backendPid,tls_verified:true,bounded_role:true,
 no_memberships:true,no_global_read:true,no_global_write:true,no_database_create:true
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
  ['hub',{no_memberships:false}],['hub',{no_global_read:false}],
  ['core',{no_global_write:false}],['core',{no_database_create:false}],
  ['core',{bounded_role:false}],['core',{in_readonly_tx:false}]
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
 assert.match(IDENTITY_QUERY,/pg_backend_pid/);
 assert.match(IDENTITY_QUERY,/pg_stat_ssl/);
 assert.match(IDENTITY_QUERY,/pg_auth_members/);
 assert.doesNotMatch(IDENTITY_QUERY,/gpt02_stage|gpt02_private|ai_tasks|ai_coding_tasks/);
 const s=IDENTITY_QUERY.replace(/'(?:''|[^'])*'/g,"''");
 assert.doesNotMatch(s,/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|CALL|COPY)\b/i);
});
