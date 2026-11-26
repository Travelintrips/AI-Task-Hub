'use strict';
/** Bounded, read-only CST-DEV admission snapshot. NEVER authorizes GPT02 work. */
const EXPECTED_DEV_REF='xssrfshdrtdfupgqwfdw';
const{X509Certificate}=require('node:crypto');
const PINNED_ROOT_FINGERPRINT='807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa';
function verifiedRootCa(env={}) {
 const pem=env.GPT02_CST_DEV_READONLY_CA_PEM;
 if(typeof pem!=='string'||pem.length>8192||!pem.includes('-----BEGIN CERTIFICATE-----'))return null;
 try{
  const cert=new X509Certificate(pem);
  if(cert.fingerprint256.replaceAll(':','').toLowerCase()!==PINNED_ROOT_FINGERPRINT)return null;
  return pem;
 }catch{return null}
}

const NEED=['connected','readonly','pinnedProject','restrictedHubRole','dedicatedPreparerRole',
 'isolatedPreparerPermissions','preparationInstalled','attestorRoleReady','issuerRoleReady',
 'approvalFunctionsInstalled','historicalTaskBoundaryEnforced','verifiedOperatorConsent','leaseIssuerOperational','nativeDispatchGranted'];
const REASONS={connected:'CST_DEV_DB_READ_UNAVAILABLE',readonly:'READ_ONLY_TRANSACTION_NOT_VERIFIED',
 pinnedProject:'CST_DEV_PROJECT_IDENTITY_NOT_PINNED',restrictedHubRole:'HUB_USES_PRIVILEGED_SHARED_DB_LOGIN',
 dedicatedPreparerRole:'DEDICATED_PREPARER_LOGIN_MISSING_OR_DISABLED',
 isolatedPreparerPermissions:'PREPARER_DIRECT_DML_OR_ADMIN_PRIVILEGES_UNVERIFIED',
 preparationInstalled:'HUB_CORE_PREPARATION_NOT_DEPLOYED',
 attestorRoleReady:'ATTESTOR_IDENTITY_NOT_ACTIVE',issuerRoleReady:'ISSUER_IDENTITY_NOT_ACTIVE',
 approvalFunctionsInstalled:'SIGNED_APPROVAL_ROUTINES_NOT_DEPLOYED',
 historicalTaskBoundaryEnforced:'APPROVAL_SCHEMA_STILL_ACCEPTS_HISTORICAL_TASK_IDS',
 verifiedOperatorConsent:'FRESH_SUPER_ADMIN_SIGNATURE_NOT_VERIFIED',
 leaseIssuerOperational:'ISSUER_LEASE_NOT_VERIFIED',nativeDispatchGranted:'NO_NEW_COMMAND_DISPATCH_AUTHORIZATION'};
