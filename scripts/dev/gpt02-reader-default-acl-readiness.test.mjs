import test from 'node:test';
import assert from 'node:assert/strict';
import {
 QUERY,assessReaderDefaultAcl,auditReaderDefaultAcl
} from './gpt02-reader-default-acl-readiness.mjs';

const good={
 database_name:'postgres',transaction_read_only:'on',
 reader_count:2,default_acl_leak_count:0,leaks:[]
};

test('two readers with zero default ACL leaks pass inventory only',()=>{
 const r=assessReaderDefaultAcl(good);
 assert.equal(r.readOnly,true);
 assert.equal(r.readerCount,2);
 assert.equal(r.exactNoDefaultAclLeaks,true);
 assert.equal(r.defaultAclLeakCount,0);
 assert.equal(r.reason,'NO_READER_DEFAULT_ACL_LEAKS_PASS_NO_AUTHORITY');
 assert.equal(r.dispatchPermitted,false);
 assert.equal(r.issuerLeaseGranted,false);
 assert.equal(r.releaseDecision,'NO_GO');
});

test('any direct or PUBLIC future-object default privilege leak fails closed',()=>{
 for(const leak of [
  {reader:'gpt02_hub_evidence_reader',owner_role:'postgres',
   schema_name:'public',defaclobjtype:'r',privilege_type:'SELECT',is_grantable:false,source:'DIRECT'},
  {reader:'PUBLIC',owner_role:'postgres',
   schema_name:'ai_platform',defaclobjtype:'f',privilege_type:'EXECUTE',is_grantable:false,source:'PUBLIC'}
 ]){
  const r=assessReaderDefaultAcl({...good,default_acl_leak_count:1,leaks:[leak]});
  assert.equal(r.exactNoDefaultAclLeaks,false);
  assert.equal(r.reason,'READER_DEFAULT_ACL_DRIFT');
  assert.equal(r.releaseDecision,'NO_GO');
 }
});

test('wrong database, non-readonly, malformed leaks or wrong reader count fail closed',()=>{
 for(const row of [
  {...good,database_name:'production'},
  {...good,transaction_read_only:'off'},
  {...good,leaks:null},
  {...good,reader_count:1}
 ]){
  const r=assessReaderDefaultAcl(row);
  assert.equal(r.exactNoDefaultAclLeaks,false);
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
 const r=await auditReaderDefaultAcl({client});
 assert.equal(r.exactNoDefaultAclLeaks,true);
 assert.deepEqual(calls,['BEGIN READ ONLY',"SET LOCAL statement_timeout='5s'",QUERY,'ROLLBACK']);
});

test('query is catalog-only and non-mutating',()=>{
 assert.match(QUERY,/pg_default_acl/);
 assert.match(QUERY,/aclexplode/);
 assert.match(QUERY,/x\.grantee=0/);
 assert.match(QUERY,/public_leaks/);
 assert.match(QUERY,/DIRECT/);
 assert.doesNotMatch(QUERY,/\bFROM\s+(?:public\.ai_tasks|gpt02_private\.approvals|gpt02_stage\.core_preparations)\b/i);
 assert.doesNotMatch(QUERY,/;\s*(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|CALL|COPY)\b/i);
});
