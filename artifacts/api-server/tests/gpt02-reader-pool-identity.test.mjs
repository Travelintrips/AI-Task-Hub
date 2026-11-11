import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyGpt02TrustedReaderPools} from '../src/lib/gpt02-trusted-facts-readonly.mjs';

function identity(role,pid,patch={}){
 return {
  db:'postgres',login:role,session:role,read_only:'on',
  default_readonly:true,search_path_locked:true,
  statement_timeout_locked:true,lock_timeout_locked:true,
  idle_tx_timeout_locked:true,backend_pid:pid,
  restricted:true,no_memberships:true,exact_management_member:true,
  no_global_read:true,no_global_write:true,no_db_create:true,
  no_schema_create:true,no_owned_objects:true,no_special_admin_roles:true,
  no_sequence_privileges:true,no_foreign_server_usage:true,
  no_foreign_table_select:true,no_view_select:true,
  no_mutating_relation_privileges:true,
  no_callable_security_definer_routines:true,
  exact_callable_routines:true,no_callable_mutating_routines:true,
  ...patch
 };
}
function fixture({hubPatch={},corePatch={},hubPid=4101,corePid=4102,hubTls=true,coreTls=true}={}){
 const records=[];
 function pool(role,pid,patch,tls){
  const client={
   connection:{stream:{encrypted:tls,authorized:tls,authorizationError:undefined}},
   async query(sql){
    records.push({role,sql});
    if(sql.startsWith('SELECT current_database()'))return {rows:[identity(role,pid,patch)]};
    return {rows:[]};
   },
   released:false,
   release(force){this.released=force;records.push({role,release:force});}
  };
  return {async connect(){records.push({role,connect:true});return client;},client};
 }
 const hub=pool('gpt02_hub_evidence_reader',hubPid,hubPatch,hubTls);
 const core=pool('gpt02_core_evidence_reader',corePid,corePatch,coreTls);
 return {hub,core,records,pools:{hubPool:hub,corePool:core}};
}

test('verifies two independent restricted TLS read-only sessions and rolls both back',async()=>{
 const f=fixture();
 const result=await verifyGpt02TrustedReaderPools(f.pools);
 assert.equal(result.environment,'DEV');
 assert.equal(result.hub.role,'gpt02_hub_evidence_reader');
 assert.equal(result.core.role,'gpt02_core_evidence_reader');
 assert.equal(result.hub.backendPid,4101);
 assert.equal(result.core.backendPid,4102);
 assert.equal(result.separateBackends,true);
 assert.equal(result.dispatchPermitted,false);
 assert.equal(result.signingPermitted,false);
 for(const role of ['gpt02_hub_evidence_reader','gpt02_core_evidence_reader']){
  const queries=f.records.filter(x=>x.role===role&&x.sql).map(x=>x.sql);
  assert.ok(queries.includes('BEGIN READ ONLY'));
  assert.ok(queries.includes('ROLLBACK'));
  assert.ok(queries.includes("SET LOCAL search_path TO pg_catalog"));
  assert.ok(queries.includes("SET LOCAL statement_timeout='5s'"));
  assert.ok(queries.includes("SET LOCAL lock_timeout='1s'"));
  assert.ok(queries.includes("SET LOCAL idle_in_transaction_session_timeout='10s'"));
  assert.ok(queries.includes('SET LOCAL row_security=on'));
  assert.equal(f.records.some(x=>x.role===role&&x.release===true),true);
 }
 assert.equal(f.records.some(x=>x.sql&&/\\b(?:INSERT|UPDATE|DELETE|TRUNCATE|CALL)\\b/i.test(x.sql)),false);
});

for(const [name,options] of [
 ['wrong Hub role',{hubPatch:{login:'postgres'}}],
 ['wrong Core role',{corePatch:{session:'postgres'}}],
 ['TLS not authorized',{hubTls:false}],
 ['reader has DML',{corePatch:{no_mutating_relation_privileges:false}}],
 ['reader has global read',{hubPatch:{no_global_read:false}}],
 ['wrong default read-only',{corePatch:{default_readonly:false}}],
 ['wrong search path',{hubPatch:{search_path_locked:false}}],
 ['same backend pid',{hubPid:4101,corePid:4101}]
]){
 test('fails closed and releases both sessions for '+name,async()=>{
  const f=fixture(options);
  await assert.rejects(
   verifyGpt02TrustedReaderPools(f.pools),
   e=>e.code==='TWO_INDEPENDENT_RESTRICTED_DB_LOGINS_REQUIRED'
  );
  for(const role of ['gpt02_hub_evidence_reader','gpt02_core_evidence_reader']){
   assert.equal(f.records.some(x=>x.role===role&&x.sql==='ROLLBACK'),true);
   assert.equal(f.records.some(x=>x.role===role&&x.release===true),true);
  }
 });
}

test('rejects one shared pool before opening a connection',async()=>{
 let connects=0;
 const pool={async connect(){connects++;return null}};
 await assert.rejects(verifyGpt02TrustedReaderPools({hubPool:pool,corePool:pool}),
  e=>e.code==='INDEPENDENT_HUB_CORE_POOLS_REQUIRED');
 assert.equal(connects,0);
});
