import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 QUERY,assessTrustedFactReaderReadiness, auditTrustedFactReaderReadiness
} from './gpt02-trusted-fact-reader-readiness.mjs';

const ready=Object.freeze({
 database_name:'postgres',inspected_by:'postgres',transaction_read_only:'on',
 required_columns:20,matching_columns:20,missing_columns:[],
 reader_roles:[{role:'gpt02_hub_evidence_reader',exists:true},
  {role:'gpt02_core_evidence_reader',exists:true}],
 binding_fields:[
  {field:'claims',exists:true},{field:'accountable_owner_id',exists:true},
  {field:'core_operator_user_id',exists:true},{field:'hub_signature',exists:true},
  {field:'core_signature',exists:true},{field:'link_digest',exists:true}
 ],
 signed_link_rows:1,prepared_rows:1
});
function invariant(result){
 assert.equal(result.releaseDecision,'NO_GO');
 assert.equal(result.independentlyAuthenticatedReads,false);
 assert.equal(result.originalSignerProven,false);
 assert.equal(result.issuerLeaseGranted,false);
 assert.equal(result.dispatchPermitted,false);
 assert.equal(result.taskCreated,false);
 assert.equal(typeof result.readOnly,'boolean');
}
test('even a fully green *catalog* cannot authorize an independently signed command',()=>{
 const result=assessTrustedFactReaderReadiness(ready);
 assert.equal(result.readOnly,true);
 assert.equal(result.sourceSchemaMatching,true);
 assert.equal(result.hubReaderProvisioned,true);
 assert.equal(result.coreReaderProvisioned,true);
 assert.equal(result.signedSidecarSchemaReady,true);
 assert.equal(result.immutableWorkerOwnerBinding,false,'catalogue cannot prove signed worker');
 assert.equal(result.signedLinkRowsPresent,true);
 assert.equal(result.preparedRowsPresent,true);
 assert.equal(result.blockers.at(-1),'INDEPENDENT_SESSIONS_AND_REAL_SIGNER_NOT_ATTESTED');
 invariant(result);
});
test('actual hosted-style baseline detects missing login roles, worker binding and new task',()=>{
 const x=assessTrustedFactReaderReadiness({
  ...ready,reader_roles:ready.reader_roles.map(x=>({...x,exists:false})),
  binding_fields:ready.binding_fields.map(x=>({...x,exists:false})),prepared_rows:0
 });
 assert.equal(x.sourceSchemaMatching,true);
 assert.equal(x.hubReaderProvisioned,false);
 assert.equal(x.coreReaderProvisioned,false);
 assert.equal(x.signedSidecarSchemaReady,false);
 assert.equal(x.immutableWorkerOwnerBinding,false);
 assert.equal(x.signedLinkRowsPresent,true);
 assert.equal(x.preparedRowsPresent,false);
 assert.deepEqual(x.blockers,[
  'TWO_RESTRICTED_READER_LOGINS_MISSING',
  'SIGNED_OPERATOR_LINK_SIDECAR_SCHEMA_MISSING',
  'NO_NEW_PREPARED_HUB_CORE_PAIR',
  'INDEPENDENT_SESSIONS_AND_REAL_SIGNER_NOT_ATTESTED'
 ]);
 invariant(x);
});
test('missing/altered catalog columns fail closed even if all reader labels are green',()=>{
 for(const delta of [
  {matching_columns:19},{missing_columns:['public.ai_tasks.assigned_to_id']},
  {required_columns:19},{required_columns:21},
  {missing_columns:null},{matching_columns:20.5}
 ]){
  const x=assessTrustedFactReaderReadiness({...ready,...delta});
  assert.equal(x.sourceSchemaMatching,false);
  assert.ok(x.blockers.includes('HOSTED_SOURCE_SCHEMA_MISMATCH'));
  invariant(x);
 }
});
test('fabricated login, excess field and unsigned row cannot produce operational authority',()=>{
 for(const mutation of [
  {reader_roles:[{role:'gpt02_hub_evidence_reader',exists:true}]},
  {reader_roles:[{role:'postgres',exists:true},{role:'gpt02_core_evidence_reader',exists:true}]},
  {reader_roles:[{role:'gpt02_hub_evidence_reader',exists:'true'},
   {role:'gpt02_core_evidence_reader',exists:true}]},
  {binding_fields:[...ready.binding_fields,{field:'unverified_signer',exists:true}]},
  {binding_fields:[{field:'claims',exists:true},{field:'accountable_owner_id',exists:true}]},
  {prepared_rows:-1}
 ]){
  const r=assessTrustedFactReaderReadiness({...ready,...mutation});
  invariant(r);
  assert.ok(r.blockers.length>=1);
 }
});
test('wrong DB, transaction outside READ ONLY and malformed response are rejected',()=>{
 for(const row of [null,undefined,{}, {...ready,database_name:'production'},
  {...ready,transaction_read_only:'off'}, {...ready,transaction_read_only:true}]){
  const r=assessTrustedFactReaderReadiness(row);
  assert.equal(r.reason,'TRUSTED_CATALOG_READONLY_NOT_PROVEN');
  assert.equal(r.readOnly,false);
  invariant(r);
 }
});
function mock(rows=[ready],options={}){
 const calls=[];
 const client={async query(sql){
  calls.push(sql);
  if(options.fail && sql===QUERY)throw Error('postgres://private-secret@internal');
  return sql===QUERY?{rows}:{rows:[]};
 }};
 return {client,calls};
}
test('reader starts exact READ ONLY transaction, queries catalog only and ROLLBACKs',async()=>{
 const m=mock();
 const result=await auditTrustedFactReaderReadiness({client:m.client});
 assert.equal(result.readOnly,true);
 assert.deepEqual(m.calls,['BEGIN READ ONLY',"SET LOCAL statement_timeout='5s'",QUERY,'ROLLBACK']);
 assert.equal(result.sourceSchemaMatching,true);
 invariant(result);
});
test('reader refuses absent client or multiple catalog rows',async()=>{
 const absent=await auditTrustedFactReaderReadiness();
 assert.equal(absent.readOnly,false);
 invariant(absent);
 const m=mock([ready,ready]);
 const r=await auditTrustedFactReaderReadiness({client:m.client});
 assert.equal(r.reason,'CATALOG_CARDINALITY_UNSAFE');
 invariant(r);
});
test('query failure is sanitized and transaction rolled back',async()=>{
 const m=mock([ready],{fail:true});
 const r=await auditTrustedFactReaderReadiness({client:m.client});
 assert.equal(r.reason,'CATALOG_QUERY_FAILED_CLOSED');
 assert.equal(r.readOnly,false);
 assert.equal(m.calls.at(-1),'ROLLBACK');
 assert.equal(JSON.stringify(r).includes('private-secret'),false);
 invariant(r);
});
test('catalog probe contains no business values, no commands or mutations',()=>{
 assert.match(QUERY,/pg_catalog\.pg_attribute/);
 assert.match(QUERY,/current_setting\('transaction_read_only'\)/);
 assert.match(QUERY,/gpt02_hub_evidence_reader/);
 assert.match(QUERY,/gpt02_core_evidence_reader/);
 assert.match(QUERY,/gpt02_private/);
 assert.match(QUERY,/hub_signature/);
 assert.match(QUERY,/core_signature/);
 assert.match(QUERY,/signed_link_rows/);
 assert.match(QUERY,/accountable_owner_id/);
 const sanitized=QUERY.replace(/'(?:''|[^'])*'/g,"''");
 assert.doesNotMatch(sanitized,/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|CALL|COPY)\b/i);
 assert.doesNotMatch(QUERY,/SELECT\s+\*\s+FROM\s+public\./i);
 const source=readFileSync(new URL('./gpt02-trusted-fact-reader-readiness.mjs',import.meta.url),'utf8');
 for(const absent of ['createSigner','sendCommand','submitAiTask','dispatchCommand('])
  assert.equal(source.includes(absent),false);
});
