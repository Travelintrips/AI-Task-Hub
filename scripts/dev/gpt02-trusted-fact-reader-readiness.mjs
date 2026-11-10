/**
 * CST-DEV only. Hosted PostgreSQL catalog readiness for the future independent
 * Hub/Core fact reader. Non-mutating and permanently non-authorizing.
 *
 * The result is an INVENTORY, not a trusted signer/lease or an authenticated
 * pair of restricted read identities. A shared postgres catalog inspection
 * must never be upgraded into issuer permissions.
 */
export const QUERY = `WITH required_sources(schema_name,relation_name,column_name,type_name) AS (
VALUES
('gpt02_stage','core_preparations','company_id','text'),
('gpt02_stage','core_preparations','hub_task_id','integer'),
('gpt02_stage','core_preparations','member_id','integer'),
('gpt02_stage','core_preparations','member_audit_id','integer'),
('gpt02_stage','core_preparations','operator_subject','text'),
('gpt02_stage','core_preparations','core_task_id','uuid'),
('gpt02_stage','core_preparations','hub_execution_id','uuid'),
('gpt02_stage','core_preparations','command_candidate_id','uuid'),
('gpt02_stage','core_preparations','attempt_id','uuid'),
('public','ai_tasks','assigned_to_id','integer'),
('public','ai_execution_jobs','metadata','jsonb'),
('public','team_members','is_active','boolean'),
('public','users','id','text'),
('public','audit_logs','after_data','jsonb'),
('ai_platform','ai_coding_tasks','id','uuid'),
('ai_platform','ai_coding_runs','task_id','uuid'),
('ai_platform','ai_coding_bridge_commands','task_id','uuid'),
('ai_platform','internal_users','id','integer'),
('ai_platform','internal_users','status','text'),
('ai_platform','internal_users','must_change_password','boolean')
), catalog AS (
 SELECT e.schema_name,e.relation_name,e.column_name,
  (a.attnum>0 AND NOT a.attisdropped
   AND pg_catalog.format_type(a.atttypid,a.atttypmod)=e.type_name) AS good
 FROM required_sources e
 LEFT JOIN pg_catalog.pg_namespace n ON n.nspname=e.schema_name
 LEFT JOIN pg_catalog.pg_class c ON c.relnamespace=n.oid
  AND c.relname=e.relation_name AND c.relkind IN ('r','p')
 LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attname=e.column_name
)
SELECT current_database() AS database_name,
 current_user AS inspected_by,
 current_setting('transaction_read_only') AS transaction_read_only,
 (SELECT COUNT(*)::int FROM catalog) AS required_columns,
 (SELECT COUNT(*)::int FROM catalog WHERE good) AS matching_columns,
 (SELECT coalesce(jsonb_agg(schema_name||'.'||relation_name||'.'||column_name),
     '[]'::jsonb) FROM catalog WHERE NOT good OR good IS NULL) AS missing_columns,
 (SELECT coalesce(jsonb_agg(jsonb_build_object('role',name,
   'exists',EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=name))
   ORDER BY name),'[]'::jsonb)
   FROM (VALUES('gpt02_hub_evidence_reader'),('gpt02_core_evidence_reader')) r(name)
 ) AS reader_roles,
 -- The signed operator link is the existing immutable sidecar.
 -- WorkerId is within signed JSON claims, never a caller-supplied
 -- column of core_preparations or an operational dispatch permission.
 (SELECT coalesce(jsonb_agg(jsonb_build_object('field',r.name,
   'exists',EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='gpt02_private' AND c.relname='operator_links'
      AND a.attname=r.name AND a.attnum>0 AND NOT a.attisdropped
      AND pg_catalog.format_type(a.atttypid,a.atttypmod)=r.type_name))
   ORDER BY r.name),'[]'::jsonb)
   FROM (VALUES('accountable_owner_id','text'),
     ('core_operator_user_id','integer'),('claims','jsonb'),
     ('hub_signature','text'),('core_signature','text'),
     ('link_digest','text')) r(name,type_name)
 ) AS binding_fields,
 (SELECT COUNT(*)::int FROM gpt02_private.operator_links) AS signed_link_rows,
 (SELECT COUNT(*)::int FROM gpt02_stage.core_preparations) AS prepared_rows`;

