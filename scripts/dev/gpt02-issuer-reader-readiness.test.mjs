import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {EXPECTED_COLUMNS,QUERY,readinessReport,verifyIssuerReaderReadiness}
 from './gpt02-issuer-reader-readiness.mjs';

const row=(patch={})=>({
 db:'postgres',rolcanlogin:false,rolconnlimit:0,rolsuper:false,rolcreaterole:false,
 rolcreatedb:false,rolinherit:false,rolreplication:false,rolbypassrls:false,
 rolconfig:['default_transaction_read_only=on','search_path=pg_catalog',
  'statement_timeout=5s','lock_timeout=1s','idle_in_transaction_session_timeout=10s'],
 memberships:0,members_of_role:1,exact_management_member:true,active_sessions:0,
 global_read:false,global_write:false,
 db_create:false,private_usage:true,private_create:false,owned_objects:0,special_admin:false,
 sequence_privileges:0,column_diff_count:0,select_column_count:51,table_level_grants:0,
 policy_count:5,exact_policy_count:5,public_policy_count:0,callable_security_definer:0,callable_mutating:0,
 callable_count:1,allowed_callable_count:1,...patch
});

test('exact inert issuer reader catalog passes evidence only',()=>{
 assert.equal(EXPECTED_COLUMNS.length,51);
 assert.equal(verifyIssuerReaderReadiness(row()),true);
 const r=readinessReport(row());
 assert.equal(r.catalogVerified,true);
 assert.equal(r.reason,'ISSUER_READER_HOSTED_INERT_PASS');
 assert.equal(r.loginEnabled,false);
 assert.equal(r.signingPermitted,false);
 assert.equal(r.authorizationGranted,false);
 assert.equal(r.dispatchPermitted,false);
 assert.equal(r.releaseDecision,'NO_GO');
});

test('any privilege, role, grant, RLS or callable drift fails closed',()=>{
 for(const patch of [
  {rolcanlogin:true},{rolconnlimit:1},{rolsuper:true},{rolinherit:true},
  {memberships:1},{members_of_role:0},{members_of_role:2},{exact_management_member:false},
  {active_sessions:1},{global_read:true},
  {global_write:true},{db_create:true},{private_usage:false},{private_create:true},
  {owned_objects:1},{special_admin:true},{sequence_privileges:1},
  {column_diff_count:1},{select_column_count:50},{table_level_grants:1},
  {policy_count:4},{exact_policy_count:4},{public_policy_count:1},{callable_security_definer:1},
  {callable_mutating:1},{callable_count:2},{allowed_callable_count:0},
  {rolconfig:['default_transaction_read_only=on']}
 ])assert.equal(verifyIssuerReaderReadiness(row(patch)),false,JSON.stringify(patch));
});

test('catalog query covers exact column, RLS and effective privilege surfaces',()=>{
 assert.match(QUERY,/information_schema\.table_privileges/);
 assert.match(QUERY,/has_column_privilege/);
 assert.match(QUERY,/approvals/);
 assert.match(QUERY,/operator_links/);
 assert.match(QUERY,/public_policy_count/);
 assert.match(QUERY,/task_id > 136/);
 assert.match(QUERY,/attempt_number = 1/);
 assert.match(QUERY,/pg_policies/);
 assert.match(QUERY,/relforcerowsecurity/);
 assert.match(QUERY,/pg_auth_members/);
 assert.match(QUERY,/supabase_admin/);
 assert.match(QUERY,/m\.set_option/);
 assert.match(QUERY,/pg_shdepend/);
 assert.match(QUERY,/pg_read_all_data/);
 assert.match(QUERY,/has_sequence_privilege/);
 assert.match(QUERY,/has_function_privilege/);
 assert.match(QUERY,/assert_portal_profile_complete/);
 assert.equal(QUERY.trim().toUpperCase().startsWith('WITH'),true);
 assert.doesNotMatch(QUERY,/;\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|GRANT|REVOKE|CALL|TRUNCATE)\b/i);
});

