import test from 'node:test';
import assert from 'node:assert/strict';
import {
 QUERY,EXPECTED_SCHEMA_USAGE,assessReaderSchemaUsage,auditReaderSchemaUsage
} from './gpt02-reader-schema-usage-readiness.mjs';

const good={
 database_name:'postgres',transaction_read_only:'on',
 expected_schema_usage:EXPECTED_SCHEMA_USAGE.length,
 actual_schema_usage:EXPECTED_SCHEMA_USAGE.length,
 difference_count:0,differences:[]
};

test('exact five schema usages pass inventory only, never authority',()=>{
 const r=assessReaderSchemaUsage(good);
 assert.equal(r.readOnly,true);
 assert.equal(r.exactSchemaUsage,true);
 assert.equal(r.actualSchemaUsage,5);
 assert.equal(r.reason,'EXACT_READER_SCHEMA_USAGE_PASS_NO_AUTHORITY');
 assert.equal(r.dispatchPermitted,false);
 assert.equal(r.issuerLeaseGranted,false);
 assert.equal(r.releaseDecision,'NO_GO');
});

test('one unexpected or missing schema fails closed',()=>{
 for(const row of [
  {...good,actual_schema_usage:6,difference_count:1,
    differences:[{issue:'UNEXPECTED',role:'gpt02_core_evidence_reader',schema:'sport_center'}]},
  {...good,actual_schema_usage:4,difference_count:1,
    differences:[{issue:'MISSING',role:'gpt02_hub_evidence_reader',schema:'gpt02_private'}]}
 ]){
  const r=assessReaderSchemaUsage(row);
  assert.equal(r.exactSchemaUsage,false);
  assert.equal(r.reason,'READER_SCHEMA_USAGE_DRIFT');
  assert.equal(r.dispatchPermitted,false);
 }
});

test('wrong database, non-readonly or malformed differences fail closed',()=>{
 for(const row of [
  {...good,database_name:'production'},
  {...good,transaction_read_only:'off'},
  {...good,differences:null}
 ]){
  const r=assessReaderSchemaUsage(row);
  assert.equal(r.exactSchemaUsage,false);
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
 const r=await auditReaderSchemaUsage({client});
 assert.equal(r.exactSchemaUsage,true);
 assert.deepEqual(calls,['BEGIN READ ONLY',"SET LOCAL statement_timeout='5s'",QUERY,'ROLLBACK']);
});

test('query is catalog-only and never grants or reads business rows',()=>{
 assert.match(QUERY,/pg_namespace/);
 assert.match(QUERY,/has_schema_privilege/);
 assert.match(QUERY,/difference_count/);
 assert.doesNotMatch(QUERY,/FROMs+(?:public.ai_tasks|gpt02_private.approvals|gpt02_stage.core_preparations)/i);
 assert.doesNotMatch(QUERY,/;s*(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|CALL|COPY)/i);
});
