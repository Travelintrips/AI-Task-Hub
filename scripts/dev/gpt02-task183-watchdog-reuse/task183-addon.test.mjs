import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {
 relockTask183WithExistingAuditor,runCombinedRelockLanes,
} from './gpt02_issue159_relock_catalog_supervisor.mjs';

const locked={role_locked:true,sessions_terminated:0,sessions_remaining:0,
 canary_active:false,operational_active:false};
const bounded={role_locked:false,sessions_terminated:0,sessions_remaining:1,
 canary_active:false,operational_active:true};
const catalog={rows:[{authorized:true}]};
function clientWithRow(row=locked){
 const queries=[];
 return {queries,async query(q){
  queries.push(q);
  return queries.length===1?catalog:{rows:[row]};
 }};
}

test('feature OFF preserves existing Issue159 cleanup and never invokes Task183 lane',async()=>{
 let taskCalls=0;
 const result=await runCombinedRelockLanes({},{
  runLegacy:async()=>({readerInstalled:true,writerCounts:{phaseAWindowCount:0,phaseBCleanedWindowCount:0}}),
  runTask183:async()=>{taskCalls++;throw Error('unexpected call');},
 });
 assert.equal(result.task183RelockEnabled,false);
 assert.equal(result.task183Relock,null);
 assert.equal(taskCalls,0);
 assert.equal(result.readerInstalled,true);
});
test('feature ON requires authorized exact function and bounded SQL readback',async()=>{
 const c=clientWithRow();
 const result=await relockTask183WithExistingAuditor(c);
 assert.equal(result.roleLocked,true);
 assert.equal(result.dispatchPermitted,false);
 assert.equal(c.queries.length,2);
 assert.equal(typeof c.queries[0].text,'string');
 assert.ok(c.queries[0].text.includes('pg_catalog.sha256'));
 assert.ok(c.queries[0].text.includes('7651f9b031d7c6b8f70edb61efd4fe2bab4c2a62bb82b12435da24ae100485d2'));
 assert.ok(c.queries[0].text.includes('dev_gpt02_relock_catalog_auditor'));
 assert.ok(c.queries[1].text.includes('gpt02_guard.relock_task183_preparer()'));
 assert.ok(c.queries[0].query_timeout<=2500);
 assert.ok(c.queries[1].query_timeout<=8000);
 for(const q of c.queries)assert.doesNotMatch(q.text,/ALTER ROLE|GRANT |CREATE ROLE|INSERT INTO|DELETE FROM/i);
});
test('unreviewed source hash / grant refuses invocation before privileged RPC',async()=>{
 for(const v of [false,null,'true']){
  const calls=[];
  await assert.rejects(relockTask183WithExistingAuditor({async query(q){
   calls.push(q);return {rows:[{authorized:v}]};
  }}),e=>e.message==='RELOCK_TASK183_UNVERIFIED_SCOPE_OR_GRANT');
  assert.equal(calls.length,1);
 }
});
test('bounded operational window is never signing, preparation or dispatch authority',async()=>{
 const result=await relockTask183WithExistingAuditor(clientWithRow(bounded));
 assert.equal(result.operationalActive,true);
 assert.equal(result.dispatchPermitted,false);
 assert.equal(result.preparationAttempted,false);
});
test('invalid, dual-window, residual-session and inconsistent count responses are denied',async()=>{
 const invalid=[
  null,
  {...locked,role_locked:'true'},
  {...locked,sessions_remaining:1},
  {...locked,sessions_terminated:-1},
  {...locked,canary_active:true},
  {...bounded,canary_active:true},
  {...bounded,sessions_remaining:2},
  {...bounded,sessions_terminated:1},
 ];
 for(const row of invalid){
  await assert.rejects(relockTask183WithExistingAuditor(clientWithRow(row)),
   e=>e.message==='RELOCK_TASK183_UNTRUSTED_RESULT');
 }
});
test('Task183 failure does not cancel the original reader/writer cleanup',async()=>{
 let oldCalls=0;
 await assert.rejects(runCombinedRelockLanes({},{
  task183Enabled:true,
  runLegacy:async()=>{oldCalls++;return {readerInstalled:true};},
  runTask183:async()=>{throw Error('DENIED');}
 }),e=>e.message==='RELOCK_TASK183_LANE_FAILED');
 assert.equal(oldCalls,1);
});
test('existing relock failure still attempts Task183 cleanup then reports NO_GO',async()=>{
 let newCalls=0;
 await assert.rejects(runCombinedRelockLanes({},{
  task183Enabled:true,
  runLegacy:async()=>{throw Error('legacy phase failed');},
  runTask183:async()=>{newCalls++;return Object.freeze({...locked});}
 }),e=>e.message==='RELOCK_LEGACY_LANE_FAILED');
 assert.equal(newCalls,1);
});
test('two failed lanes never report success',async()=>{
 await assert.rejects(runCombinedRelockLanes({},{
  task183Enabled:true,
  runLegacy:async()=>{throw Error('legacy');},
  runTask183:async()=>{throw Error('task183');}
 }),e=>e.message==='RELOCK_MULTIPLE_LANES_FAILED');
});
test('reviewed relock body hash is pinned and distinct from installed legacy function',()=>{
 const sql=readFileSync(new URL('./gpt02-task183-reuse-existing-auditor.sql',import.meta.url),'utf8');
 const body=sql.split('AS $relock$')[1]?.split('$relock$;')[0];
 assert.ok(body);
 assert.equal(createHash('sha256').update(body).digest('hex'),
  '7651f9b031d7c6b8f70edb61efd4fe2bab4c2a62bb82b12435da24ae100485d2');
 assert.match(body,/session_user <> 'dev_gpt02_relock_catalog_auditor'/);
 assert.match(body,/IF remaining=0 THEN/);
 assert.doesNotMatch(body,/ALTER ROLE gpt02_core_prep_login LOGIN/);
});
test('existing Issue159 lanes and custody remain unchanged in source',()=>{
 const s=readFileSync(new URL('./gpt02_issue159_relock_catalog_supervisor.mjs',import.meta.url),'utf8');
 for(const key of ['relock_expired_phase_a()','relock_expired_phase_b()',
  'relock_reader_phase_a()','relock_reader_phase_b()', 'relock-catalog-dsn',
  "const ROLE = 'dev_gpt02_relock_catalog_auditor'",
  'RELOCK_CLEANUP_ONLY', 'RELOCK_SYSTEMD_CREDENTIALS_REQUIRED',
  'process.env.GPT02_TASK183_RELOCK_REUSE_ENABLED'])
  assert.ok(s.includes(key),key);
 assert.doesNotMatch(s,/task183-relock-dsn|Task183PreparerPassword|NEW_RELOCK_SECRET/);
});
