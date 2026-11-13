/**
 * CST-DEV only. Exact inert role settings for GPT02 evidence readers.
 * Catalog-only, non-mutating, permanently non-authorizing.
 */
export const EXPECTED_CONFIG=Object.freeze([
 'default_transaction_read_only=on',
 'idle_in_transaction_session_timeout=10s',
 'lock_timeout=1s',
 'search_path=pg_catalog',
 'statement_timeout=5s'
]);

export const QUERY=`WITH readers AS (
 SELECT r.oid,r.rolname,r.rolcanlogin,r.rolconnlimit,r.rolinherit,r.rolsuper,
        r.rolcreaterole,r.rolcreatedb,r.rolreplication,r.rolbypassrls,
        coalesce(s.setconfig,'{}'::text[]) AS setconfig
 FROM pg_roles r
 LEFT JOIN pg_db_role_setting s ON s.setrole=r.oid AND s.setdatabase=0
 WHERE r.rolname IN ('gpt02_hub_evidence_reader','gpt02_core_evidence_reader')
)
SELECT current_database() database_name,
 current_setting('transaction_read_only') transaction_read_only,
 count(*)::int reader_count,
 bool_and(NOT rolcanlogin AND rolconnlimit=0 AND NOT rolinherit AND NOT rolsuper
  AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls) locked_roles,
 bool_and(NOT EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=readers.oid)) no_memberships,
 bool_and((SELECT count(*)=1 AND bool_and(member_role.rolname='postgres'
   AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option
   AND pg_get_userbyid(m.grantor)='supabase_admin')
  FROM pg_auth_members m JOIN pg_roles member_role ON member_role.oid=m.member
  WHERE m.roleid=readers.oid)) exact_management_membership,
 bool_and(NOT EXISTS(SELECT 1 FROM pg_stat_activity a WHERE a.usename=readers.rolname)) no_active_sessions,
 bool_and(NOT EXISTS(SELECT 1 FROM pg_shdepend s
   WHERE s.refclassid='pg_authid'::regclass AND s.refobjid=readers.oid AND s.deptype='o')) no_owned_objects,
 bool_and(NOT (
   pg_has_role(readers.rolname,'pg_read_server_files','USAGE') OR
   pg_has_role(readers.rolname,'pg_write_server_files','USAGE') OR
   pg_has_role(readers.rolname,'pg_execute_server_program','USAGE') OR
   pg_has_role(readers.rolname,'pg_signal_backend','USAGE') OR
   pg_has_role(readers.rolname,'pg_monitor','USAGE') OR
   pg_has_role(readers.rolname,'pg_checkpoint','USAGE')
 )) no_special_admin_roles,
 bool_and((SELECT array_agg(x ORDER BY x) FROM unnest(setconfig) x)=
  ARRAY['default_transaction_read_only=on','idle_in_transaction_session_timeout=10s',
        'lock_timeout=1s','search_path=pg_catalog','statement_timeout=5s']::text[]) exact_role_config
FROM readers`;

const BASE=Object.freeze({
 environment:'CST-DEV',readOnly:false,readerCount:0,lockedRoles:false,
 noMemberships:false,exactManagementMembership:false,noActiveSessions:false,
 noOwnedObjects:false,noSpecialAdminRoles:false,exactRoleConfig:false,
 dispatchPermitted:false,issuerLeaseGranted:false,releaseDecision:'NO_GO'
});
export function assessReaderRoleSettings(row){
 if(!row||row.database_name!=='postgres'||row.transaction_read_only!=='on')
  return Object.freeze({...BASE,reason:'READER_ROLE_SETTINGS_CATALOG_NOT_READONLY'});
 const good=row.reader_count===2&&row.locked_roles===true&&row.no_memberships===true&&
  row.exact_management_membership===true&&row.no_active_sessions===true&&
  row.no_owned_objects===true&&row.no_special_admin_roles===true&&
  row.exact_role_config===true;
 return Object.freeze({...BASE,readOnly:true,readerCount:row.reader_count,
  lockedRoles:row.locked_roles===true,noMemberships:row.no_memberships===true,
  exactManagementMembership:row.exact_management_membership===true,
  noActiveSessions:row.no_active_sessions===true,noOwnedObjects:row.no_owned_objects===true,
  noSpecialAdminRoles:row.no_special_admin_roles===true,
  exactRoleConfig:row.exact_role_config===true,
  reason:good?'EXACT_INERT_READER_ROLE_SETTINGS_PASS_NO_AUTHORITY':'READER_ROLE_SETTINGS_DRIFT'});
}
export async function auditReaderRoleSettings({client}={}){
 if(!client||typeof client.query!=='function')
  return Object.freeze({...BASE,reason:'SCOPED_READONLY_CLIENT_REQUIRED'});
 let tx=false;
 try{
  await client.query('BEGIN READ ONLY');tx=true;
  await client.query("SET LOCAL statement_timeout='5s'");
  const rows=(await client.query(QUERY)).rows;
  await client.query('ROLLBACK');tx=false;
  if(!Array.isArray(rows)||rows.length!==1)
   return Object.freeze({...BASE,reason:'READER_ROLE_SETTINGS_CATALOG_CARDINALITY_UNSAFE'});
  return assessReaderRoleSettings(rows[0]);
 }catch{
  return Object.freeze({...BASE,reason:'READER_ROLE_SETTINGS_CATALOG_FAILED_CLOSED'});
 }finally{
  if(tx)try{await client.query('ROLLBACK')}catch{}
 }
}
