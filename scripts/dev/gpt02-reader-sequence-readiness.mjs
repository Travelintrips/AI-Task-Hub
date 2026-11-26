/**
 * CST-DEV only. Sequence privilege inventory for GPT02 evidence readers.
 * Catalog-only, read-only, permanently non-authorizing.
 */
export const QUERY=`WITH readers(role_name) AS (
 VALUES ('gpt02_hub_evidence_reader'),('gpt02_core_evidence_reader')
), seqs AS (
 SELECT rr.role_name,n.nspname AS schema_name,c.relname AS sequence_name,
        has_sequence_privilege(rr.role_name,c.oid,'USAGE') AS can_usage,
        has_sequence_privilege(rr.role_name,c.oid,'SELECT') AS can_select,
        has_sequence_privilege(rr.role_name,c.oid,'UPDATE') AS can_update
 FROM readers rr
 CROSS JOIN pg_class c
 JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind='S'
   AND n.nspname IN ('public','gpt02_stage','gpt02_private','ai_platform')
), leaks AS (
 SELECT * FROM seqs WHERE can_usage OR can_select OR can_update
)
SELECT current_database() AS database_name,
 current_setting('transaction_read_only') AS transaction_read_only,
 (SELECT count(*)::int FROM readers) AS reader_count,
 (SELECT count(*)::int FROM leaks) AS privileged_sequence_count,
 (SELECT coalesce(jsonb_agg(jsonb_build_object(
   'role',role_name,'schema',schema_name,'sequence',sequence_name,
   'usage',can_usage,'select',can_select,'update',can_update)
   ORDER BY role_name,schema_name,sequence_name),'[]'::jsonb) FROM leaks) AS leaks`;

const BASE=Object.freeze({
 environment:'CST-DEV',readOnly:false,readerCount:0,exactNoSequencePrivileges:false,
 privilegedSequenceCount:0,dispatchPermitted:false,issuerLeaseGranted:false,
 releaseDecision:'NO_GO'
});
export function assessReaderSequencePrivileges(row){
 if(!row||row.database_name!=='postgres'||row.transaction_read_only!=='on')
  return Object.freeze({...BASE,reason:'READER_SEQUENCE_CATALOG_NOT_READONLY'});
 const leaksValid=Array.isArray(row.leaks);
 const exact=leaksValid&&row.reader_count===2&&row.privileged_sequence_count===0&&
  row.leaks.length===0;
 return Object.freeze({...BASE,readOnly:true,readerCount:Number.isSafeInteger(row.reader_count)?row.reader_count:0,
  exactNoSequencePrivileges:exact,
  privilegedSequenceCount:Number.isSafeInteger(row.privileged_sequence_count)?row.privileged_sequence_count:0,
  reason:exact?'NO_READER_SEQUENCE_PRIVILEGES_PASS_NO_AUTHORITY':'READER_SEQUENCE_PRIVILEGE_DRIFT'});
}
export async function auditReaderSequencePrivileges({client}={}){
 if(!client||typeof client.query!=='function')
  return Object.freeze({...BASE,reason:'SCOPED_READONLY_CLIENT_REQUIRED'});
 let tx=false;
 try{
  await client.query('BEGIN READ ONLY');tx=true;
  await client.query("SET LOCAL statement_timeout='5s'");
  const rows=(await client.query(QUERY)).rows;
  await client.query('ROLLBACK');tx=false;
  if(!Array.isArray(rows)||rows.length!==1)
   return Object.freeze({...BASE,reason:'READER_SEQUENCE_CATALOG_CARDINALITY_UNSAFE'});
  return assessReaderSequencePrivileges(rows[0]);
 }catch{
  return Object.freeze({...BASE,reason:'READER_SEQUENCE_CATALOG_FAILED_CLOSED'});
 }finally{
  if(tx)try{await client.query('ROLLBACK')}catch{}
 }
}
