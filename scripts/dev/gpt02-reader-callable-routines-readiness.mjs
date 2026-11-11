/**
 * CST-DEV only. Exact callable non-trigger routine inventory for GPT02 readers.
 * Any added callable routine or source change fails closed.
 */
export const EXPECTED_ROUTINE_COUNT=1;
export const EXPECTED_ROUTINE_FINGERPRINT='41044abceb9e079b0940fbcb5d0e16caea327b261feddec274044d06b4f9bbba';
export const EXPECTED_SOURCE_SHA256='046a0d067d2b632d0e17af5c6f433bea63794d90c67c55a6475e6fe6b34916c8';

export const QUERY=`WITH readers(role_name) AS (
 VALUES ('gpt02_hub_evidence_reader'),('gpt02_core_evidence_reader')
), callable AS (
 SELECT rr.role_name,n.nspname,p.proname,
        pg_get_function_identity_arguments(p.oid) args,
        p.prosecdef,pg_get_userbyid(p.proowner) owner,
        encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') source_sha256
 FROM readers rr
 CROSS JOIN pg_namespace n
 JOIN pg_proc p ON p.pronamespace=n.oid
 WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
   AND has_schema_privilege(rr.role_name,n.oid,'USAGE')
   AND p.prokind IN ('f','p')
   AND pg_get_function_result(p.oid)<>'trigger'
   AND has_function_privilege(rr.role_name,p.oid,'EXECUTE')
), per_reader AS (
 SELECT role_name,count(*)::int callable_count,
        encode(sha256(convert_to(string_agg(
          format('%s|%s|%s|%s|%s',nspname,proname,args,prosecdef,owner),
          E'\\n' ORDER BY nspname,proname,args),'UTF8')),'hex') fingerprint,
        bool_and(nspname='public' AND proname='assert_portal_profile_complete'
          AND args='p_customer_id integer' AND prosecdef=false AND owner='postgres'
          AND source_sha256='046a0d067d2b632d0e17af5c6f433bea63794d90c67c55a6475e6fe6b34916c8') exact_expected_routine
 FROM callable GROUP BY role_name
)
SELECT current_database() database_name,
 current_setting('transaction_read_only') transaction_read_only,
 (SELECT count(*)::int FROM per_reader) reader_count,
 coalesce(bool_and(callable_count=1),false) exact_counts,
 coalesce(bool_and(fingerprint='41044abceb9e079b0940fbcb5d0e16caea327b261feddec274044d06b4f9bbba'),false) exact_fingerprints,
 coalesce(bool_and(exact_expected_routine),false) exact_source
FROM per_reader`;

const BASE=Object.freeze({
 environment:'CST-DEV',readOnly:false,readerCount:0,
 exactCallableRoutineInventory:false,
 dispatchPermitted:false,issuerLeaseGranted:false,releaseDecision:'NO_GO'
});
export function assessReaderCallableRoutines(row){
 if(!row||row.database_name!=='postgres'||row.transaction_read_only!=='on')
  return Object.freeze({...BASE,reason:'READER_CALLABLE_ROUTINE_CATALOG_NOT_READONLY'});
 const exact=row.reader_count===2&&row.exact_counts===true&&
  row.exact_fingerprints===true&&row.exact_source===true;
 return Object.freeze({...BASE,readOnly:true,
  readerCount:Number.isSafeInteger(row.reader_count)?row.reader_count:0,
  exactCallableRoutineInventory:exact,
  reason:exact?'EXACT_READER_CALLABLE_ROUTINES_PASS_NO_AUTHORITY':
   'READER_CALLABLE_ROUTINE_DRIFT'});
}
export async function auditReaderCallableRoutines({client}={}){
 if(!client||typeof client.query!=='function')
  return Object.freeze({...BASE,reason:'SCOPED_READONLY_CLIENT_REQUIRED'});
 let tx=false;
 try{
  await client.query('BEGIN READ ONLY');tx=true;
  await client.query("SET LOCAL statement_timeout='5s'");
  const rows=(await client.query(QUERY)).rows;
  await client.query('ROLLBACK');tx=false;
  if(!Array.isArray(rows)||rows.length!==1)
   return Object.freeze({...BASE,reason:'READER_CALLABLE_ROUTINE_CATALOG_CARDINALITY_UNSAFE'});
  return assessReaderCallableRoutines(rows[0]);
 }catch{
  return Object.freeze({...BASE,reason:'READER_CALLABLE_ROUTINE_CATALOG_FAILED_CLOSED'});
 }finally{
  if(tx)try{await client.query('ROLLBACK')}catch{}
 }
}
