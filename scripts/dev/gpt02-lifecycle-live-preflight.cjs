'use strict';
/** Bounded, read-only CST-DEV admission snapshot. NEVER authorizes GPT02 work. */
const EXPECTED_DEV_REF='xssrfshdrtdfupgqwfdw';
const NEED=['connected','readonly','pinnedProject','restrictedHubRole','dedicatedPreparerRole',
 'isolatedPreparerPermissions','preparationInstalled','attestorRoleReady','issuerRoleReady',
 'approvalFunctionsInstalled','verifiedOperatorConsent','leaseIssuerOperational','nativeDispatchGranted'];
const REASONS={connected:'CST_DEV_DB_READ_UNAVAILABLE',readonly:'READ_ONLY_TRANSACTION_NOT_VERIFIED',
 pinnedProject:'CST_DEV_PROJECT_IDENTITY_NOT_PINNED',restrictedHubRole:'HUB_USES_PRIVILEGED_SHARED_DB_LOGIN',
 dedicatedPreparerRole:'DEDICATED_PREPARER_LOGIN_MISSING_OR_DISABLED',
 isolatedPreparerPermissions:'PREPARER_DIRECT_DML_OR_ADMIN_PRIVILEGES_UNVERIFIED',
 preparationInstalled:'HUB_CORE_PREPARATION_NOT_DEPLOYED',
 attestorRoleReady:'ATTESTOR_IDENTITY_NOT_ACTIVE',issuerRoleReady:'ISSUER_IDENTITY_NOT_ACTIVE',
 approvalFunctionsInstalled:'SIGNED_APPROVAL_ROUTINES_NOT_DEPLOYED',
 verifiedOperatorConsent:'FRESH_SUPER_ADMIN_SIGNATURE_NOT_VERIFIED',
 leaseIssuerOperational:'ISSUER_LEASE_NOT_VERIFIED',nativeDispatchGranted:'NO_NEW_COMMAND_DISPATCH_AUTHORIZATION'};
function evaluate(observed={}) {
 const checks=Object.fromEntries(NEED.map(k=>[k,observed[k]===true]));
 const blockers=NEED.filter(k=>!checks[k]).map(k=>REASONS[k]);
 return Object.freeze({environment:'CST-DEV',mode:'READ_ONLY_ACTIVATION_READINESS',
  checkedAt:typeof observed.checkedAt==='string'?observed.checkedAt:null,
  databaseRole:typeof observed.databaseRole==='string'?observed.databaseRole:null,
  schemaState:{preparationInstalled:checks.preparationInstalled,approvalFunctionsInstalled:checks.approvalFunctionsInstalled},
  roleState:{hubRestricted:checks.restrictedHubRole,preparerDedicated:checks.dedicatedPreparerRole,
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
 if(env.NODE_ENV!=='development'||env.APP_ENV==='production'||env.NODE_TLS_REJECT_UNAUTHORIZED==='0')return false;
 const raw=env.SUPABASE_DATABASE_URL_DEV;
 if(typeof raw!=='string')return false;
 let u,username;try{u=new URL(raw);username=decodeURIComponent(u.username)}catch{return false}
 const expectedHost='db.'+EXPECTED_DEV_REF+'.supabase.co';
 const pooler=/^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/;
 return ['postgres:','postgresql:'].includes(u.protocol)&&u.password.length>0&&u.pathname==='/postgres'&&
  ((u.hostname===expectedHost&&username==='postgres')||
   (pooler.test(u.hostname)&&username.endsWith('.'+EXPECTED_DEV_REF)))&&
  !u.search&&!u.hash&&(!u.port||['5432','6543'].includes(u.port));
}
const QUERY=`SELECT now()::text AS checked_at,current_user AS database_role,
 current_setting('transaction_read_only')='on' AS is_readonly,
 (SELECT NOT (rolsuper OR rolcreaterole OR rolbypassrls OR rolcreatedb OR rolreplication) AND rolname<>'postgres'
    FROM pg_roles WHERE rolname=current_user) AS hub_role_restricted,
 (SELECT rolcanlogin AND NOT(rolsuper OR rolcreaterole OR rolbypassrls OR rolcreatedb OR rolreplication)
    AND NOT EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid)
    FROM pg_roles r WHERE rolname='gpt02_core_prep_login') AS preparer_role_limited,
 (SELECT rolcanlogin AND NOT(rolsuper OR rolcreaterole OR rolbypassrls OR rolcreatedb)
    FROM pg_roles WHERE rolname='dev_gpt02_issuer_evidence') AS issuer_role_ready,
 (SELECT rolcanlogin AND NOT(rolsuper OR rolcreaterole OR rolbypassrls OR rolcreatedb)
    FROM pg_roles WHERE rolname='dev_gpt02_attestor_evidence') AS attestor_role_ready,
 to_regclass('gpt02_stage.core_preparations') IS NOT NULL AS preparation_table_exists,
 EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='gpt02_stage' AND p.proname='prepare_core_task') AS preparer_function_exists,
 EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='gpt02_private' AND p.proname='record_linked_approval') AS attestor_function_exists,
 EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='gpt02_private' AND p.proname='consume_linked_approval') AS issuer_function_exists,
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
  // Read-only catalogs cannot demonstrate a distinct preparer LOGIN's
  // effective privileges. This must be proven via its own authenticated session.
  isolatedPreparerPermissions:false,
  preparationInstalled:row.preparation_table_exists===true&&row.preparer_function_exists===true,
  attestorRoleReady:row.attestor_role_ready===true,issuerRoleReady:row.issuer_role_ready===true,
  approvalFunctionsInstalled:row.attestor_function_exists===true&&row.issuer_function_exists===true,
  verifiedOperatorConsent:false,leaseIssuerOperational:false,nativeDispatchGranted:false,
  approved:row.approved_count,receipts:row.receipt_count,preparedJobs:row.prepared_count,
  coreOperatorAdminCount:row.core_operator_admin_count};
}
async function main(env=process.env){
 if(!validateTarget(env)){process.stdout.write(JSON.stringify(evaluate())+'\n');process.exitCode=2;return;}
 let pg,c,started=false;
 try{
  pg=require('pg');c=new pg.Client({connectionString:env.SUPABASE_DATABASE_URL_DEV,
    connectionTimeoutMillis:5000,statement_timeout:6000,application_name:'gpt02_lifecycle_activation_preflight_readonly'});
  await c.connect();await c.query('BEGIN READ ONLY');started=true;
  await c.query("SET LOCAL statement_timeout='6s'");
  const result=await c.query(QUERY);
  await c.query('ROLLBACK');started=false;
  process.stdout.write(JSON.stringify(evaluate(observedFromRow(result.rows[0],true)))+'\n');
 }catch(e){if(started)try{await c.query('ROLLBACK')}catch{}
  process.stdout.write(JSON.stringify(evaluate({pinnedProject:true}))+'\n');process.exitCode=2;
 }finally{if(c)await c.end().catch(()=>{})}
}
module.exports={evaluate,validateTarget,observedFromRow,QUERY,main,NEED,REASONS};
if(require.main===module)main();
