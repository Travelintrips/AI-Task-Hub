import test from 'node:test';
import assert from 'node:assert/strict';
import {
 QUERY,EXPECTED_POLICY_COUNT,EXPECTED_POLICY_FINGERPRINT,
 assessReaderRls,auditReaderRls
} from './gpt02-reader-rls-readiness.mjs';

const good={
 database_name:'postgres',transaction_read_only:'on',
 policy_count:EXPECTED_POLICY_COUNT,
 policy_fingerprint:EXPECTED_POLICY_FINGERPRINT,
 public_policy_count:0,all_rls_enabled:true
};

test('exact effective reader RLS fingerprint passes inventory only',()=>{
 const r=assessReaderRls(good);
 assert.equal(r.readOnly,true);
 assert.equal(r.exactReaderRls,true);
 assert.equal(r.policyCount,EXPECTED_POLICY_COUNT);
 assert.equal(r.publicPolicyCount,0);
 assert.equal(r.allRlsEnabled,true);
 assert.equal(r.reason,'EXACT_READER_RLS_PASS_NO_AUTHORITY');
 assert.equal(r.dispatchPermitted,false);
 assert.equal(r.issuerLeaseGranted,false);
 assert.equal(r.releaseDecision,'NO_GO');
});

test('policy count, fingerprint, PUBLIC policy or RLS disable drift fails closed',()=>{
 for(const row of [
  {...good,policy_count:EXPECTED_POLICY_COUNT-1},
  {...good,policy_fingerprint:'0'.repeat(64)},
  {...good,public_policy_count:1},
  {...good,all_rls_enabled:false}
 ]){
  const r=assessReaderRls(row);
  assert.equal(r.exactReaderRls,false);
  assert.equal(r.reason,'READER_RLS_POLICY_DRIFT');
  assert.equal(r.releaseDecision,'NO_GO');
 }
});

test('wrong database or non-readonly catalog fails closed',()=>{
 for(const row of [
  {...good,database_name:'production'},
  {...good,transaction_read_only:'off'},
  null
 ]){
  const r=assessReaderRls(row);
  assert.equal(r.exactReaderRls,false);
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
 const r=await auditReaderRls({client});
 assert.equal(r.exactReaderRls,true);
 assert.deepEqual(calls,['BEGIN READ ONLY',"SET LOCAL statement_timeout='5s'",QUERY,'ROLLBACK']);
});

test('query fingerprints effective PUBLIC + reader policies and is non-mutating',()=>{
 assert.match(QUERY,/pg_policy/);
 assert.match(QUERY,/polroles @> array\[0::oid\]/);
 assert.match(QUERY,/polpermissive/);
 assert.match(QUERY,/polwithcheck/);
 assert.match(QUERY,/relrowsecurity/);
 assert.match(QUERY,/relforcerowsecurity/);
 assert.match(QUERY,/public_policy_count/);
 assert.doesNotMatch(QUERY,/\bFROM\s+(?:public\.ai_tasks|gpt02_private\.approvals|gpt02_stage\.core_preparations)\b/i);
 assert.doesNotMatch(QUERY,/;\s*(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|CALL|COPY)\b/i);
});