function evaluate(observed={}) {
 const checks=Object.fromEntries(NEED.map(k=>[k,observed[k]===true]));
 const blockers=NEED.filter(k=>!checks[k]).map(k=>REASONS[k]);
 return Object.freeze({environment:'CST-DEV',mode:'READ_ONLY_ACTIVATION_READINESS',
  checkedAt:typeof observed.checkedAt==='string'?observed.checkedAt:null,
  databaseRole:typeof observed.databaseRole==='string'?observed.databaseRole:null,
  schemaState:{preparationInstalled:checks.preparationInstalled,
    dormantPreparationTableStaged:observed.dormantPreparationTableStaged===true,
    dormantPreparerFunctionVerified:observed.dormantPreparerFunctionVerified===true,
    ownerParentGrantsVerified:observed.ownerParentGrantsVerified===true,
    scopedPreparerRlsVerified:observed.scopedPreparerRlsVerified===true,
    approvalFunctionsInstalled:checks.approvalFunctionsInstalled,
    historicalTaskBoundaryEnforced:checks.historicalTaskBoundaryEnforced},
  roleState:{hubRestricted:checks.restrictedHubRole,preparerDedicated:checks.dedicatedPreparerRole,
    dormantPreparerStaged:observed.dormantPreparerStaged===true,
    issuerReady:checks.issuerRoleReady,attestorReady:checks.attestorRoleReady},
  evidenceCounts:{approved:Number.isSafeInteger(observed.approved)&&observed.approved>=0?observed.approved:null,
    receipts:Number.isSafeInteger(observed.receipts)&&observed.receipts>=0?observed.receipts:null,
    preparedJobs:Number.isSafeInteger(observed.preparedJobs)&&observed.preparedJobs>=0?observed.preparedJobs:null},
  coreOperatorAdminCount:Number.isSafeInteger(observed.coreOperatorAdminCount)&&observed.coreOperatorAdminCount>=0?observed.coreOperatorAdminCount:null,
  checks,blockers,scope:'FUTURE_NEW_TASK_ONLY',readOnly:true,
  approvalGranted:false,issuerGrantReady:false,dispatchPermitted:false,autoContinuePermitted:false,
  existing135136UntouchedByThisCheck:true,releaseDecision:'NO_GO'});
}
function validateTarget(env={}) {
 if(env.NODE_ENV!=='development'||env.APP_ENV==='production'||env.NODE_TLS_REJECT_UNAUTHORIZED==='0'||!verifiedRootCa(env))return false;
 const raw=env.SUPABASE_DATABASE_URL_DEV;
 if(typeof raw!=='string')return false;
 let u,username;try{u=new URL(raw);username=decodeURIComponent(u.username)}catch{return false}
 const expectedHost='db.'+EXPECTED_DEV_REF+'.supabase.co';
 const pooler=/^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/;
 return ['postgres:','postgresql:'].includes(u.protocol)&&u.password.length>0&&u.pathname==='/postgres'&&
  ((u.hostname===expectedHost&&username==='postgres')||
   (pooler.test(u.hostname)&&username==='postgres.'+EXPECTED_DEV_REF))&&
  !u.search&&!u.hash&&(!u.port||u.port==='5432');
}
const QUERY=`SELECT now()::text AS checked_at,current_user AS database_role,
 current_setting('transaction_read_only')='on' AS is_readonly,
 (SELECT NOT (rolsuper OR rolcreaterole OR rolbypassrls OR rolcreatedb OR rolreplication) AND rolname<>'postgres'
    FROM pg_roles WHERE rolname=current_user) AS hub_role_restricted,
 (SELECT rolcanlogin AND NOT(rolsuper OR rolcreaterole OR rolbypassrls OR rolcreatedb OR rolreplication)
    AND NOT EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid)
    FROM pg_roles r WHERE rolname='gpt02_core_prep_login') AS preparer_role_limited,
 (SELECT NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls)
    AND rolconnlimit=0 AND rolvaliduntil<clock_timestamp()
    AND NOT EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid)
    FROM pg_roles r WHERE rolname='gpt02_core_prep_login') AS preparer_dormant_staged,
 (SELECT rolcanlogin AND NOT(rolsuper OR rolcreaterole OR rolbypassrls OR rolcreatedb)
    FROM pg_roles WHERE rolname='dev_gpt02_issuer_evidence') AS issuer_role_ready,
 (SELECT rolcanlogin AND NOT(rolsuper OR rolcreaterole OR rolbypassrls OR rolcreatedb)
    FROM pg_roles WHERE rolname='dev_gpt02_attestor_evidence') AS attestor_role_ready,
 to_regclass('gpt02_stage.core_preparations') IS NOT NULL AS preparation_table_exists,
 (SELECT c.relrowsecurity AND c.relforcerowsecurity AND
    pg_get_userbyid(c.relowner)='gpt02_core_prep_owner' AND
    NOT has_table_privilege('gpt02_core_prep_login',c.oid,'SELECT,INSERT,UPDATE,DELETE')
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='gpt02_stage' AND c.relname='core_preparations') AS dormant_table_locked,
 EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='gpt02_stage' AND p.proname='prepare_core_task') AS preparer_function_exists,
 (SELECT count(*)=1 AND bool_and(
   p.prosecdef AND pg_get_userbyid(p.proowner)='gpt02_core_prep_owner'
   AND 'search_path=pg_catalog'=ANY(p.proconfig)
   AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='b18275516add255e76f31414a28732bdd900b556b10f38d42e2e4bdf9f7415d4'
   AND NOT has_function_privilege('postgres',p.oid,'EXECUTE')
   AND NOT has_function_privilege('gpt02_core_prep_login',p.oid,'EXECUTE')
   AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
   AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
   AND NOT has_function_privilege('service_role',p.oid,'EXECUTE')
   AND NOT has_schema_privilege('gpt02_core_prep_login','gpt02_stage','USAGE')
   AND NOT has_table_privilege('gpt02_core_prep_owner','public.ai_execution_jobs','UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   AND NOT has_table_privilege('gpt02_core_prep_owner','ai_platform.ai_coding_tasks','UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   AND EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname='gpt02_core_prep_owner' AND NOT r.rolcanlogin
     AND NOT r.rolsuper AND NOT r.rolbypassrls AND r.rolconnlimit=0))
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='gpt02_stage' AND p.proname='prepare_core_task_dormant') AS dormant_function_locked,
 (SELECT count(*)=8
    AND count(*) FILTER(WHERE has_table_privilege('gpt02_core_prep_owner',c.oid,'SELECT'))=8
    AND count(*) FILTER(WHERE has_table_privilege('gpt02_core_prep_owner',c.oid,'INSERT')
      AND c.relname IN ('ai_execution_jobs','ai_coding_tasks'))=2
    AND count(*) FILTER(WHERE has_table_privilege('gpt02_core_prep_owner',c.oid,'INSERT')
      AND c.relname NOT IN ('ai_execution_jobs','ai_coding_tasks'))=0
    AND count(*) FILTER(WHERE has_table_privilege('gpt02_core_prep_owner',c.oid,
      'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))=0
    AND count(*) FILTER(WHERE has_table_privilege('gpt02_core_prep_login',c.oid,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))=0
    AND bool_and(c.relrowsecurity AND pg_get_userbyid(c.relowner)='postgres')
    AND has_schema_privilege('gpt02_core_prep_owner','ai_platform','USAGE')
    AND has_schema_privilege('gpt02_core_prep_owner','extensions','USAGE')
    AND NOT has_schema_privilege('gpt02_core_prep_login','gpt02_stage','USAGE')
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE (n.nspname='public' AND c.relname IN
    ('ai_tasks','team_members','audit_logs','users','ai_execution_jobs'))
    OR (n.nspname='ai_platform' AND c.relname IN
    ('ai_coding_tasks','ai_coding_runs','ai_coding_bridge_commands'))) AS owner_parent_grants_exact,
 (SELECT count(*)=10 AND
   count(*) FILTER (WHERE p.roles='{gpt02_core_prep_owner}'::name[])=10 AND
   count(*) FILTER (WHERE p.cmd='INSERT')=2 AND
   encode(sha256(convert_to(string_agg(
     format('%s|%s|%s|%s|%s|%s|%s|%s',p.schemaname,p.tablename,p.policyname,p.permissive,p.roles::text,p.cmd,
       coalesce(p.qual,'<NULL>'),coalesce(p.with_check,'<NULL>')),
     E'\n' ORDER BY p.schemaname,p.tablename,p.policyname),'UTF8')),'hex')=
       'b157e1fbfe1a844309373db42743257f1996895316dc87166d385637c9f8031d'
   FROM pg_policies p WHERE p.policyname LIKE 'gpt02_preparer_%') AS scoped_preparer_rls_exact,
 EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='gpt02_private' AND p.proname='record_linked_approval') AS attestor_function_exists,
 EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='gpt02_private' AND p.proname='consume_linked_approval') AS issuer_function_exists,
 EXISTS (SELECT 1 FROM pg_catalog.pg_constraint co
   JOIN pg_catalog.pg_class cl ON cl.oid=co.conrelid
   JOIN pg_catalog.pg_namespace n ON n.oid=cl.relnamespace
   WHERE n.nspname='gpt02_private' AND cl.relname='approvals'
     AND co.contype='c' AND co.convalidated IS TRUE
     AND regexp_replace(pg_catalog.pg_get_expr(co.conbin,co.conrelid),'[[:space:]()]','','g')='task_id>136') AS historical_task_boundary_enforced,
 (SELECT count(*)::int FROM gpt02_private.approvals) AS approved_count,
 (SELECT count(*)::int FROM gpt02_private.receipts) AS receipt_count,
 (SELECT count(*)::int FROM public.ai_execution_jobs WHERE status='prepared' AND company_id='default') AS prepared_count,
 (SELECT count(*)::int FROM ai_platform.internal_users
  WHERE role IN('owner','admin') AND status='active' AND must_change_password=false) AS core_operator_admin_count`;
