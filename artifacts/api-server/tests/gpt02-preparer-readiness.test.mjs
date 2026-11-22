import test from 'node:test';
import assert from 'node:assert/strict';
import {assessGpt02PreparerCatalog as assess} from '../src/lib/gpt02-preparer-readiness.mjs';
import {preparationReadinessForOperator} from '../src/lib/gpt02-google-auth-gate.mjs';
const now=Date.parse('2026-11-14T09:10:00Z');
const role={role:'gpt02_core_prep_login',canLogin:true,passwordVerifierReady:true,
 connectionLimit:1,activeSessions:0,knownPooledIdleSessions:0,
 unexpectedIdleSessions:0,memberships:0,superuser:false,bypassRls:false,
 createRole:false,createDb:false,replication:false,inherit:false,
 canCreateDatabase:false,validUntil:new Date(now+90_000)};
const denied=(patch,why)=>{
 const actual=assess({...role,...patch},now);
 assert.equal(actual.catalogReady,false);
 assert.equal(actual.reason,why);
 assert.equal(actual.dispatchPermitted,false);
};
test('bounded inactive-risk login is catalogue eligible but not authenticated or authorized',()=>{
 const r=assess(role,now);
 assert.equal(r.catalogReady,true);
 assert.equal(r.reason,'PREPARER_ACCOUNT_SCOPED_NOT_YET_AUTHENTICATED');
 assert.equal(r.dispatchPermitted,false);
});
test('one idle Supavisor pooled backend is allowed only with independent TLS check later',()=>{
 const r=assess({...role,knownPooledIdleSessions:1},now);
 assert.equal(r.catalogReady,true);
 assert.equal(r.dispatchPermitted,false);
 assert.equal(r.reason,'PREPARER_ACCOUNT_SCOPED_NOT_YET_AUTHENTICATED');
});
test('untrusted or concurrent sessions fail closed even if idle pooler is present',()=>{
 const deniedReason='GPT02_PREPARER_CONNECTION_LIMIT_NOT_VERIFIED';
 denied({knownPooledIdleSessions:2},deniedReason);
 denied({knownPooledIdleSessions:-1},deniedReason);
 denied({knownPooledIdleSessions:undefined},deniedReason);
 denied({unexpectedIdleSessions:1},deniedReason);
 denied({unexpectedIdleSessions:undefined},deniedReason);
 denied({activeSessions:1,knownPooledIdleSessions:1},deniedReason);
 denied({connectionLimit:2,knownPooledIdleSessions:1},deniedReason);
});
test('current actual DEV role NOLOGIN is denied',()=>{
 denied({canLogin:false,passwordVerifierReady:false,connectionLimit:0,
  validUntil:'2000-01-01T00:00:00Z'},'GPT02_PREPARER_LOGIN_LOCKED');
});
test('missing password verifier independently rejected',()=>{
 denied({passwordVerifierReady:false},'GPT02_PREPARER_PASSWORD_VERIFIER_MISSING');
});
test('privileged roles and inherited access forbidden',()=>{
 for(const key of ['superuser','bypassRls','createRole','createDb','replication','inherit'])
  denied({[key]:true},'GPT02_PREPARER_PRIVILEGE_DRIFT');
 denied({memberships:1},'GPT02_PREPARER_PRIVILEGE_DRIFT');
 denied({canCreateDatabase:true},'GPT02_PREPARER_PRIVILEGE_DRIFT');
});
test('unbounded TTL, replayed login session and excessive concurrency rejected',()=>{
 denied({validUntil:null},'GPT02_PREPARER_SHORT_LIVED_LOGIN_REQUIRED');
 denied({validUntil:new Date(now-1)},'GPT02_PREPARER_SHORT_LIVED_LOGIN_REQUIRED');
 denied({validUntil:new Date(now+11*60_000)},'GPT02_PREPARER_SHORT_LIVED_LOGIN_REQUIRED');
 denied({connectionLimit:2},'GPT02_PREPARER_CONNECTION_LIMIT_NOT_VERIFIED');
 denied({activeSessions:1},'GPT02_PREPARER_CONNECTION_LIMIT_NOT_VERIFIED');
});
test('missing or wrong role cannot inherit any readiness',()=>{
 assert.equal(assess(null,now).reason,'GPT02_PREPARER_ROLE_NOT_FOUND');
 denied({role:'postgres'},'GPT02_PREPARER_ROLE_IDENTITY_MISMATCH');
});

test('server route uses database-backed, independently authenticated role proof',async()=>{
 const fs=await import('node:fs/promises');
 const route=await fs.readFile(new URL('../src/routes/gpt02-preparation.ts',import.meta.url),'utf8');
 const start=route.indexOf('router.get("/ai-tasks/:id/gpt02-preparation-readiness"');
 const end=route.indexOf('router.post("/ai-tasks/:id/gpt02-prepare"');
 assert.ok(start>0&&end>start);
 const get=route.slice(start,end);
 for(const anchor of [
  'await readDedicatedPreparerCatalog()', 'factory.preparer.verifyReadiness()',
  '!catalog.catalogReady?catalog.reason:', '!dedicatedConnectionVerified?connectionReason:',
  'preparerRoleReady:catalog.catalogReady', 'dedicatedConnectionVerified',
  'dispatchPermitted:false', 'issuerGrantReady:false'])
   assert.ok(get.includes(anchor),anchor);
 for(const forbidden of ['db.update(', 'db.insert(', '.prepare(',
  'submitAiTaskCommand(', 'submitAiTaskChatGptCommand('])
   assert.ok(!get.includes(forbidden),forbidden);
 assert.ok(route.includes("a.rolpassword IS NOT NULL"));
 assert.ok(route.includes("knownPooledIdleSessions"));
 assert.ok(route.includes("unexpectedIdleSessions"));
 assert.ok(route.includes("s.state IS DISTINCT FROM 'idle'"));
 assert.ok(route.includes("s.application_name='Supavisor'"));
});

test('preparation only requests a fresh operator session after the service is ready', () => {
  const env = {NODE_ENV:'development', APP_ENV:'development', SESSION_SECRET:'x'.repeat(40)};
  const user = {id:'fixture-admin', role:'super_admin', email:'admin@example.invalid',
    authSource:'supabase_google_identity', authSupabaseId:'d516f59b-a354-4f84-a583-e6df7853a62e',
    authVerifiedAt:now};
  const ready = 'READY_FOR_PREPARATION_ONLY';
  const expired = {...user, authVerifiedAt:now - 600001};
  for (const reason of ['GPT02_PREPARER_LOGIN_LOCKED', 'GPT02_PREPARER_INDEPENDENT_AUTH_NOT_VERIFIED']) {
    for (const session of [user, expired, undefined]) {
      assert.deepEqual(preparationReadinessForOperator(reason,session,env,now),
        {reason, canRequestPreparation:false});
    }
  }
  for (const session of [expired, undefined]) {
    assert.deepEqual(preparationReadinessForOperator(ready,session,env,now),
      {reason:'GPT02_FRESH_GOOGLE_OPERATOR_REQUIRED', canRequestPreparation:false});
  }
  assert.deepEqual(preparationReadinessForOperator(ready,user,env,now),
    {reason:ready, canRequestPreparation:true});
});
