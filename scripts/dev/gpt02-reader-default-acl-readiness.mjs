/**
 * CST-DEV only. Verify no PostgreSQL default ACL can auto-grant future objects
 * to GPT02 evidence readers, directly or through PUBLIC on accessible schemas.
 * Catalog-only, read-only, non-authorizing.
 */
export const QUERY=`WITH readers AS (
 SELECT oid,rolname FROM pg_roles
 WHERE rolname IN ('gpt02_hub_evidence_reader','gpt02_core_evidence_reader')
), accessible(schema_name) AS (
 VALUES ('public'),('ai_platform'),('gpt02_stage'),('gpt02_private')
), direct_leaks AS (
 SELECT rr.rolname AS reader,pg_get_userbyid(d.defaclrole) AS owner_role,
        coalesce(n.nspname,'<global>') AS schema_name,d.defaclobjtype,
        x.privilege_type,x.is_grantable,'DIRECT'::text AS source
 FROM pg_default_acl d
 CROSS JOIN LATERAL aclexplode(d.defaclacl) x
 JOIN readers rr ON rr.oid=x.grantee
 LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
), public_leaks AS (
 SELECT 'PUBLIC'::text AS reader,pg_get_userbyid(d.defaclrole) AS owner_role,
        coalesce(n.nspname,'<global>') AS schema_name,d.defaclobjtype,
        x.privilege_type,x.is_grantable,'PUBLIC'::text AS source
 FROM pg_default_acl d
 CROSS JOIN LATERAL aclexplode(d.defaclacl) x
 LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
 WHERE x.grantee=0
   AND (d.defaclnamespace=0 OR n.nspname IN (SELECT schema_name FROM accessible))
), leaks AS (
 SELECT * FROM direct_leaks
 UNION ALL
 SELECT * FROM public_leaks
)
SELECT current_database() AS database_name,
 current_setting('transaction_read_only') AS transaction_read_only,
 (SELECT count(*)::int FROM readers) AS reader_count,
 (SELECT count(*)::int FROM leaks) AS default_acl_leak_count,
 (SELECT coalesce(jsonb_agg(to_jsonb(leaks)
   ORDER BY source,reader,owner_role,schema_name,defaclobjtype,privilege_type),'[]'::jsonb) FROM leaks) AS leaks`;

const BASE=Object.freeze({
 environment:'CST-DEV',readOnly:false,readerCount:0,
 exactNoDefaultAclLeaks:false,defaultAclLeakCount:0,
 dispatchPermitted:false,issuerLeaseGranted:false,releaseDecision:'NO_GO'
});
export function assessReaderDefaultAcl(row){
 if(!row||row.database_name!=='postgres'||row.transaction_read_only!=='on')
  return Object.freeze({...BASE,reason:'READER_DEFAULT_ACL_CATALOG_NOT_READONLY'});
 const leaksValid=Array.isArray(row.leaks);
 const exact=leaksValid&&row.reader_count===2&&row.default_acl_leak_count===0&&row.leaks.length===0;
 return Object.freeze({...BASE,readOnly:true,
  readerCount:Number.isSafeInteger(row.reader_count)?row.reader_count:0,
  exactNoDefaultAclLeaks:exact,
  defaultAclLeakCount:Number.isSafeInteger(row.default_acl_leak_count)?row.default_acl_leak_count:0,
  reason:exact?'NO_READER_DEFAULT_ACL_LEAKS_PASS_NO_AUTHORITY':'READER_DEFAULT_ACL_DRIFT'});
}
export async function auditReaderDefaultAcl({client}={}){
 if(!client||typeof client.query!=='function')
  return Object.freeze({...BASE,reason:'SCOPED_READONLY_CLIENT_REQUIRED'});
 let tx=false;
 try{
  await client.query('BEGIN READ ONLY');tx=true;
  await client.query("SET LOCAL statement_timeout='5s'");
  const rows=(await client.query(QUERY)).rows;
  await client.query('ROLLBACK');tx=false;
  if(!Array.isArray(rows)||rows.length!==1)
   return Object.freeze({...BASE,reason:'READER_DEFAULT_ACL_CARDINALITY_UNSAFE'});
  return assessReaderDefaultAcl(rows[0]);
 }catch{
  return Object.freeze({...BASE,reason:'READER_DEFAULT_ACL_FAILED_CLOSED'});
 }finally{
  if(tx)try{await client.query('ROLLBACK')}catch{}
 }
}
