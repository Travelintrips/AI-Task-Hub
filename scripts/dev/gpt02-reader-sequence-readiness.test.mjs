import test from 'node:test';
import assert from 'node:assert/strict';
import {
 QUERY,assessReaderSequencePrivileges,auditReaderSequencePrivileges
} from './gpt02-reader-sequence-readiness.mjs';

const good={
 database_name:'postgres',transaction_read_only:'on',
 reader_count:2,privileged_sequence_count:0,leaks:[]
};

test('two readers with zero sequence privileges pass inventory only',()=>{
 const r=assessReaderSequencePrivileges(good);
 assert.equal(r.readOnly,true);
 assert.equal(r.readerCount,2);
 assert.equal(r.exactNoSequencePrivileges,true);
 assert.equal(r.privilegedSequenceCount,0);
 assert.equal(r.reason,'NO_READER_SEQUENCE_PRIVILEGES_PASS_NO_AUTHORITY');
 assert.equal(r.dispatchPermitted,false);
 assert.equal(r.issuerLeaseGranted,false);
 assert.equal(r.releaseDecision,'NO_GO');
});

test('any sequence USAGE SELECT or UPDATE drift fails closed',()=>{
 const r=assessReaderSequencePrivileges({
  ...good,privileged_sequence_count:1,
  leaks:[{role:'gpt02_hub_evidence_reader',schema:'public',sequence:'x',usage:true,select:false,update:false}]
 });
 assert.equal(r.exactNoSequencePrivileges,false);
 assert.equal(r.reason,'READER_SEQUENCE_PRIVILEGE_DRIFT');
 assert.equal(r.releaseDecision,'NO_GO');
});

test('wrong database, non-readonly, malformed leaks or wrong reader count fail closed',()=>{
 for(const row of [
  {...good,database_name:'production'},
  {...good,transaction_read_only:'off'},
  {...good,leaks:null},
  {...good,reader_count:1}
 ]){
  const r=assessReaderSequencePrivileges(row);
  assert.equal(r.exactNoSequencePrivileges,false);
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
 const r=await auditReaderSequencePrivileges({client});
 assert.equal(r.exactNoSequencePrivileges,true);
 assert.deepEqual(calls,['BEGIN READ ONLY',"SET LOCAL statement_timeout='5s'",QUERY,'ROLLBACK']);
});

test('query is catalog-only and non-mutating',()=>{
 assert.match(QUERY,/has_sequence_privilege/);
 assert.match(QUERY,/relkind='S'/);
 assert.doesNotMatch(QUERY,/\bFROM\s+(?:public\.ai_tasks|gpt02_private\.approvals|gpt02_stage\.core_preparations)\b/i);
 assert.doesNotMatch(QUERY,/;\s*(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|CALL|COPY)\b/i);
});
