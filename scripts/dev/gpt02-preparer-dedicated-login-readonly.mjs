/**
 * CST-DEV ONLY. Independently authenticated scoped-login attestation.
 *
 * Never creates/activates roles, rotates secrets, calls the dormant/operational
 * preparer, grants EXECUTE, creates tasks, signs approval or dispatches work.
 * No retry: incorrect credentials must not trigger Supavisor IP protection.
 */
import {createRequire} from 'node:module';
import {corePreparationPoolConfig} from '../../artifacts/api-server/src/lib/gpt02-core-task-preparation.mjs';

const ROLE='gpt02_core_prep_login';
const POLICY_HASH='b157e1fbfe1a844309373db42743257f1996895316dc87166d385637c9f8031d';

export const QUERY=`SELECT
 current_database() AS db,
 current_user AS login,
 session_user AS session,
 current_setting('transaction_read_only')='on' AS in_readonly_tx,
 (SELECT r.rolcanlogin AND NOT(r.rolsuper OR r.rolbypassrls OR r.rolcreaterole
   OR r.rolcreatedb OR r.rolreplication OR r.rolinherit)
   AND r.rolconnlimit BETWEEN 1 AND 2
   AND r.rolvaliduntil > clock_timestamp()
   AND r.rolvaliduntil < clock_timestamp()+interval '1 day'
   FROM pg_roles r WHERE r.rolname=current_user) AS bounded_role,
 (SELECT NOT EXISTS (SELECT 1 FROM pg_auth_members m
   JOIN pg_roles r ON r.oid=m.member WHERE r.rolname=current_user)) AS no_memberships,
 NOT has_database_privilege(current_user,current_database(),'CREATE') AS no_database_create,
 has_database_privilege(current_user,current_database(),'TEMP') AS temp_available,
 NOT has_schema_privilege(current_user,'gpt02_stage','USAGE') AS no_stage_usage,
 NOT has_schema_privilege(current_user,'ai_platform','USAGE') AS no_core_schema_usage,
 (SELECT count(*)=1 AND bool_and(
   NOT has_function_privilege(current_user,p.oid,'EXECUTE')
   AND NOT has_function_privilege('postgres',p.oid,'EXECUTE')
   AND p.prosecdef AND pg_get_userbyid(p.proowner)='gpt02_core_prep_owner'
   AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=
     'b18275516add255e76f31414a28732bdd900b556b10f38d42e2e4bdf9f7415d4')
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='gpt02_stage' AND p.proname='prepare_core_task_dormant') AS dormant_unusable,
 (SELECT count(*)=0 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='gpt02_stage' AND p.proname='prepare_core_task') AS no_operational_function,
 (SELECT count(*)=8 AND
   count(*) FILTER (WHERE has_table_privilege(current_user,c.oid,
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))=0
   AND count(*) FILTER (WHERE has_table_privilege('gpt02_core_prep_owner',c.oid,'SELECT'))=8
   AND count(*) FILTER (WHERE has_table_privilege('gpt02_core_prep_owner',c.oid,'INSERT')
      AND c.relname IN ('ai_execution_jobs','ai_coding_tasks'))=2
   AND count(*) FILTER (WHERE has_table_privilege('gpt02_core_prep_owner',c.oid,'INSERT')
      AND c.relname NOT IN ('ai_execution_jobs','ai_coding_tasks'))=0
   AND count(*) FILTER (WHERE has_table_privilege('gpt02_core_prep_owner',c.oid,
       'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))=0
   AND bool_and(c.relrowsecurity AND pg_get_userbyid(c.relowner)='postgres')
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE (n.nspname='public' AND c.relname IN
   ('ai_tasks','team_members','audit_logs','users','ai_execution_jobs'))
   OR (n.nspname='ai_platform' AND c.relname IN
   ('ai_coding_tasks','ai_coding_runs','ai_coding_bridge_commands'))) AS exact_owner_grants_no_direct_dml,
 (SELECT count(*)=10 AND count(*) FILTER
   (WHERE roles='{gpt02_core_prep_owner}'::name[])=10
   AND count(*) FILTER (WHERE cmd='INSERT')=2
   AND encode(sha256(convert_to(string_agg(
    format('%s|%s|%s|%s|%s|%s|%s|%s',
      schemaname,tablename,policyname,permissive,roles::text,cmd,
      coalesce(qual,'<NULL>'),coalesce(with_check,'<NULL>')),
    E'\\n' ORDER BY schemaname,tablename,policyname),'UTF8')),'hex')='${POLICY_HASH}'
  FROM pg_policies WHERE policyname LIKE 'gpt02_preparer_%') AS exact_rls,
 (SELECT count(*)=3 FROM pg_roles WHERE rolname IN
   ('gpt02_core_prep_owner','dev_gpt02_issuer_evidence','dev_gpt02_attestor_evidence')
   AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND rolconnlimit=0) AS dormant_other_roles`;

