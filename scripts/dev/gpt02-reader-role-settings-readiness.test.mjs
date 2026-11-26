import test from 'node:test';
import assert from 'node:assert/strict';
import {
 QUERY,EXPECTED_CONFIG,assessReaderRoleSettings,auditReaderRoleSettings
} from './gpt02-reader-role-settings-readiness.mjs';

const good={
 database_name:'postgres',transaction_read_only:'on',reader_count:2,
 locked_roles:true,no_memberships:true,exact_management_membership:true,
 no_active_sessions:true,no_owned_objects:true,no_special_admin_roles:true,
 exact_role_config:true
};

test('exact inert reader settings pass inventory only, never authority',()=>{
 const r=assessReaderRoleSettings(good);
 assert.equal(EXPECTED_CONFIG.length,5);
 assert.equal(r.readOnly,true);
 assert.equal(r.readerCount,2);
 assert.equal(r.lockedRoles,true);
 assert.equal(r.noMemberships,true);
 assert.equal(r.exactManagementMembership,true);
 assert.equal(r.noActiveSessions,true);
 assert.equal(r.noOwnedObjects,true);
 assert.equal(r.noSpecialAdminRoles,true);
 assert.equal(r.exactRoleConfig,true);
 assert.equal(r.reason,'EXACT_INERT_READER_ROLE_SETTINGS_PASS_NO_AUTHORITY');
 assert.equal(r.dispatchPermitted,false);
 assert.equal(r.issuerLeaseGranted,false);
 assert.equal(r.releaseDecision,'NO_GO');
});

test('login activation, membership, session or config drift fails closed',()=>{
 for(const row of [
  {...good,locked_roles:false},
  {...good,no_memberships:false},
  {...good,exact_management_membership:false},
  {...good,no_active_sessions:false},
  {...good,no_owned_objects:false},
  {...good,no_special_admin_roles:false},
  {...good,exact_role_config:false},
  {...good,reader_count:1}
 ]){
  const r=assessReaderRoleSettings(row);
  assert.equal(r.reason,'READER_ROLE_SETTINGS_DRIFT');
  assert.equal(r.dispatchPermitted,false);
  assert.equal(r.releaseDecision,'NO_GO');
 }
});

test('wrong database or non-readonly catalog fails closed',()=>{
 for(const row of [
  {...good,database_name:'production'},
  {...good,transaction_read_only:'off'},
  null
 ]){
  const r=assessReaderRoleSettings(row);
  assert.equal(r.readOnly,false);
  assert.equal(r.dispatchPermitted,false);
 }
});

test('audit uses one read-only transaction and rolls back',async()=>{
 const calls=[];
 const client={async query(sql){
  calls.push(sql);
  if(sql===QUERY)return {rows:[good]};
  return {rows:[]};
 }};
 const r=await auditReaderRoleSettings({client});
 assert.equal(r.exactRoleConfig,true);
 assert.deepEqual(calls,['BEGIN READ ONLY',"SET LOCAL statement_timeout='5s'",QUERY,'ROLLBACK']);
});

test('query is catalog-only and exact config is pinned',()=>{
 assert.match(QUERY,/pg_db_role_setting/);
 assert.match(QUERY,/pg_auth_members/);
 assert.match(QUERY,/exact_management_membership/);
 assert.match(QUERY,/m\.set_option/);
 assert.match(QUERY,/supabase_admin/);
 assert.match(QUERY,/pg_stat_activity/);
 assert.match(QUERY,/pg_shdepend/);
 assert.match(QUERY,/no_owned_objects/);
 assert.match(QUERY,/no_special_admin_roles/);
 for(const setting of EXPECTED_CONFIG)assert.ok(QUERY.includes(setting));
 assert.doesNotMatch(QUERY,/\bFROM\s+(?:public\.ai_tasks|gpt02_private\.approvals|gpt02_stage\.core_preparations)\b/i);
 assert.doesNotMatch(QUERY,/;\s*(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|CALL|COPY)\b/i);
});
