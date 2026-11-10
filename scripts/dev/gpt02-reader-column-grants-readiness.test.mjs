import test from 'node:test';
import assert from 'node:assert/strict';
import {
 QUERY,EXPECTED_COLUMN_GRANTS,assessReaderColumnGrants,auditReaderColumnGrants
} from './gpt02-reader-column-grants-readiness.mjs';

const good={
 database_name:'postgres',transaction_read_only:'on',
 expected_column_grants:EXPECTED_COLUMN_GRANTS,
 actual_column_grants:EXPECTED_COLUMN_GRANTS,
 difference_count:0,differences:[]
};

test('exact 86 column grants pass inventory only, never authority',()=>{
 const r=assessReaderColumnGrants(good);
 assert.equal(r.readOnly,true);
 assert.equal(r.exactColumnGrants,true);
 assert.equal(r.actualColumnGrants,EXPECTED_COLUMN_GRANTS);
 assert.equal(r.reason,'EXACT_READER_COLUMN_GRANTS_PASS_NO_AUTHORITY');
 assert.equal(r.dispatchPermitted,false);
 assert.equal(r.issuerLeaseGranted,false);
 assert.equal(r.releaseDecision,'NO_GO');
});

test('one unexpected or one missing column fails closed',()=>{
 for(const row of [
  {...good,actual_column_grants:EXPECTED_COLUMN_GRANTS+1,difference_count:1,
   differences:[{issue:'UNEXPECTED',column:'attempt_number'}]},
  {...good,actual_column_grants:EXPECTED_COLUMN_GRANTS-1,difference_count:1,
   differences:[{issue:'MISSING',column:'digest'}]}
 ]){
  const r=assessReaderColumnGrants(row);
  assert.equal(r.exactColumnGrants,false);
  assert.equal(r.reason,'READER_COLUMN_GRANTS_DRIFT');
  assert.equal(r.dispatchPermitted,false);
 }
});

test('wrong database, non-readonly or malformed differences fail closed',()=>{
 for(const row of [
  {...good,database_name:'production'},
  {...good,transaction_read_only:'off'},
  {...good,differences:null}
 ]){
  const r=assessReaderColumnGrants(row);
  assert.equal(r.exactColumnGrants,false);
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
 const r=await auditReaderColumnGrants({client});
 assert.equal(r.exactColumnGrants,true);
 assert.deepEqual(calls,['BEGIN READ ONLY',"SET LOCAL statement_timeout='5s'",QUERY,'ROLLBACK']);
});

test('query is catalog-only and cannot read task/evidence rows or mutate',()=>{
 assert.match(QUERY,/pg_attribute/);
 assert.match(QUERY,/c\.relkind IN \('r','p','f','v','m'\)/);
 assert.match(QUERY,/has_column_privilege/);
 assert.match(QUERY,/difference_count/);
 assert.match(QUERY,/gpt02_hub_evidence_reader/);
 assert.match(QUERY,/gpt02_core_evidence_reader/);
 assert.doesNotMatch(QUERY,/\bFROM\s+(?:public\.ai_tasks|gpt02_private\.approvals|gpt02_stage\.core_preparations)\b/i);
 assert.doesNotMatch(QUERY,/;\s*(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|CALL|COPY)\b/i);
});
