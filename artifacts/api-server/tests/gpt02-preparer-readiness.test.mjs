import test from 'node:test';
import assert from 'node:assert/strict';
import {assessGpt02PreparerCatalog as assess} from '../src/lib/gpt02-preparer-readiness.mjs';
const now=Date.parse('2026-11-14T09:10:00Z');
const role={role:'gpt02_core_prep_login',canLogin:true,passwordVerifierReady:true,
 connectionLimit:1,activeSessions:0,memberships:0,superuser:false,bypassRls:false,
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
  'catalog.catalogReady&&dedicatedConnectionVerified',
  'preparerRoleReady:catalog.catalogReady', 'dedicatedConnectionVerified',
  'dispatchPermitted:false', 'issuerGrantReady:false'])
   assert.ok(get.includes(anchor),anchor);
 for(const forbidden of ['db.update(', 'db.insert(', '.prepare(',
  'submitAiTaskCommand(', 'submitAiTaskChatGptCommand('])
   assert.ok(!get.includes(forbidden),forbidden);
 assert.ok(route.includes("a.rolpassword IS NOT NULL"));
});
