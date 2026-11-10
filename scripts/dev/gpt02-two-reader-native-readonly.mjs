/**
 * CST-DEV ONLY. Native authentication proof for the two GPT02 evidence readers.
 * Never creates/activates roles, rotates credentials, reads business rows,
 * consumes nonce, calls issuer, creates tasks, or dispatches work.
 */
import {createRequire} from 'node:module';
import {createGpt02ReaderPools} from '../../artifacts/api-server/src/lib/gpt02-reader-pools.mjs';

const HUB='gpt02_hub_evidence_reader';
const CORE='gpt02_core_evidence_reader';

export const IDENTITY_QUERY=`SELECT current_database() AS db,current_user AS login,
 session_user AS session,current_setting('transaction_read_only')='on' AS in_readonly_tx,
 current_setting('default_transaction_read_only')='on' AS default_readonly,
 current_setting('search_path')='pg_catalog' AS search_path_locked,
 current_setting('statement_timeout')='5s' AS statement_timeout_locked,
 current_setting('lock_timeout')='1s' AS lock_timeout_locked,
 current_setting('idle_in_transaction_session_timeout')='10s' AS idle_tx_timeout_locked,
 pg_backend_pid() AS backend_pid,
 EXISTS(SELECT 1 FROM pg_stat_ssl s WHERE s.pid=pg_backend_pid() AND s.ssl) AS tls_verified,
 r.rolcanlogin AND NOT(r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolbypassrls
  OR r.rolreplication OR r.rolinherit) AND r.rolconnlimit=1 AS bounded_role,
 NOT EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid) AS no_memberships,
 (SELECT count(*)=1 AND bool_and(member_role.rolname='postgres'
   AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option
   AND pg_get_userbyid(m.grantor)='supabase_admin')
  FROM pg_auth_members m JOIN pg_roles member_role ON member_role.oid=m.member
  WHERE m.roleid=r.oid) AS exact_management_member,
 NOT pg_has_role(current_user,'pg_read_all_data','USAGE') AS no_global_read,
 NOT pg_has_role(current_user,'pg_write_all_data','USAGE') AS no_global_write,
 NOT has_database_privilege(current_user,current_database(),'CREATE') AS no_database_create,
 NOT EXISTS(SELECT 1 FROM pg_namespace n
   WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
     AND has_schema_privilege(current_user,n.oid,'CREATE')) AS no_schema_create,
 NOT EXISTS(SELECT 1 FROM pg_shdepend s
   WHERE s.refclassid='pg_authid'::regclass AND s.refobjid=r.oid AND s.deptype='o')
   AS no_owned_objects,
 NOT (
  pg_has_role(current_user,'pg_read_server_files','USAGE') OR
  pg_has_role(current_user,'pg_write_server_files','USAGE') OR
  pg_has_role(current_user,'pg_execute_server_program','USAGE') OR
  pg_has_role(current_user,'pg_signal_backend','USAGE') OR
  pg_has_role(current_user,'pg_monitor','USAGE') OR
  pg_has_role(current_user,'pg_checkpoint','USAGE')
 ) AS no_special_admin_roles,
 NOT EXISTS(
  SELECT 1 FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE c.relkind='S'
    AND n.nspname IN ('public','gpt02_stage','gpt02_private','ai_platform')
    AND (
      has_sequence_privilege(current_user,c.oid,'USAGE') OR
      has_sequence_privilege(current_user,c.oid,'SELECT') OR
      has_sequence_privilege(current_user,c.oid,'UPDATE')
    )
 ) AS no_sequence_privileges,
 NOT EXISTS(SELECT 1 FROM pg_foreign_server s
   WHERE has_server_privilege(current_user,s.oid,'USAGE')) AS no_foreign_server_usage,
 NOT EXISTS(
  SELECT 1 FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE c.relkind='f'
    AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
    AND has_schema_privilege(current_user,n.oid,'USAGE')
    AND has_table_privilege(current_user,c.oid,'SELECT')
 ) AS no_foreign_table_select,
 NOT EXISTS(
  SELECT 1 FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE c.relkind IN ('v','m')
    AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
    AND has_schema_privilege(current_user,n.oid,'USAGE')
    AND has_table_privilege(current_user,c.oid,'SELECT')
 ) AS no_view_select,
 NOT EXISTS(
  SELECT 1 FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname IN ('public','gpt02_stage','gpt02_private','ai_platform')
    AND p.prokind IN ('f','p')
    AND pg_get_function_result(p.oid)<>'trigger'
    AND p.prosecdef
    AND has_function_privilege(current_user,p.oid,'EXECUTE')
 ) AS no_callable_security_definer_routines,
 (SELECT count(*)=1 AND bool_and(n.nspname='public'
    AND p.proname='assert_portal_profile_complete'
    AND pg_get_function_identity_arguments(p.oid)='p_customer_id integer'
    AND p.prosecdef=false AND pg_get_userbyid(p.proowner)='postgres'
    AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=
      '046a0d067d2b632d0e17af5c6f433bea63794d90c67c55a6475e6fe6b34916c8')
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname IN ('public','gpt02_stage','gpt02_private','ai_platform')
    AND p.prokind IN ('f','p')
    AND pg_get_function_result(p.oid)<>'trigger'
    AND has_function_privilege(current_user,p.oid,'EXECUTE')
 ) AS exact_callable_routines,
 NOT EXISTS(
  SELECT 1 FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname IN ('public','gpt02_stage','gpt02_private','ai_platform')
    AND p.prokind IN ('f','p')
    AND pg_get_function_result(p.oid)<>'trigger'
    AND has_function_privilege(current_user,p.oid,'EXECUTE')
    AND pg_get_functiondef(p.oid) ~* '\\m(INSERT|UPDATE|DELETE|TRUNCATE|MERGE|CALL|ALTER|GRANT|REVOKE)\\M'
 ) AS no_callable_mutating_routines
 FROM pg_roles r WHERE r.rolname=current_user`;

