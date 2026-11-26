/**
 * CST-DEV only. Exact schema-USAGE inventory for GPT02 evidence readers.
 * Catalog-only, read-only, permanently non-authorizing.
 */
export const EXPECTED_SCHEMA_USAGE=Object.freeze([
 ['gpt02_core_evidence_reader','ai_platform'],
 ['gpt02_core_evidence_reader','public'],
 ['gpt02_hub_evidence_reader','gpt02_private'],
 ['gpt02_hub_evidence_reader','gpt02_stage'],
 ['gpt02_hub_evidence_reader','public']
]);

export const QUERY=`WITH expected(role_name,schema_name) AS (
 VALUES
 ('gpt02_core_evidence_reader','ai_platform'),
 ('gpt02_core_evidence_reader','public'),
 ('gpt02_hub_evidence_reader','gpt02_private'),
 ('gpt02_hub_evidence_reader','gpt02_stage'),
 ('gpt02_hub_evidence_reader','public')
), actual AS (
 SELECT r.rolname AS role_name,n.nspname AS schema_name
 FROM pg_roles r CROSS JOIN pg_namespace n
 WHERE r.rolname IN ('gpt02_hub_evidence_reader','gpt02_core_evidence_reader')
   AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
   AND has_schema_privilege(r.rolname,n.oid,'USAGE')
), diff AS (
 SELECT 'UNEXPECTED'::text issue,a.* FROM actual a
 LEFT JOIN expected e USING(role_name,schema_name) WHERE e.schema_name IS NULL
 UNION ALL
 SELECT 'MISSING'::text issue,e.* FROM expected e
 LEFT JOIN actual a USING(role_name,schema_name) WHERE a.schema_name IS NULL
)
SELECT current_database() database_name,
 current_setting('transaction_read_only') transaction_read_only,
 (SELECT count(*)::int FROM expected) expected_schema_usage,
 (SELECT count(*)::int FROM actual) actual_schema_usage,
 (SELECT count(*)::int FROM diff) difference_count,
 (SELECT coalesce(jsonb_agg(jsonb_build_object(
   'issue',issue,'role',role_name,'schema',schema_name)
   ORDER BY issue,role_name,schema_name),'[]'::jsonb) FROM diff) differences`;

const BASE=Object.freeze({
 environment:'CST-DEV',readOnly:false,exactSchemaUsage:false,
 expectedSchemaUsage:EXPECTED_SCHEMA_USAGE.length,actualSchemaUsage:0,
 dispatchPermitted:false,issuerLeaseGranted:false,releaseDecision:'NO_GO'
});
export function assessReaderSchemaUsage(row){
 if(!row||row.database_name!=='postgres'||row.transaction_read_only!=='on')
  return Object.freeze({...BASE,reason:'READER_SCHEMA_USAGE_CATALOG_NOT_READONLY'});
 const differencesValid=Array.isArray(row.differences);
 const exact=differencesValid&&
  row.expected_schema_usage===EXPECTED_SCHEMA_USAGE.length&&
  row.actual_schema_usage===EXPECTED_SCHEMA_USAGE.length&&
  row.difference_count===0&&row.differences.length===0;
 return Object.freeze({...BASE,readOnly:true,exactSchemaUsage:exact,
  actualSchemaUsage:Number.isSafeInteger(row.actual_schema_usage)?row.actual_schema_usage:0,
  reason:exact?'EXACT_READER_SCHEMA_USAGE_PASS_NO_AUTHORITY':'READER_SCHEMA_USAGE_DRIFT'});
}
export async function auditReaderSchemaUsage({client}={}){
 if(!client||typeof client.query!=='function')
  return Object.freeze({...BASE,reason:'SCOPED_READONLY_CLIENT_REQUIRED'});
 let tx=false;
 try{
  await client.query('BEGIN READ ONLY');tx=true;
  await client.query("SET LOCAL statement_timeout='5s'");
  const rows=(await client.query(QUERY)).rows;
  await client.query('ROLLBACK');tx=false;
  if(!Array.isArray(rows)||rows.length!==1)
   return Object.freeze({...BASE,reason:'READER_SCHEMA_USAGE_CATALOG_CARDINALITY_UNSAFE'});
  return assessReaderSchemaUsage(rows[0]);
 }catch{
  return Object.freeze({...BASE,reason:'READER_SCHEMA_USAGE_CATALOG_FAILED_CLOSED'});
 }finally{
  if(tx)try{await client.query('ROLLBACK')}catch{}
 }
}
