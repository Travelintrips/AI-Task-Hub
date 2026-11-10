/**
 * CST-DEV only. Exact column-level SELECT grant inventory for the two GPT02
 * evidence readers. Catalog-only, non-mutating, permanently non-authorizing.
 */
export const EXPECTED_COLUMN_GRANTS=86;

export const QUERY=`WITH expected_sets(grantee,schema_name,table_name,cols) AS (
 VALUES
 ('gpt02_hub_evidence_reader','gpt02_stage','core_preparations',array['company_id','hub_task_id','member_id','member_audit_id','operator_subject','core_task_id','hub_execution_id','command_candidate_id','attempt_id','config_sha256','expires_at']),
 ('gpt02_hub_evidence_reader','gpt02_private','operator_links',array['link_id','command_id','hub_execution_id','core_task_id','hub_task_id','attempt_id','company_id','assignee_id','accountable_owner_id','hub_operator_id','core_operator_user_id','approval_digest','link_digest','hub_signature','core_signature','claims']),
 ('gpt02_hub_evidence_reader','gpt02_private','approvals',array['command_id','task_id','company_id','approver_id','claims','signature','digest']),
 ('gpt02_hub_evidence_reader','public','ai_tasks',array['id','company_id','assigned_to_id','assigned_to','status','title']),
 ('gpt02_hub_evidence_reader','public','team_members',array['id','company_id','name','is_active']),
 ('gpt02_hub_evidence_reader','public','users',array['id','role','is_active','status','company_id','email']),
 ('gpt02_hub_evidence_reader','public','audit_logs',array['id','company_id','action','entity_id','after','user_email']),
 ('gpt02_hub_evidence_reader','public','ai_execution_jobs',array['id','company_id','task_id','status','source','external_id','idempotency_key','title','instruction','progress','callback_verified','attestation_verified','final_ack_verified','command_id','worker_id','assigned_client_id','metadata']),
 ('gpt02_core_evidence_reader','ai_platform','ai_coding_tasks',array['id','status','task_number','project_name','repository','branch','instruction']),
 ('gpt02_core_evidence_reader','ai_platform','internal_users',array['id','role','status','must_change_password']),
 ('gpt02_core_evidence_reader','ai_platform','ai_coding_runs',array['task_id']),
 ('gpt02_core_evidence_reader','ai_platform','ai_coding_bridge_commands',array['task_id'])
), expected AS (
 SELECT grantee,schema_name,table_name,unnest(cols)::name AS column_name FROM expected_sets
), actual AS (
 SELECT r.rolname AS grantee,n.nspname AS schema_name,c.relname AS table_name,a.attname AS column_name
 FROM pg_roles r
 CROSS JOIN pg_class c
 JOIN pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
 WHERE r.rolname IN ('gpt02_hub_evidence_reader','gpt02_core_evidence_reader')
   AND n.nspname IN ('public','gpt02_stage','gpt02_private','ai_platform')
   AND c.relkind IN ('r','p','f','v','m')
   AND has_column_privilege(r.rolname,c.oid,a.attnum,'SELECT')
), diff AS (
 SELECT 'UNEXPECTED'::text issue,a.* FROM actual a
 LEFT JOIN expected e USING(grantee,schema_name,table_name,column_name)
 WHERE e.column_name IS NULL
 UNION ALL
 SELECT 'MISSING'::text issue,e.* FROM expected e
 LEFT JOIN actual a USING(grantee,schema_name,table_name,column_name)
 WHERE a.column_name IS NULL
)
SELECT current_database() AS database_name,
 current_setting('transaction_read_only') AS transaction_read_only,
 (SELECT count(*)::int FROM expected) AS expected_column_grants,
 (SELECT count(*)::int FROM actual) AS actual_column_grants,
 (SELECT count(*)::int FROM diff) AS difference_count,
 (SELECT count(*)::int
  FROM pg_roles r CROSS JOIN pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE r.rolname IN ('gpt02_hub_evidence_reader','gpt02_core_evidence_reader')
    AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
    AND c.relkind IN ('r','p','f','v','m')
    AND (
      has_table_privilege(r.rolname,c.oid,'INSERT') OR
      has_table_privilege(r.rolname,c.oid,'UPDATE') OR
      has_table_privilege(r.rolname,c.oid,'DELETE') OR
      has_table_privilege(r.rolname,c.oid,'TRUNCATE') OR
      has_table_privilege(r.rolname,c.oid,'REFERENCES') OR
      has_table_privilege(r.rolname,c.oid,'TRIGGER') OR
      has_table_privilege(r.rolname,c.oid,'MAINTAIN')
    )) AS mutating_relation_privilege_count,
 (SELECT coalesce(jsonb_agg(jsonb_build_object(
   'issue',issue,'role',grantee,'schema',schema_name,'table',table_name,'column',column_name)
   ORDER BY issue,grantee,schema_name,table_name,column_name),'[]'::jsonb) FROM diff) AS differences`;

const BASE=Object.freeze({
 environment:'CST-DEV',readOnly:false,exactColumnGrants:false,
 expectedColumnGrants:EXPECTED_COLUMN_GRANTS,actualColumnGrants:0,
 mutatingRelationPrivilegeCount:0,dispatchPermitted:false,issuerLeaseGranted:false,releaseDecision:'NO_GO'
});
export function assessReaderColumnGrants(row){
 if(!row||row.database_name!=='postgres'||row.transaction_read_only!=='on')
  return Object.freeze({...BASE,reason:'READER_COLUMN_GRANT_CATALOG_NOT_READONLY'});
 const differencesValid=Array.isArray(row.differences);
 const differences=differencesValid?row.differences:[];
 const exact=differencesValid&&
  row.expected_column_grants===EXPECTED_COLUMN_GRANTS&&
  row.actual_column_grants===EXPECTED_COLUMN_GRANTS&&
  row.difference_count===0&&differences.length===0&&
  row.mutating_relation_privilege_count===0;
 return Object.freeze({...BASE,readOnly:true,exactColumnGrants:exact,
  actualColumnGrants:Number.isSafeInteger(row.actual_column_grants)?row.actual_column_grants:0,
  mutatingRelationPrivilegeCount:Number.isSafeInteger(row.mutating_relation_privilege_count)?
   row.mutating_relation_privilege_count:0,
  reason:exact?'EXACT_READER_COLUMN_GRANTS_PASS_NO_AUTHORITY':'READER_COLUMN_GRANTS_DRIFT'});
}
export async function auditReaderColumnGrants({client}={}){
 if(!client||typeof client.query!=='function')
  return Object.freeze({...BASE,reason:'SCOPED_READONLY_CLIENT_REQUIRED'});
 let tx=false;
 try{
  await client.query('BEGIN READ ONLY');tx=true;
  await client.query("SET LOCAL statement_timeout='5s'");
  const rows=(await client.query(QUERY)).rows;
  await client.query('ROLLBACK');tx=false;
  if(!Array.isArray(rows)||rows.length!==1)
   return Object.freeze({...BASE,reason:'READER_COLUMN_GRANT_CATALOG_CARDINALITY_UNSAFE'});
  return assessReaderColumnGrants(rows[0]);
 }catch{
  return Object.freeze({...BASE,reason:'READER_COLUMN_GRANT_CATALOG_FAILED_CLOSED'});
 }finally{
  if(tx)try{await client.query('ROLLBACK')}catch{}
 }
}