const BASE=Object.freeze({
 environment:'CST-DEV',mode:'AUTHENTICATED_PREPARER_READONLY_EVIDENCE',
 scopedLoginAuthenticated:false,dbReadOnlyVerified:false,permissionsVerified:false,
 dormantFunctionInvoked:false,taskCreated:false,commandCreated:false,
 signedApprovalGranted:false,issuerLeaseGranted:false,dispatchPermitted:false,
 lifecyclePermitted:false,releaseDecision:'NO_GO'
});
export function report(code,extra={}){
 return Object.freeze({...BASE,...extra,
  reason:code,
  // Caller-provided booleans are never authority; keep all grant outputs false.
  dormantFunctionInvoked:false,taskCreated:false,commandCreated:false,
  signedApprovalGranted:false,issuerLeaseGranted:false,dispatchPermitted:false,
  lifecyclePermitted:false,releaseDecision:'NO_GO'});
}
export function assess(row){
 if(!row||row.db!=='postgres'||row.login!==ROLE||row.session!==ROLE)
  return report('DEDICATED_SESSION_IDENTITY_NOT_VERIFIED');
 const required=['in_readonly_tx','bounded_role','no_memberships','no_database_create',
  'no_stage_usage','no_core_schema_usage','dormant_unusable','no_operational_function',
  'exact_owner_grants_no_direct_dml','exact_rls','dormant_other_roles'];
 const good=required.every(k=>row[k]===true);
 return report(good?'DEDICATED_LOGIN_READONLY_PASS_NO_AUTHORITY':'DEDICATED_LOGIN_PRIVILEGE_MISMATCH',{
  scopedLoginAuthenticated:true,dbReadOnlyVerified:row.in_readonly_tx===true,
  permissionsVerified:good,tempPrivilegeViaDatabasePublic:row.temp_available===true});
}
function resolveClientClass(){
 const apiRequire=createRequire(new URL('../../artifacts/api-server/package.json',import.meta.url));
 return apiRequire('pg').Client;
}
export async function probe(env=process.env,dependencies={}){
 let config;
 try{config=corePreparationPoolConfig(env);}
 catch{return report('NO_VERIFIED_DEDICATED_SECRET_OR_CST_DEV_TLS');}
 let client,tx=false;
 try{
  const ClientClass=dependencies.ClientClass||resolveClientClass();
  client=new ClientClass({...config,max:1,
   statement_timeout:5000,connectionTimeoutMillis:5000,
   application_name:'gpt02_preparer_auth_probe_READONLY'});
  await client.connect(); // exactly ONE attempt, no automatic retry
  await client.query('BEGIN READ ONLY');tx=true;
  await client.query("SET LOCAL statement_timeout='5s'");
  const result=await client.query(QUERY);
  await client.query('ROLLBACK');tx=false;
  if(!result||!Array.isArray(result.rows)||result.rows.length!==1)
   return report('AUTHENTICATED_CATALOG_RESULT_UNAVAILABLE');
  return assess(result.rows[0]);
 }catch{
  return report('DEDICATED_LOGIN_OR_CATALOG_PROBE_FAILED');
 }finally{
  if(client){
   if(tx)try{await client.query('ROLLBACK')}catch{}
   try{await client.end()}catch{}
  }
 }
}
if(import.meta.url===new URL('file://'+process.argv[1]).href){
 const output=await probe();
 process.stdout.write(JSON.stringify(output)+'\\n');
 if(!output.permissionsVerified)process.exitCode=2;
}
