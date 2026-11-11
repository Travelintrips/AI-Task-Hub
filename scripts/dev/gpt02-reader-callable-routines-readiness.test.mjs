import test from 'node:test';
import assert from 'node:assert/strict';
import {
 QUERY,EXPECTED_ROUTINE_COUNT,EXPECTED_ROUTINE_FINGERPRINT,EXPECTED_SOURCE_SHA256,
 assessReaderCallableRoutines,auditReaderCallableRoutines
} from './gpt02-reader-callable-routines-readiness.mjs';

const good={
 database_name:'postgres',transaction_read_only:'on',reader_count:2,
 exact_counts:true,exact_fingerprints:true,exact_source:true
};

test('exact callable routine inventory passes evidence only',()=>{
 const r=assessReaderCallableRoutines(good);
 assert.equal(EXPECTED_ROUTINE_COUNT,1);
 assert.match(EXPECTED_ROUTINE_FINGERPRINT,/^[a-f0-9]{64}$/);
 assert.match(EXPECTED_SOURCE_SHA256,/^[a-f0-9]{64}$/);
 assert.equal(r.readOnly,true);
 assert.equal(r.readerCount,2);
 assert.equal(r.exactCallableRoutineInventory,true);
 assert.equal(r.reason,'EXACT_READER_CALLABLE_ROUTINES_PASS_NO_AUTHORITY');
 assert.equal(r.dispatchPermitted,false);
 assert.equal(r.issuerLeaseGranted,false);
 assert.equal(r.releaseDecision,'NO_GO');
});

test('new routine, identity drift or source drift fails closed',()=>{
 for(const row of [
  {...good,exact_counts:false},
  {...good,exact_fingerprints:false},
  {...good,exact_source:false},
  {...good,reader_count:1}
 ]){
  const r=assessReaderCallableRoutines(row);
  assert.equal(r.exactCallableRoutineInventory,false);
  assert.equal(r.reason,'READER_CALLABLE_ROUTINE_DRIFT');
  assert.equal(r.releaseDecision,'NO_GO');
 }
});

test('wrong database or non-readonly catalog fails closed',()=>{
 for(const row of [
  {...good,database_name:'production'},
  {...good,transaction_read_only:'off'},
  null
 ]){
  const r=assessReaderCallableRoutines(row);
  assert.equal(r.exactCallableRoutineInventory,false);
  assert.equal(r.releaseDecision,'NO_GO');
 }
});

test('audit uses one read-only transaction and rolls back',async()=>{
 const calls=[];
 const client={async query(sql){
  calls.push(sql);
  if(sql===QUERY)return {rows:[good]};
  return {rows:[]};
 }};
 const r=await auditReaderCallableRoutines({client});
 assert.equal(r.exactCallableRoutineInventory,true);
 assert.deepEqual(calls,['BEGIN READ ONLY',"SET LOCAL statement_timeout='5s'",QUERY,'ROLLBACK']);
});

test('query pins exact routine identity and source hash, without business-row reads or mutation',()=>{
 assert.match(QUERY,/assert_portal_profile_complete/);
 assert.match(QUERY,/p_customer_id integer/);
 assert.ok(QUERY.includes(EXPECTED_ROUTINE_FINGERPRINT));
 assert.ok(QUERY.includes(EXPECTED_SOURCE_SHA256));
 assert.match(QUERY,/sha256\(convert_to\(p\.prosrc/);
 assert.match(QUERY,/has_function_privilege/);
 assert.doesNotMatch(QUERY,/\bFROM\s+(?:public\.ai_tasks|gpt02_private\.approvals|gpt02_stage\.core_preparations)\b/i);
 assert.doesNotMatch(QUERY,/;\s*(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|CALL|COPY)\b/i);
});
