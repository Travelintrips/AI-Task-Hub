/**
 * CST-DEV issuer evidence reader readiness. Catalog-only and read-only.
 * It never reads evidence rows, signs, mutates, grants authority or dispatches.
 */
export const ROLE='gpt02_issuer_evidence_reader';

export const EXPECTED_COLUMNS=Object.freeze([
 ['approvals','command_id'],['approvals','attempt_id'],['approvals','nonce'],['approvals','task_id'],
 ['approvals','company_id'],['approvals','approver_id'],['approvals','claims'],['approvals','digest'],
 ['operator_links','link_id'],['operator_links','command_id'],['operator_links','hub_execution_id'],
 ['operator_links','core_task_id'],['operator_links','hub_task_id'],['operator_links','attempt_id'],
 ['operator_links','company_id'],['operator_links','hub_operator_id'],['operator_links','approval_digest'],
 ['operator_links','link_digest'],['operator_links','claims'],
 ['receipts','id'],['receipts','command_id'],['receipts','nonce'],['receipts','digest'],['receipts','consumed_at'],
 ['core_identity_receipts','receipt_id'],['core_identity_receipts','command_id'],['core_identity_receipts','link_id'],
 ['core_identity_receipts','operator_user_id'],['core_identity_receipts','recorded_by'],['core_identity_receipts','hub_operator_id'],
 ['core_identity_receipts','link_digest'],['core_identity_receipts','binding_verified'],['core_identity_receipts','may_dispatch_worker'],
 ['core_identity_receipts','may_close_job'],['core_identity_receipts','may_issue_grant'],['core_identity_receipts','core_ledger_written'],
 ['core_identity_receipts','created_at'],
 ['post_consumption_fences','fence_id'],['post_consumption_fences','receipt_id'],['post_consumption_fences','command_id'],
 ['post_consumption_fences','link_id'],['post_consumption_fences','hub_execution_id'],['post_consumption_fences','core_task_id'],
 ['post_consumption_fences','attempt_id'],['post_consumption_fences','worker_id'],['post_consumption_fences','lease_epoch'],
 ['post_consumption_fences','lease_started_at'],['post_consumption_fences','lease_expires_at'],
 ['post_consumption_fences','dispatch_allowed'],['post_consumption_fences','core_ledger_written'],
 ['post_consumption_fences','created_at']
]);

const expectedValues=EXPECTED_COLUMNS.map(([t,c])=>"('"+t+"','"+c+"')").join(',');

