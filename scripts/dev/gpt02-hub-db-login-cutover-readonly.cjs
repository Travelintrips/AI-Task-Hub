"use strict";
/**
 * AI Task Center DEV DB login migration readiness, inspection only.
 * Never copies credentials, creates roles, updates Docker or approves cutover.
 * A partial privilege census is NOT proof of functional E2E parity.
 */
const REQUIRED = Object.freeze([
  {table:"public.ai_tasks",access:["SELECT","INSERT","UPDATE"]},
  {table:"public.ai_execution_jobs",access:["SELECT","INSERT","UPDATE"]},
  {table:"public.team_members",access:["SELECT"]},
  {table:"public.audit_logs",access:["SELECT","INSERT"]},
]);
const FORBIDDEN = Object.freeze([
  "ai_platform.dev_gpt02_task_attempt_binding_claims",
  "ai_platform.dev_gpt02_binding_attestation_nonces",
]);
function summarizeRequiredRls(rows=[]) {
 const expected=new Set(REQUIRED.map(x=>x.table));
 const found=new Map();
 for(const row of rows) if(expected.has(row.resource)&&!found.has(row.resource))
  found.set(row.resource,{resource:row.resource,rlsEnabled:row.rls_enabled===true,
   forceRls:row.force_rls===true,policyCount:Number(row.policy_count)||0});
 const tables=[...expected].map(resource=>found.get(resource)??{resource,rlsEnabled:false,forceRls:false,policyCount:0,missing:true});
 return {requiredTables:expected.size,checkedTables:found.size,
  tablesWithoutPolicy:tables.filter(x=>x.policyCount===0).map(x=>x.resource),
  incomplete:tables.filter(x=>!x.rlsEnabled||x.policyCount===0||x.missing).map(x=>x.resource),
  policySemanticsVerified:false};
}
function evaluate(input={}) {
 const reasons=[];
 const deny=(pass,reason)=>{if(pass!==true)reasons.push(reason)};
 deny(input.devRuntime,"NOT_DEV_RUNTIME");
 deny(input.databaseConnected,"READONLY_DB_CONNECTION_UNAVAILABLE");
 deny(input.roleDistinctFromPostgres,"POSTGRES_APP_LOGIN_STILL_IN_USE");
 deny(input.nonPrivileged,"APP_DB_ROLE_HAS_ADMINISTRATIVE_PRIVILEGES");
 deny(input.noBroadReaderWriter,"APP_DB_ROLE_HAS_GLOBAL_DATA_PRIVILEGES");
 deny(input.noEvidenceMembership,"APP_DB_ROLE_CAN_ASSUME_EVIDENCE_CAPABILITY");
 deny(input.noEvidenceDml,"APP_DB_ROLE_CAN_MUTATE_NATIVE_EVIDENCE");
 deny(input.requiredPrivileges,"REQUIRED_APP_TABLE_PERMISSIONS_MISSING");
 deny(input.rlsChecked,"APP_TENANT_RLS_NOT_VERIFIED");
 if(input.requiredRls?.incomplete?.length)reasons.push("APP_REQUIRED_TABLE_RLS_POLICIES_MISSING");
 deny(input.applicationReadWriteE2E,"APP_AUTHENTICATED_E2E_NOT_VERIFIED");
 reasons.push("CUTOVER_REQUIRES_SEPARATE_APPROVAL_AND_ROLLBACK");
 return {environment:"DEV",readOnly:true,roleName:
  typeof input.roleName==="string"?input.roleName:null,
  tableCoverage:{minimumTables:REQUIRED.length,notExhaustive:true},
  permissionReadback:input.tableReadback??null,
  requiredRlsReadback:input.requiredRls??null,
  reasons,dbLoginCutoverPermitted:false,issuerPermitted:false,
  nativeDispatchPermitted:false,releaseDecision:"NO_GO"};
}
async function main(){
 const dev=process.env.NODE_ENV==="development"&&process.env.APP_ENV!=="production";
 const snapshot={devRuntime:dev,databaseConnected:false,roleDistinctFromPostgres:false,
  nonPrivileged:false,noBroadReaderWriter:false,noEvidenceMembership:false,
  noEvidenceDml:false,requiredPrivileges:false,rlsChecked:false,
  applicationReadWriteE2E:false};
 if(!dev || !process.env.SUPABASE_DATABASE_URL_DEV){
  console.log(JSON.stringify(evaluate(snapshot)));return;
 }
 let pg;
 try{pg=require("pg")}catch{console.log(JSON.stringify(evaluate(snapshot)));return;}
 const client=new pg.Client({connectionString:process.env.SUPABASE_DATABASE_URL_DEV,
  connectionTimeoutMillis:5000,statement_timeout:6000,
  application_name:"hub_dev_login_cutover_readonly"});
 try{
  await client.connect();await client.query("BEGIN READ ONLY");
  const row=(await client.query(`
   SELECT current_user AS login_role,
    (SELECT rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb
       FROM pg_roles WHERE rolname=current_user) AS elevated,
    pg_has_role(current_user,'pg_read_all_data','MEMBER') AS global_reader,
    pg_has_role(current_user,'pg_write_all_data','MEMBER') AS global_writer,
    (CASE WHEN EXISTS(SELECT 1 FROM pg_roles WHERE rolname='dev_gpt02_claim_writer_nologin')
      THEN pg_has_role(current_user,'dev_gpt02_claim_writer_nologin','SET') ELSE false END) AS writer_set,
    (CASE WHEN EXISTS(SELECT 1 FROM pg_roles WHERE rolname='dev_gpt02_evidence_owner')
      THEN pg_has_role(current_user,'dev_gpt02_evidence_owner','SET') ELSE false END) AS owner_set
  `)).rows[0];
  const required=(await client.query(`
   SELECT resource, operation, to_regclass(resource) IS NOT NULL AS exists,
    CASE WHEN to_regclass(resource) IS NOT NULL
      THEN has_table_privilege(current_user,resource,operation) ELSE false END AS allowed
   FROM unnest($1::text[],$2::text[]) AS x(resource,operation)
  `,[REQUIRED.flatMap(x=>x.access.map(()=>x.table)),
     REQUIRED.flatMap(x=>x.access)])).rows;
  const forbidden=(await client.query(`
   SELECT resource,to_regclass(resource) IS NOT NULL AS exists,
    CASE WHEN to_regclass(resource) IS NOT NULL
      THEN has_table_privilege(current_user,resource,'INSERT,UPDATE,DELETE')
      ELSE false END AS mutable
   FROM unnest($1::text[]) AS x(resource)
  `,[FORBIDDEN])).rows;
  const rlsRows=(await client.query(`
   SELECT (n.nspname || '.' || c.relname) AS resource,
    c.relrowsecurity AS rls_enabled,c.relforcerowsecurity AS force_rls,
    count(p.polname)::int AS policy_count
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   LEFT JOIN pg_policy p ON p.polrelid=c.oid
   WHERE (n.nspname || '.' || c.relname) = ANY($1::text[])
     AND c.relkind IN ('r','p')
   GROUP BY n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity
  `,[REQUIRED.map(x=>x.table)])).rows;
  const requiredRls=summarizeRequiredRls(rlsRows);
  await client.query("ROLLBACK");
  Object.assign(snapshot,{databaseConnected:true,roleName:row.login_role,
    roleDistinctFromPostgres:row.login_role!=="postgres",
    nonPrivileged:row.elevated===false,
    noBroadReaderWriter:row.global_reader===false&&row.global_writer===false,
    noEvidenceMembership:row.writer_set===false&&row.owner_set===false,
    noEvidenceDml:forbidden.every(x=>x.exists===true&&x.mutable===false),
    requiredPrivileges:required.every(x=>x.exists===true&&x.allowed===true),
    requiredRls,
    tableReadback:{requiredPairs:required.length,
      allowedPairs:required.filter(x=>x.exists===true&&x.allowed===true).length,
      nativeEvidenceWriteExposed:forbidden.some(x=>x.mutable===true)}
  });
 }catch(e){
  try{await client.query("ROLLBACK")}catch{}
 }finally{await client.end().catch(()=>{})}
 console.log(JSON.stringify(evaluate(snapshot)));
}
module.exports={evaluate,summarizeRequiredRls,REQUIRED,FORBIDDEN,main};
if(require.main===module)main().catch(()=>{console.log(JSON.stringify(evaluate()));process.exitCode=2});
