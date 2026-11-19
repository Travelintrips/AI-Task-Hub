import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateTask183RelockConfig,relockOnce} from './gpt02-task183-relock-once.mjs';

const REF='xssrfshdrtdfupgqwfdw';
const HOST='aws-1-ap-southeast-2.pooler.supabase.com';
const ca=readFileSync(new URL('./fixtures/supabase-root-ca-2021.crt',import.meta.url),'utf8');
const raw='postgresql://gpt02_task183_relock_login.'+REF+':SYNTHETIC_ONLY@'+HOST+':5432/postgres';
const env={NODE_ENV:'development',APP_ENV:'development',GPT02_TASK183_RELOCK_SCOPE:'CST-DEV_TASK183'};
function readCred(name){return name==='task183-relock-dsn'?raw:ca}
test('pinned separate DEV role, CA, and port are required',()=>{
 const c=validateTask183RelockConfig(env,readCred);
 assert.equal(c.application_name,'gpt02-task183-relock-DEV-only');
 assert.equal(c.ssl.rejectUnauthorized,true);
 assert.equal(c.ssl.ca,ca);
 assert.equal(c.connectionTimeoutMillis,5000);
});
test('wrong database target, role and TLS downgrade are denied',()=>{
 for(const changed of [
  raw.replace('gpt02_task183_relock_login','postgres'),
  raw.replace(REF,'z'.repeat(20)),
  raw.replace(HOST,'localhost'),
  raw.replace(':5432',':6543'),
  raw+'?sslmode=disable',
  raw.replace('postgresql://','https://'),
 ]){
  assert.throws(()=>validateTask183RelockConfig(env,(name)=>name==='task183-relock-dsn'?changed:ca));
 }
});
test('PROD, disabled TLS, and inline DSNs cannot create a relock client',()=>{
 for(const changed of [
  {...env,NODE_ENV:'production'}, {...env,APP_ENV:'production'},
  {...env,NODE_TLS_REJECT_UNAUTHORIZED:'0'},
  {...env,GPT02_TASK183_RELOCK_SCOPE:'PROD'},
  {...env,GPT02_TASK183_RELOCK_DATABASE_URL_DEV:raw},
  {...env,GPT02_TASK183_RELOCK_CA:ca},
 ]){
  assert.throws(()=>validateTask183RelockConfig(changed,readCred));
 }
});
test('only the fixed relock function is queried once; no direct ALTER or Task writer',async()=>{
 const calls=[];
 class Client{
  connection={stream:{authorized:true,encrypted:true}};
  async connect(){calls.push('connect')}
  async query(sql){calls.push(sql);return {rows:[{role_locked:true,sessions_terminated:2,sessions_remaining:0,canary_active:false}]}}
  async end(){calls.push('end')}
 }
 const r=await relockOnce(env,{ClientClass:Client,readCredential:readCred});
 assert.deepEqual(r,{roleLocked:true,sessionsTerminated:2,sessionsRemaining:0,canaryActive:false,relockComplete:true,dispatchPermitted:false,preparationAttempted:false});
 assert.deepEqual(calls,['connect','SELECT role_locked,sessions_terminated,sessions_remaining,canary_active FROM gpt02_guard.relock_task183_preparer()','end']);
});
test('bounded valid canary result does not represent release authority',async()=>{
 class Client{
  connection={stream:{authorized:true,encrypted:true}};
  async connect(){}
  async query(){return {rows:[{role_locked:false,sessions_terminated:0,sessions_remaining:0,canary_active:true}]}}
  async end(){}
 }
 const r=await relockOnce(env,{ClientClass:Client,readCredential:readCred});
 assert.equal(r.roleLocked,false);assert.equal(r.canaryActive,true);assert.equal(r.relockComplete,false);assert.equal(r.dispatchPermitted,false);
});
test('unverified TLS rejects before any query',async()=>{
 let queries=0,ends=0;
 class Client{
  connection={stream:{authorized:false,encrypted:true}};
  async connect(){}
  async query(){queries++}
  async end(){ends++}
 }
 await assert.rejects(()=>relockOnce(env,{ClientClass:Client,readCredential:readCred}),
  e=>e.code==='TASK183_RELOCK_PINNED_TLS_REQUIRED');
 assert.equal(queries,0);assert.equal(ends,1);
});
test('malformed SQL readback cannot be accepted',async()=>{
 for(const rows of [
    [],
    [{role_locked:'true',sessions_terminated:0,sessions_remaining:0,canary_active:false}],
    [{role_locked:true,sessions_terminated:-1,sessions_remaining:0,canary_active:false}],
    [{role_locked:true,sessions_terminated:0,sessions_remaining:-2,canary_active:false}],
    [{role_locked:true,sessions_terminated:0,sessions_remaining:1,canary_active:false}],
    [{role_locked:true,sessions_terminated:0,sessions_remaining:0,canary_active:true}],
    [{role_locked:true,sessions_terminated:0,sessions_remaining:0,canary_active:false},
     {role_locked:true,sessions_terminated:0,sessions_remaining:0,canary_active:false}]
  ]){
  class Client{
   connection={stream:{authorized:true,encrypted:true}};
   async connect(){}
   async query(){return {rows}}
   async end(){}
  }
  await assert.rejects(()=>relockOnce(env,{ClientClass:Client,readCredential:readCred}),
    e=>e.code==='TASK183_RELOCK_READBACK_INVALID');
 }
});
test('auth failure makes a single connection attempt and no retry',async()=>{
 let connections=0,queries=0;
 class Client{
  connection={stream:{authorized:true,encrypted:true}};
  async connect(){connections++;const e=Error('SYNTHETIC_PRIVATE_PASSWORD');e.code='28P01';throw e}
  async query(){queries++}
  async end(){}
 }
 await assert.rejects(()=>relockOnce(env,{ClientClass:Client,readCredential:readCred}),e=>e.code==='28P01');
 assert.equal(connections,1);assert.equal(queries,0);
});
test('systemd watcher is inactive by default and has scoped encrypted identity',()=>{
 const service=readFileSync(new URL('../../deploy/systemd/gpt02-task183-preparer-relock.service',import.meta.url),'utf8');
 const timer=readFileSync(new URL('../../deploy/systemd/gpt02-task183-preparer-relock.timer',import.meta.url),'utf8');
 for(const guard of ['Type=oneshot','DynamicUser=yes','Restart=no','StateDirectory=gpt02-task183-relock',
    'NoNewPrivileges=yes','ProtectSystem=strict','LoadCredentialEncrypted=task183-relock-dsn:/etc/credstore.encrypted/gpt02-task183-relock-dsn'])
   assert.ok(service.includes(guard),guard);
 assert.match(service,/^ConditionPathExists=\/opt\/ai-task-gpt02-preparer\/current\/artifacts\/api-server\/node_modules\/pg\/package\.json$/m);
 assert.match(timer,/OnUnitInactiveSec=30s/);
 assert.match(timer,/Unit=gpt02-task183-preparer-relock.service/);
 assert.match(timer,/\[Install\]/);
 assert.doesNotMatch(service,/LoadCredentialEncrypted=.*issue159/);
 assert.doesNotMatch(service,/PrivateNetwork=yes/);
});
test('SQL wrapper is hard-coded for denial/relock, not login grants',()=>{
 const s=readFileSync(new URL('./gpt02-task183-relock-hosted-candidate.sql',import.meta.url),'utf8');
 assert.match(s,/SECURITY DEFINER SET search_path=pg_catalog/);
 assert.match(s,/CREATE ROLE gpt02_task183_relock_login NOLOGIN/);
 assert.match(s,/REVOKE ALL ON FUNCTION gpt02_guard.relock_task183_preparer\(\) FROM PUBLIC/);
 assert.match(s,/pg_terminate_backend/);
 assert.match(s,/PASSWORD NULL/);
 assert.doesNotMatch(s,/ALTER ROLE gpt02_core_prep_login LOGIN/);
 assert.match(s,/canary_privilege_safe := NOT pg_catalog.has_function_privilege/);
 assert.match(s,/AND canary_privilege_safe/);
 assert.doesNotMatch(s,/(?:PERFORM|CALL)\s+gpt02_stage\.prepare_core_task/);
});

test('residual session never becomes a completed relock',async()=>{
 const calls=[];
 class Client{
  connection={stream:{authorized:true,encrypted:true}};
  async connect(){calls.push('connect')}
  async query(sql){calls.push(sql);return {rows:[{role_locked:false,sessions_terminated:0,sessions_remaining:1,canary_active:false}]}}
  async end(){calls.push('end')}
 }
 const r=await relockOnce(env,{ClientClass:Client,readCredential:readCred});
 assert.equal(r.relockComplete,false);
 assert.equal(r.canaryActive,false);
 assert.equal(r.sessionsRemaining,1);
 assert.equal(r.dispatchPermitted,false);
 assert.equal(calls.length,3);
});