export const QUERY=
 "WITH expected(table_name,column_name) AS (VALUES "+expectedValues+"),"+
 " actual AS ("+
 " SELECT c.relname::text table_name,a.attname::text column_name"+
 " FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace"+
 " JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped"+
 " WHERE n.nspname='gpt02_private'"+
 " AND c.relname IN ('approvals','operator_links','receipts','core_identity_receipts','post_consumption_fences')"+
 " AND has_column_privilege('"+ROLE+"',c.oid,a.attnum,'SELECT')"+
 " ), column_diff AS ("+
 " (SELECT * FROM expected EXCEPT SELECT * FROM actual) UNION ALL"+
 " (SELECT * FROM actual EXCEPT SELECT * FROM expected)"+
 " ), policies AS ("+
 " SELECT p.tablename,p.policyname,p.permissive,p.cmd,p.qual,p.with_check,p.roles,"+
 " c.relrowsecurity,c.relforcerowsecurity"+
 " FROM pg_policies p JOIN pg_namespace n ON n.nspname=p.schemaname"+
 " JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=p.tablename"+
 " WHERE p.schemaname='gpt02_private'"+
 " AND p.tablename IN ('approvals','operator_links','receipts','core_identity_receipts','post_consumption_fences')"+
 " AND ('"+ROLE+"'=ANY(p.roles) OR 'public'=ANY(p.roles))"+
 " ), routines AS ("+
 " SELECT n.nspname,p.proname,p.prosecdef,pg_get_functiondef(p.oid) def"+
 " FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace"+
 " WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'"+
 " AND has_schema_privilege('"+ROLE+"',n.oid,'USAGE')"+
 " AND p.prokind IN ('f','p') AND pg_get_function_result(p.oid)<>'trigger'"+
 " AND has_function_privilege('"+ROLE+"',p.oid,'EXECUTE')"+
 " )"+
 " SELECT current_database() db,r.rolcanlogin,r.rolconnlimit,r.rolsuper,r.rolcreaterole,"+
 " r.rolcreatedb,r.rolinherit,r.rolreplication,r.rolbypassrls,r.rolconfig,"+
 " (SELECT count(*)::int FROM pg_auth_members m WHERE m.member=r.oid) memberships,"+
 " (SELECT count(*)::int FROM pg_auth_members m WHERE m.roleid=r.oid) members_of_role,"+
 " (SELECT count(*)=1 AND bool_and(member.rolname='postgres' AND grantor.rolname='supabase_admin'"+
 "   AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option)"+
 "  FROM pg_auth_members m JOIN pg_roles member ON member.oid=m.member"+
 "  JOIN pg_roles grantor ON grantor.oid=m.grantor WHERE m.roleid=r.oid) exact_management_member,"+
 " (SELECT count(*)::int FROM pg_stat_activity a WHERE a.usename=r.rolname) active_sessions,"+
 " pg_has_role(r.rolname,'pg_read_all_data','USAGE') global_read,"+
 " pg_has_role(r.rolname,'pg_write_all_data','USAGE') global_write,"+
 " has_database_privilege(r.rolname,current_database(),'CREATE') db_create,"+
 " has_schema_privilege(r.rolname,'gpt02_private','USAGE') private_usage,"+
 " has_schema_privilege(r.rolname,'gpt02_private','CREATE') private_create,"+
 " (SELECT count(*)::int FROM pg_shdepend s WHERE s.refclassid='pg_authid'::regclass"+
 " AND s.refobjid=r.oid AND s.deptype='o') owned_objects,"+
 " (pg_has_role(r.rolname,'pg_read_server_files','USAGE') OR"+
 " pg_has_role(r.rolname,'pg_write_server_files','USAGE') OR"+
 " pg_has_role(r.rolname,'pg_execute_server_program','USAGE') OR"+
 " pg_has_role(r.rolname,'pg_signal_backend','USAGE') OR"+
 " pg_has_role(r.rolname,'pg_monitor','USAGE') OR pg_has_role(r.rolname,'pg_checkpoint','USAGE')) special_admin,"+
 " (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace"+
 " WHERE c.relkind='S' AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND ("+
 " has_sequence_privilege(r.rolname,c.oid,'USAGE') OR has_sequence_privilege(r.rolname,c.oid,'SELECT') OR"+
 " has_sequence_privilege(r.rolname,c.oid,'UPDATE'))) sequence_privileges,"+
 " (SELECT count(*)::int FROM column_diff) column_diff_count,"+
 " (SELECT count(*)::int FROM actual) select_column_count,"+
 " (SELECT count(*)::int FROM information_schema.table_privileges tp WHERE tp.grantee=r.rolname"+
 " AND tp.table_schema='gpt02_private' AND tp.table_name IN"+
 " ('approvals','operator_links','receipts','core_identity_receipts','post_consumption_fences')) table_level_grants,"+
 " (SELECT count(*)::int FROM policies) policy_count,"+
 " (SELECT count(*)::int FROM policies WHERE policyname='issuer_evidence_reader_select'"+
 " AND permissive='PERMISSIVE' AND cmd='SELECT' AND with_check IS NULL"+
 " AND roles=ARRAY['"+ROLE+"']::name[] AND relrowsecurity AND relforcerowsecurity"+
 " AND ((tablename IN ('receipts','core_identity_receipts','post_consumption_fences') AND qual='true')"+
 " OR (tablename='approvals' AND qual='((company_id = ''default''::text) AND (task_id > 136) AND ((claims ->> ''environment''::text) = ''DEV''::text))')"+
 " OR (tablename='operator_links' AND qual='((company_id = ''default''::text) AND (hub_task_id > 136) AND (attempt_number = 1) AND ((claims ->> ''environment''::text) = ''DEV''::text))'))) exact_policy_count,"+
 " (SELECT count(*)::int FROM policies WHERE 'public'=ANY(roles)) public_policy_count,"+
 " (SELECT count(*)::int FROM routines WHERE prosecdef) callable_security_definer,"+
 " (SELECT count(*)::int FROM routines WHERE def ~* '\\m(INSERT|UPDATE|DELETE|TRUNCATE|MERGE|CALL|ALTER|GRANT|REVOKE)\\M') callable_mutating,"+
 " (SELECT count(*)::int FROM routines) callable_count,"+
 " (SELECT count(*)::int FROM routines WHERE nspname='public'"+
 " AND proname='assert_portal_profile_complete' AND NOT prosecdef) allowed_callable_count"+
 " FROM pg_roles r WHERE r.rolname='"+ROLE+"'";

const EXACT_CONFIG=[
 'default_transaction_read_only=on','search_path=pg_catalog','statement_timeout=5s',
 'lock_timeout=1s','idle_in_transaction_session_timeout=10s'
].sort();

export function verifyIssuerReaderReadiness(row){
 if(!row||typeof row!=='object')return false;
 const config=Array.isArray(row.rolconfig)?[...row.rolconfig].sort():[];
 return row.db==='postgres'&&row.rolcanlogin===false&&row.rolconnlimit===0&&
  row.rolsuper===false&&row.rolcreaterole===false&&row.rolcreatedb===false&&
  row.rolinherit===false&&row.rolreplication===false&&row.rolbypassrls===false&&
  JSON.stringify(config)===JSON.stringify(EXACT_CONFIG)&&
  row.memberships===0&&row.members_of_role===1&&row.exact_management_member===true&&
  row.active_sessions===0&&
  row.global_read===false&&row.global_write===false&&row.db_create===false&&
  row.private_usage===true&&row.private_create===false&&row.owned_objects===0&&
  row.special_admin===false&&row.sequence_privileges===0&&
  row.select_column_count===51&&row.column_diff_count===0&&row.table_level_grants===0&&
  row.policy_count===5&&row.exact_policy_count===5&&row.public_policy_count===0&&
  row.callable_security_definer===0&&row.callable_mutating===0&&
  row.callable_count===1&&row.allowed_callable_count===1;
}

export function readinessReport(row){
 const pass=verifyIssuerReaderReadiness(row);
 return Object.freeze({environment:'CST-DEV',role:ROLE,catalogVerified:pass,
  loginEnabled:false,authorizationGranted:false,signingPermitted:false,
  dispatchPermitted:false,releaseDecision:'NO_GO',
  reason:pass?'ISSUER_READER_HOSTED_INERT_PASS':'ISSUER_READER_HOSTED_INERT_MISMATCH'});
}
