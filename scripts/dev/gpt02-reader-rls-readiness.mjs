/**
 * CST-DEV only. Exact RLS policy fingerprint for GPT02 evidence readers.
 * Catalog-only, non-mutating, permanently non-authorizing.
 */
export const EXPECTED_POLICY_COUNT=12;
export const EXPECTED_POLICY_FINGERPRINT='4b7bcb04f81580d6db485ef26da1eea9bcf019baf22bcdf80d6b9552a6de39e3';

export const QUERY=`SELECT current_database() AS database_name,
 current_setting('transaction_read_only') AS transaction_read_only,
 count(*)::int AS policy_count,
 encode(sha256(convert_to(string_agg(
   format('%s|%s|%s|%s|%s|%s',
     n.nspname,c.relname,p.polname,p.polcmd,
     array_to_string(array(select rolname from pg_roles where oid=any(p.polroles) order by rolname),','),
     pg_get_expr(p.polqual,p.polrelid)),
   E'\\n' order by n.nspname,c.relname,p.polname),'UTF8')),'hex') AS policy_fingerprint
 FROM pg_policy p
 JOIN pg_class c ON c.oid=p.polrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE p.polname IN ('gpt02_hub_evidence_reader_select','gpt02_core_evidence_reader_select')`;

const BASE=Object.freeze({
 environment:'CST-DEV',readOnly:false,exactReaderRls:false,
 policyCount:0,dispatchPermitted:false,issuerLeaseGranted:false,releaseDecision:'NO_GO'
});
export function assessReaderRls(row){
 if(!row||row.database_name!=='postgres'||row.transaction_read_only!=='on')
  return Object.freeze({...BASE,reason:'READER_RLS_CATALOG_NOT_READONLY'});
 const exact=row.policy_count===EXPECTED_POLICY_COUNT&&
  row.policy_fingerprint===EXPECTED_POLICY_FINGERPRINT;
 return Object.freeze({...BASE,readOnly:true,exactReaderRls:exact,
  policyCount:Number.isSafeInteger(row.policy_count)?row.policy_count:0,
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