function observedFromRow(row={},pinnedProject=false){
 return {connected:true,readonly:row.is_readonly===true,pinnedProject,
  databaseRole:row.database_role,checkedAt:row.checked_at,
  restrictedHubRole:row.hub_role_restricted===true,
  dedicatedPreparerRole:row.preparer_role_limited===true,
  dormantPreparerStaged:row.preparer_dormant_staged===true,
  // Read-only catalogs cannot demonstrate a distinct preparer LOGIN's
  // effective privileges. This must be proven via its own authenticated session.
  isolatedPreparerPermissions:false,
  preparationInstalled:row.preparation_table_exists===true&&row.preparer_function_exists===true,
  dormantPreparationTableStaged:row.dormant_table_locked===true&&row.preparer_function_exists===false,
  dormantPreparerFunctionVerified:row.dormant_function_locked===true&&row.owner_parent_grants_exact===true&&row.dormant_table_locked===true&&row.preparer_function_exists===false,
  ownerParentGrantsVerified:row.owner_parent_grants_exact===true,
  scopedPreparerRlsVerified:row.scoped_preparer_rls_exact===true,
  attestorRoleReady:row.attestor_role_ready===true,issuerRoleReady:row.issuer_role_ready===true,
  approvalFunctionsInstalled:row.attestor_function_exists===true&&row.issuer_function_exists===true,
  historicalTaskBoundaryEnforced:row.historical_task_boundary_enforced===true,
  verifiedOperatorConsent:false,leaseIssuerOperational:false,nativeDispatchGranted:false,
  approved:row.approved_count,receipts:row.receipt_count,preparedJobs:row.prepared_count,
  coreOperatorAdminCount:row.core_operator_admin_count};
}
async function main(env=process.env){
 if(!validateTarget(env)){process.stdout.write(JSON.stringify(evaluate())+'\n');process.exitCode=2;return;}
 let pg,c,started=false;
 try{
  pg=require('pg');c=new pg.Client({connectionString:env.SUPABASE_DATABASE_URL_DEV,
    ssl:{ca:verifiedRootCa(env),rejectUnauthorized:true},connectionTimeoutMillis:5000,statement_timeout:6000,application_name:'gpt02_lifecycle_activation_preflight_readonly'});
  await c.connect();await c.query('BEGIN READ ONLY');started=true;
  await c.query("SET LOCAL statement_timeout='6s'");
  const result=await c.query(QUERY);
  await c.query('ROLLBACK');started=false;
  process.stdout.write(JSON.stringify(evaluate(observedFromRow(result.rows[0],true)))+'\n');
 }catch(e){if(started)try{await c.query('ROLLBACK')}catch{}
  process.stdout.write(JSON.stringify(evaluate({pinnedProject:true}))+'\n');process.exitCode=2;
 }finally{if(c)await c.end().catch(()=>{})}
}
module.exports={evaluate,validateTarget,verifiedRootCa,observedFromRow,QUERY,main,NEED,REASONS};
if(require.main===module)main();
