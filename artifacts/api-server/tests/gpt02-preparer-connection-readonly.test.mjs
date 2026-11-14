import test from 'node:test';
import assert from 'node:assert/strict';
import {Gpt02CoreTaskPreparer} from '../src/lib/gpt02-core-task-preparation.mjs';
const expected=()=>({login:'gpt02_core_prep_login',session:'gpt02_core_prep_login',
 read_only:'on',limited:true,connection_limit:1,valid_until:new Date(Date.now()+90_000),
 no_membership:true,no_db_create:true});
const rights=()=>({can_dispatch:false,can_core_write:false,can_hub_write:false});
function harness({tls=true,role=expected(),priv=rights(),throwOn=''}={}){
 const calls=[];let released=false;
 const client={
  connection:{stream:{authorized:tls,encrypted:tls}},
  async query(sql){
   calls.push(sql);
   if(throwOn&&sql.includes(throwOn))throw Error('synthetic secret must not reach response');
   if(sql.includes('current_user AS login'))return {rows:[role]};
   if(sql.includes('has_table_privilege'))return {rows:[priv]};
   return {rows:[]};
  },
  release(flag){released=flag}
 };
 const preparer=new Gpt02CoreTaskPreparer({pool:{async connect(){return client}}});
 return {preparer,calls,released:()=>released};
}
test('authenticated TLS reader never writes a preparation or issues a dispatch',async()=>{
 const h=harness(),proof=await h.preparer.verifyReadiness();
 assert.deepEqual(proof,{verified:true,readOnly:true,operatorApprovalGranted:false,
  issuerGrantReady:false,dispatchPermitted:false});
 assert.ok(h.calls.includes('BEGIN READ ONLY'));
 assert.ok(h.calls.includes('ROLLBACK'));
 assert.ok(h.calls.every(x=>!x.includes('INSERT ')&&!x.includes('UPDATE ')&&
  !x.includes('COMMIT')&&!x.includes('gpt02_stage.prepare_core_task(')));
 assert.equal(h.released(),true);
});
test('unverified TLS rejected before PostgreSQL query',async()=>{
 const h=harness({tls:false});
 await assert.rejects(h.preparer.verifyReadiness(),e=>e.code==='PINNED_TLS_PREPARER_SESSION_REQUIRED');
 assert.deepEqual(h.calls,[]);assert.equal(h.released(),true);
});
test('role identity and lifetime never accepted from arbitrary login',async()=>{
 for(const r of [
  {...expected(),login:'postgres'}, {...expected(),session:'postgres'},
  {...expected(),read_only:'off'}, {...expected(),limited:false},
  {...expected(),no_membership:false},{...expected(),no_db_create:false},
  {...expected(),connection_limit:2},
  {...expected(),valid_until:new Date(Date.now()-60_000)},
  {...expected(),valid_until:new Date(Date.now()+11*60_000)},
 ]){
  const h=harness({role:r});
  await assert.rejects(h.preparer.verifyReadiness(),e=>e.code==='DEV_PREPARER_AUTHENTICATED_ROLE_NOT_SCOPED');
  assert.ok(h.calls.includes('ROLLBACK'));assert.equal(h.released(),true);
 }
});
test('forbidden table authority denied with rollback',async()=>{
 for(const k of ['can_dispatch','can_core_write','can_hub_write']){
  const h=harness({priv:{...rights(),[k]:true}});
  await assert.rejects(h.preparer.verifyReadiness(),e=>e.code==='DIRECT_LEDGER_WRITE_OR_COMMAND_AUTHORITY_FORBIDDEN');
  assert.ok(h.calls.includes('ROLLBACK'));assert.equal(h.released(),true);
 }
});
test('database read failure does not expose credential and does not grant',async()=>{
 const h=harness({throwOn:'current_user AS login'});
 await assert.rejects(h.preparer.verifyReadiness(),e=>e.code==='PREPARER_READ_ONLY_CONNECTION_UNAVAILABLE'&&
  !e.message.includes('synthetic secret'));
 assert.ok(h.calls.includes('ROLLBACK'));assert.equal(h.released(),true);
});