test('role bootstrap is inert and owner grants are separately fenced',async()=>{
 const roleSrc=await readFile(new URL('./gpt02-issuer-evidence-reader-hosted-inert.sql',import.meta.url),'utf8');
 const ownerSrc=await readFile(new URL('./gpt02-issuer-evidence-reader-owner-grants.sql',import.meta.url),'utf8');
 for(const required of [
  'NOLOGIN NOINHERIT CONNECTION LIMIT 0',
  "r.rolsuper IS FALSE","r.rolcreatedb IS FALSE","r.rolcreaterole IS FALSE",
  "r.rolreplication IS FALSE","r.rolbypassrls IS FALSE",
  'GPT02_ISSUER_READER_ROLE_BASELINE_UNSAFE',
  "SET default_transaction_read_only='on'","SET search_path='pg_catalog'"
 ])assert.ok(roleSrc.includes(required),required);
 for(const forbidden of [
  'GRANT USAGE ON SCHEMA','GRANT SELECT','CREATE POLICY','PASSWORD',
  'dev_gpt02_issuer_evidence','dev_gpt02_attestor_evidence'
 ])assert.equal(roleSrc.includes(forbidden),false,forbidden);
 for(const required of [
  "current_user <> 'gpt02_store_owner'","GPT02_STORE_OWNER_SESSION_REQUIRED",
  "GRANT gpt02_store_owner TO postgres WITH SET TRUE GRANTED BY postgres",
  "SET LOCAL ROLE gpt02_store_owner",
  "REVOKE SET OPTION FOR gpt02_store_owner FROM postgres GRANTED BY postgres RESTRICT",
  "g.rolname='supabase_admin'","member.rolname='postgres'",
  "m.admin_option AND NOT m.inherit_option AND NOT m.set_option",
  'GPT02_STORE_OWNER_ESCROW_NOT_RESTORED',
  'GRANT USAGE ON SCHEMA gpt02_private',
  "c.relname IN ('approvals','operator_links','receipts','core_identity_receipts','post_consumption_fences')",
  'REVOKE SELECT (command_id,attempt_id,nonce,task_id,company_id,approver_id,claims,signature,digest,expires_at,recorded_at,operator_namespace)',
  'REVOKE SELECT (link_id,command_id,hub_execution_id,core_task_id,hub_task_id,attempt_id,attempt_number,company_id,assignee_id,accountable_owner_id,hub_operator_id,core_operator_user_id,approval_digest,link_digest,hub_signature,core_signature,claims,expires_at,created_at)',
  'GRANT SELECT (command_id,attempt_id,nonce,task_id,company_id,approver_id,claims,digest)',
  'link_id,command_id,hub_execution_id,core_task_id,hub_task_id,attempt_id',
  'GRANT SELECT (id,command_id,nonce,digest,consumed_at)',
  'CREATE POLICY issuer_evidence_reader_select ON gpt02_private.approvals',
  'CREATE POLICY issuer_evidence_reader_select ON gpt02_private.operator_links',
  "USING (company_id='default' AND task_id>136 AND claims->>'environment'='DEV')",
  "USING (company_id='default' AND hub_task_id>136 AND attempt_number=1",
  'issuer_evidence_reader_select',
  // Evidence descendants must remain linked to the restricted DEV task.
  'USING (EXISTS (',
  'a.nonce=receipts.nonce AND a.digest=receipts.digest',
  'r.id=core_identity_receipts.receipt_id',
  'l.link_id=core_identity_receipts.link_id',
  'r.id=post_consumption_fences.receipt_id',
  'l.attempt_id=post_consumption_fences.attempt_id',
  'l.hub_execution_id=post_consumption_fences.hub_execution_id',
  'l.core_task_id=post_consumption_fences.core_task_id'
 ])assert.ok(ownerSrc.includes(required),required);
  for(const table of ['receipts','core_identity_receipts','post_consumption_fences']){
    assert.match(ownerSrc,new RegExp(
      'CREATE POLICY issuer_evidence_reader_select ON gpt02_private\\.'+table+
      '\\s+FOR SELECT TO gpt02_issuer_evidence_reader\\s+USING \\(EXISTS \\('),
      'MISSING_SCOPED_READER_POLICY_'+table);
  }
  assert.doesNotMatch(ownerSrc,
    /FOR SELECT TO gpt02_issuer_evidence_reader\s+USING\s*\(\s*true\s*\)/i,
    'OBSOLETE_BROAD_ISSUER_POLICY_FORBIDDEN');
 // Ignore standalone explanatory SQL comments, but never active SQL.
 const ownerNonCommentSql=ownerSrc.split('\n')
   .filter(line=>!line.trimStart().startsWith('--')).join('\n');
 for(const forbidden of [
  'CREATE ROLE','ALTER ROLE','PASSWORD','GRANT INSERT','GRANT UPDATE','GRANT DELETE',
  'GRANT EXECUTE','SECURITY DEFINER','SUPABASE_DATABASE_URL_PROD','dispatchPermitted=true'
 ])assert.equal(ownerNonCommentSql.includes(forbidden),false,forbidden);
});

test('native issuer proof must reject obsolete all-rows RLS before release',async()=>{
 const native=await readFile(new URL('./gpt02-issuer-native-reader-proof-once.sh',import.meta.url),'utf8');
 assert.equal(/p\.qual\s*=\s*'true'/i.test(native),false,
  'NATIVE_PROOF_STILL_ACCEPTS_UNSCOPED_USING_TRUE: requires independently reviewed native-proof update');
});