const BASE=Object.freeze({
 environment:'CST-DEV',sourceSchemaMatching:false,
 hubReaderProvisioned:false,coreReaderProvisioned:false,
 signedSidecarSchemaReady:false,immutableWorkerOwnerBinding:false,
 signedLinkRowsPresent:false,preparedRowsPresent:false,
 independentlyAuthenticatedReads:false,originalSignerProven:false,
 issuerLeaseGranted:false,dispatchPermitted:false,
 taskCreated:false,readOnly:false,releaseDecision:'NO_GO'
});
export function assessTrustedFactReaderReadiness(row){
 const result=Object.assign({},BASE);
 if(!row||row.database_name!=='postgres'||row.transaction_read_only!=='on')
  return Object.freeze({...result,reason:'TRUSTED_CATALOG_READONLY_NOT_PROVEN'});
 result.readOnly=true;
 const columns=Number.isSafeInteger(row.required_columns) && row.required_columns===20 &&
  row.matching_columns===20 && Array.isArray(row.missing_columns) &&
  row.missing_columns.length===0;
 const reader=Array.isArray(row.reader_roles)?row.reader_roles:[];
 const roles=new Map(reader.filter(x=>x&&typeof x.role==='string').map(x=>[x.role,x.exists===true]));
 const bindings=Array.isArray(row.binding_fields)?row.binding_fields:[];
 const expected=['accountable_owner_id','core_operator_user_id','claims',
  'hub_signature','core_signature','link_digest'];
 const required=expected.every(name=>bindings.some(x=>x&&x.field===name&&x.exists===true)) &&
  bindings.length===6;
 result.sourceSchemaMatching=columns;
 result.hubReaderProvisioned=reader.length===2&&roles.get('gpt02_hub_evidence_reader')===true;
 result.coreReaderProvisioned=reader.length===2&&roles.get('gpt02_core_evidence_reader')===true;
 result.signedSidecarSchemaReady=required;
 // A catalogue cannot prove a real signer, immutable worker or owner binding.
 result.immutableWorkerOwnerBinding=false;
 result.signedLinkRowsPresent=Number.isSafeInteger(row.signed_link_rows)&&row.signed_link_rows>0;
 result.preparedRowsPresent=Number.isSafeInteger(row.prepared_rows)&&row.prepared_rows>0;
 const blockers=[];
 if(!columns)blockers.push('HOSTED_SOURCE_SCHEMA_MISMATCH');
 if(!result.hubReaderProvisioned||!result.coreReaderProvisioned)blockers.push('TWO_RESTRICTED_READER_LOGINS_MISSING');
 if(!required)blockers.push('SIGNED_OPERATOR_LINK_SIDECAR_SCHEMA_MISSING');
 if(!result.signedLinkRowsPresent)blockers.push('NO_SIGNED_OPERATOR_LINK_RECORDED');
 if(!result.preparedRowsPresent)blockers.push('NO_NEW_PREPARED_HUB_CORE_PAIR');
 blockers.push('INDEPENDENT_SESSIONS_AND_REAL_SIGNER_NOT_ATTESTED');
 return Object.freeze({...result,reason:'READONLY_CATALOG_INVENTORY_ONLY',
  blockers:Object.freeze(blockers)});
}
export async function auditTrustedFactReaderReadiness({client}={}){
 if(!client||typeof client.query!=='function')
  return Object.freeze({...BASE,reason:'SCOPED_READONLY_CLIENT_REQUIRED'});
 let started=false;
 try{
  await client.query('BEGIN READ ONLY');started=true;
  await client.query("SET LOCAL statement_timeout='5s'");
  const rows=(await client.query(QUERY)).rows;
  await client.query('ROLLBACK');started=false;
  if(!Array.isArray(rows)||rows.length!==1)
   return Object.freeze({...BASE,reason:'CATALOG_CARDINALITY_UNSAFE'});
  return assessTrustedFactReaderReadiness(rows[0]);
 }catch{
  return Object.freeze({...BASE,reason:'CATALOG_QUERY_FAILED_CLOSED'});
 }finally{
  if(started)try{await client.query('ROLLBACK')}catch{}
 }
}