const BASE=Object.freeze({
 environment:'CST-DEV',mode:'AUTHENTICATED_TWO_READER_READONLY_EVIDENCE',
 hubAuthenticated:false,coreAuthenticated:false,twoSessionsVerified:false,
 permissionsVerified:false,dispatchPermitted:false,issuerLeaseGranted:false,
 taskCreated:false,commandCreated:false,releaseDecision:'NO_GO'
});
const report=(reason,extra={})=>Object.freeze({...BASE,...extra,reason,
 dispatchPermitted:false,issuerLeaseGranted:false,taskCreated:false,
 commandCreated:false,releaseDecision:'NO_GO'});

function ok(row,role){
 return row?.db==='postgres'&&row.login===role&&row.session===role&&
  row.in_readonly_tx===true&&row.default_readonly===true&&row.search_path_locked===true&&
  row.statement_timeout_locked===true&&row.lock_timeout_locked===true&&
  row.idle_tx_timeout_locked===true&&Number.isInteger(row.backend_pid)&&row.backend_pid>0&&
  row.tls_verified===true&&row.bounded_role===true&&row.no_memberships===true&&
  row.exact_management_member===true&&row.no_global_read===true&&
  row.no_global_write===true&&row.no_database_create===true&&row.no_schema_create===true&&
  row.no_owned_objects===true&&
  row.no_special_admin_roles===true&&row.no_sequence_privileges===true&&
  row.no_foreign_server_usage===true&&row.no_foreign_table_select===true&&
  row.no_view_select===true&&row.no_callable_security_definer_routines===true&&row.exact_callable_routines===true&&
  row.no_callable_mutating_routines===true;
}
function resolvePool(){
 const apiRequire=createRequire(new URL('../../artifacts/api-server/package.json',import.meta.url));
 return apiRequire('pg').Pool;
}
async function inspect(pool){
 let client,tx=false;
 try{
  client=await pool.connect();
  await client.query('BEGIN READ ONLY');tx=true;
  await client.query("SET LOCAL statement_timeout='5s'");
  const r=await client.query(IDENTITY_QUERY);
  await client.query('ROLLBACK');tx=false;
  if(!r||!Array.isArray(r.rows)||r.rows.length!==1)throw Error('bad rows');
  return {row:r.rows[0],client};
 }catch(e){
  if(client&&tx)try{await client.query('ROLLBACK')}catch{}
  if(client)try{client.release(true)}catch{}
  throw e;
 }
}
export async function probe(env=process.env,deps={}){
 let pools;
 try{
  pools=createGpt02ReaderPools({
   env,Pool:deps.Pool||resolvePool(),nodeEnv:env.NODE_ENV,appEnv:env.APP_ENV
  });
 }catch{return report('NO_VERIFIED_TWO_READER_CREDENTIALS_OR_CST_DEV_TLS');}
 let h,c;
 try{
  h=await inspect(pools.hubPool);
  c=await inspect(pools.corePool);
  const separate=Number.isInteger(h.row?.backend_pid)&&Number.isInteger(c.row?.backend_pid)&&
   h.row.backend_pid!==c.row.backend_pid;
  if(!separate)return report('SEPARATE_NATIVE_BACKENDS_REQUIRED');
  const hubGood=ok(h.row,HUB),coreGood=ok(c.row,CORE);
  return report(hubGood&&coreGood?'TWO_NATIVE_READERS_PASS_NO_AUTHORITY':
   'NATIVE_READER_PRIVILEGE_MISMATCH',{
    hubAuthenticated:hubGood,coreAuthenticated:coreGood,
    twoSessionsVerified:separate,
    permissionsVerified:hubGood&&coreGood
  });
 }catch{return report('NATIVE_READER_LOGIN_OR_CATALOG_PROBE_FAILED');}
 finally{
  if(h?.client)try{h.client.release(true)}catch{}
  if(c?.client)try{c.client.release(true)}catch{}
  for(const p of [pools?.hubPool,pools?.corePool])if(p&&typeof p.end==='function')try{await p.end()}catch{}
 }
}
