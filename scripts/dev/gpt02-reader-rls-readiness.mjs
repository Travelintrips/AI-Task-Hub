/**
 * CST-DEV only. Exact effective RLS policy fingerprint for GPT02 evidence readers.
 * Includes reader-specific and PUBLIC policies that would actually apply.
 * Catalog-only, read-only, permanently non-authorizing.
 */
export const EXPECTED_POLICY_COUNT=12;
export const EXPECTED_POLICY_FINGERPRINT='77029cdaf9f9079cce23260e703090bc904c515c91bb9708309fd2e84af99338';

export const QUERY=`WITH targets(role_name,schema_name,table_name) AS (
 VALUES
 ('gpt02_hub_evidence_reader','gpt02_stage','core_preparations'),
 ('gpt02_hub_evidence_reader','gpt02_private','operator_links'),
 ('gpt02_hub_evidence_reader','gpt02_private','approvals'),
 ('gpt02_hub_evidence_reader','public','ai_tasks'),
 ('gpt02_hub_evidence_reader','public','team_members'),
 ('gpt02_hub_evidence_reader','public','users'),
 ('gpt02_hub_evidence_reader','public','audit_logs'),
 ('gpt02_hub_evidence_reader','public','ai_execution_jobs'),
 ('gpt02_core_evidence_reader','ai_platform','ai_coding_tasks'),
 ('gpt02_core_evidence_reader','ai_platform','internal_users'),
 ('gpt02_core_evidence_reader','ai_platform','ai_coding_runs'),
 ('gpt02_core_evidence_reader','ai_platform','ai_coding_bridge_commands')
), effective AS (
 SELECT t.role_name,t.schema_name,t.table_name,p.polname,p.polcmd,p.polpermissive,
        array_to_string(array(
          SELECT coalesce(r.rolname,'PUBLIC')
          FROM unnest(p.polroles) x(oid)
          LEFT JOIN pg_roles r ON r.oid=x.oid
          ORDER BY coalesce(r.rolname,'PUBLIC')
        ),',') policy_roles,
        coalesce(pg_get_expr(p.polqual,p.polrelid),'<NULL>') using_expr,
        coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'<NULL>') check_expr,
        c.relrowsecurity,c.relforcerowsecurity
 FROM targets t
 JOIN pg_namespace n ON n.nspname=t.schema_name
 JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=t.table_name
 JOIN pg_policy p ON p.polrelid=c.oid
 JOIN pg_roles rr ON rr.rolname=t.role_name
 WHERE p.polroles @> array[0::oid] OR p.polroles @> array[rr.oid]
), canon AS (
 SELECT format('%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s',
   role_name,schema_name,table_name,polname,polcmd,polpermissive,
   policy_roles,using_expr,check_expr,relrowsecurity,relforcerowsecurity) line
 FROM effective
)
SELECT current_database() AS database_name,
 current_setting('transaction_read_only') AS transaction_read_only,
 (SELECT count(*)::int FROM effective) AS policy_count,
 encode(extensions.digest(convert_to(
   (SELECT string_agg(line,E'\\n' ORDER BY line) FROM canon),'UTF8'),'sha256'),'hex') AS policy_fingerprint,
 (SELECT count(*)::int FROM effective WHERE policy_roles='PUBLIC') AS public_policy_count,
 (SELECT bool_and(relrowsecurity) FROM effective) AS all_rls_enabled`;

const BASE=Object.freeze({
 environment:'CST-DEV',readOnly:false,exactReaderRls:false,
 policyCount:0,publicPolicyCount:0,allRlsEnabled:false,
 dispatchPermitted:false,issuerLeaseGranted:false,releaseDecision:'NO_GO'
});
export function assessReaderRls(row){
 if(!row||row.database_name!=='postgres'||row.transaction_read_only!=='on')
  return Object.freeze({...BASE,reason:'READER_RLS_CATALOG_NOT_READONLY'});
 const exact=row.policy_count===EXPECTED_POLICY_COUNT&&
  row.policy_fingerprint===EXPECTED_POLICY_FINGERPRINT&&
  row.public_policy_count===0&&row.all_rls_enabled===true;
 return Object.freeze({...BASE,readOnly:true,exactReaderRls:exact,
  policyCount:Number.isSafeInteger(row.policy_count)?row.policy_count:0,
  publicPolicyCount:Number.isSafeInteger(row.public_policy_count)?row.public_policy_count:0,
  allRlsEnabled:row.all_rls_enabled===true,
  reason:exact?'EXACT_READER_RLS_PASS_NO_AUTHORITY':'READER_RLS_POLICY_DRIFT'});
}
export async function auditReaderRls({client}={}){
 if(!client||typeof client.query!=='function')
  return Object.freeze({...BASE,reason:'SCOPED_READONLY_CLIENT_REQUIRED'});
 let tx=false;
 try{
  await client.query('BEGIN READ ONLY');tx=true;
  await client.query("SET LOCAL statement_timeout='5s'");
  const rows=(await client.query(QUERY)).rows;
  await client.query('ROLLBACK');tx=false;
  if(!Array.isArray(rows)||rows.length!==1)
   return Object.freeze({...BASE,reason:'READER_RLS_CATALOG_CARDINALITY_UNSAFE'});
  return assessReaderRls(rows[0]);
 }catch{
  return Object.freeze({...BASE,reason:'READER_RLS_CATALOG_FAILED_CLOSED'});
 }finally{
  if(tx)try{await client.query('ROLLBACK')}catch{}
 }
}
