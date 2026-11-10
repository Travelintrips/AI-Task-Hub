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
 memberships:0,members_of_role:0,active_sessions:0,global_read:false,global_write:false,
 db_create:false,private_usage:true,private_create:false,owned_objects:0,special_admin:false,
 sequence_privileges:0,column_diff_count:0,select_column_count:32,table_level_grants:0,
 policy_count:3,exact_policy_count:3,callable_security_definer:0,callable_mutating:0,
 callable_count:1,allowed_callable_count:1,...patch
});

test('exact inert issuer reader catalog passes evidence only',()=>{
 assert.equal(EXPECTED_COLUMNS.length,32);
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
  {memberships:1},{members_of_role:1},{active_sessions:1},{global_read:true},
  {global_write:true},{db_create:true},{private_usage:false},{private_create:true},
  {owned_objects:1},{special_admin:true},{sequence_privileges:1},
  {column_diff_count:1},{select_column_count:31},{table_level_grants:1},
  {policy_count:2},{exact_policy_count:2},{callable_security_definer:1},
  {callable_mutating:1},{callable_count:2},{allowed_callable_count:0},
  {rolconfig:['default_transaction_read_only=on']}
 ])assert.equal(verifyIssuerReaderReadiness(row(patch)),false,JSON.stringify(patch));
});

test('catalog query covers exact column, RLS and effective privilege surfaces',()=>{
 assert.match(QUERY,/information_schema\.table_privileges/);
 assert.match(QUERY,/has_column_privilege/);
 assert.match(QUERY,/pg_policies/);
 assert.match(QUERY,/relforcerowsecurity/);
 assert.match(QUERY,/pg_auth_members/);
 assert.match(QUERY,/pg_shdepend/);
 assert.match(QUERY,/pg_read_all_data/);
 assert.match(QUERY,/has_sequence_privilege/);
 assert.match(QUERY,/has_function_privilege/);
 assert.match(QUERY,/assert_portal_profile_complete/);
 assert.equal(QUERY.trim().toUpperCase().startsWith('WITH'),true);
 assert.doesNotMatch(QUERY,/;\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|GRANT|REVOKE|CALL|TRUNCATE)\b/i);
});

test('migration is inert, column-scoped and has no authority surface',async()=>{
 const src=await readFile(new URL('./gpt02-issuer-evidence-reader-hosted-inert.sql',import.meta.url),'utf8');
 for(const required of [
  'NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT',
  'NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 0',
  "SET default_transaction_read_only='on'",
  "SET search_path='pg_catalog'",
  'GRANT USAGE ON SCHEMA gpt02_private',
  'GRANT SELECT (id,command_id,nonce,digest,consumed_at)',
  'issuer_evidence_reader_select',
  'FOR SELECT TO gpt02_issuer_evidence_reader USING (true)',
  'REVOKE EXECUTE ON FUNCTION gpt02_private.reject_mutation()'
 ])assert.ok(src.includes(required),required);
 for(const forbidden of [
  'PASSWORD','dev_gpt02_issuer_evidence','dev_gpt02_attestor_evidence',
  'GRANT INSERT','GRANT UPDATE','GRANT DELETE','GRANT EXECUTE',
  'SECURITY DEFINER','SUPABASE_DATABASE_URL_PROD','dispatch'
 ])assert.equal(src.includes(forbidden),false,forbidden);
});
