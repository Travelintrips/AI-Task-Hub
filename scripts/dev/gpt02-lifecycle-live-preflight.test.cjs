'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const PUBLIC_DEV_CA=fs.readFileSync(path.join(__dirname,'fixtures/supabase-root-ca-2021.crt'),'utf8');
const {evaluate,validateTarget,observedFromRow,QUERY,NEED}=require('./gpt02-lifecycle-live-preflight.cjs');
const DEV='xssrfshdrtdfupgqwfdw',P='z'.repeat(20);
const goodEnv={NODE_ENV:'development',APP_ENV:'development',GPT02_CST_DEV_READONLY_CA_PEM:PUBLIC_DEV_CA,
 SUPABASE_DATABASE_URL_DEV:`postgresql://postgres.${DEV}:synthetic@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres`};
test('the exact existing CST-DEV project, pooler login, and read-only runtime are pinned',()=>{
 assert.equal(validateTarget(goodEnv),true);
 assert.equal(validateTarget({...goodEnv,GPT02_CST_DEV_READONLY_CA_PEM:'test'}),false);
 assert.equal(validateTarget({...goodEnv,SUPABASE_DATABASE_URL_DEV:`postgres://postgres:synthetic@db.${DEV}.supabase.co/postgres`}),true);
});
test('reject PROD, wrong project, postgres impersonation, disabled TLS or fake host',()=>{
 for(const patch of [{NODE_ENV:'production'},{APP_ENV:'production'},{NODE_TLS_REJECT_UNAUTHORIZED:'0'},
  {GPT02_CST_DEV_READONLY_CA_PEM:null},{GPT02_CST_DEV_READONLY_CA_PEM:'---BEGIN CERTIFICATE---'},
  {SUPABASE_DATABASE_URL_DEV:goodEnv.SUPABASE_DATABASE_URL_DEV.replace(DEV,P)},
  {SUPABASE_DATABASE_URL_DEV:goodEnv.SUPABASE_DATABASE_URL_DEV.replace('postgres.'+DEV,'postgres')},
  {SUPABASE_DATABASE_URL_DEV:goodEnv.SUPABASE_DATABASE_URL_DEV.replace('pooler.supabase.com','pooler.evil.example')},
  {SUPABASE_DATABASE_URL_DEV:goodEnv.SUPABASE_DATABASE_URL_DEV.replace('5432','1234')},
  {SUPABASE_DATABASE_URL_DEV:goodEnv.SUPABASE_DATABASE_URL_DEV.replace('5432','6543')},
  {SUPABASE_DATABASE_URL_DEV:goodEnv.SUPABASE_DATABASE_URL_DEV.replace('postgres.'+DEV,'dev_gpt02_issuer_evidence.'+DEV)},
  {SUPABASE_DATABASE_URL_DEV:goodEnv.SUPABASE_DATABASE_URL_DEV+'?sslmode=disable'},
  {SUPABASE_DATABASE_URL_DEV:'postgresql://postgres@localhost/postgres'},
  {SUPABASE_DATABASE_URL_DEV:''}])assert.equal(validateTarget({...goodEnv,...patch}),false);
});
test('even all synthetic green flags never enable cutover, token, signature or dispatch',()=>{
 const r=evaluate(Object.fromEntries(NEED.map(k=>[k,true])));
 assert.equal(r.releaseDecision,'NO_GO');assert.equal(r.dispatchPermitted,false);
 assert.equal(r.approvalGranted,false);assert.equal(r.issuerGrantReady,false);
 assert.equal(r.autoContinuePermitted,false);assert.equal(r.readOnly,true);
 assert.equal(r.blockers.length,0);
});
test('true healthy active Core operators do not replace cryptographic consent',()=>{
 const r=evaluate({connected:true,readonly:true,pinnedProject:true,coreOperatorAdminCount:3,
  verifiedOperatorConsent:false,leaseIssuerOperational:false,nativeDispatchGranted:false});
 for(const k of ['FRESH_SUPER_ADMIN_SIGNATURE_NOT_VERIFIED','ISSUER_LEASE_NOT_VERIFIED','NO_NEW_COMMAND_DISPATCH_AUTHORIZATION'])
  assert.ok(r.blockers.includes(k),k);
 assert.equal(r.coreOperatorAdminCount,3);assert.equal(r.releaseDecision,'NO_GO');
});
test('actual postgres login and NOLOGIN roles appear as concrete blockers',()=>{
 const row={database_role:'postgres',is_readonly:true,hub_role_restricted:false,preparer_role_limited:null,
  issuer_role_ready:false,attestor_role_ready:false,preparation_table_exists:false,
  preparer_function_exists:false,attestor_function_exists:false,issuer_function_exists:false,historical_task_boundary_enforced:false,
  approved_count:0,receipt_count:0,prepared_count:0,core_operator_admin_count:2};
 const r=evaluate(observedFromRow(row,true));
 for(const k of ['HUB_USES_PRIVILEGED_SHARED_DB_LOGIN','DEDICATED_PREPARER_LOGIN_MISSING_OR_DISABLED',
  'HUB_CORE_PREPARATION_NOT_DEPLOYED','ATTESTOR_IDENTITY_NOT_ACTIVE','ISSUER_IDENTITY_NOT_ACTIVE',
  'SIGNED_APPROVAL_ROUTINES_NOT_DEPLOYED','APPROVAL_SCHEMA_STILL_ACCEPTS_HISTORICAL_TASK_IDS'])assert.ok(r.blockers.includes(k),k);
 assert.equal(r.evidenceCounts.approved,0);assert.equal(r.evidenceCounts.receipts,0);
});
test('live query reads catalog and aggregate readiness only, no sensitive records or writes',()=>{
 assert.match(QUERY,/current_setting\('transaction_read_only'\)='on'/);
 assert.match(QUERY,/rolcreaterole OR rolbypassrls/);
 assert.match(QUERY,/gpt02_private\.approvals/);
 assert.match(QUERY,/gpt02_stage\.core_preparations/);
 assert.match(QUERY,/historical_task_boundary_enforced/);
 assert.match(QUERY,/co\.convalidated IS TRUE/);
 assert.match(QUERY,/task_id>136/);
 assert.doesNotMatch(QUERY.replace(/'(?:''|[^'])*'/g,"''"),/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|CALL|COPY)\b/i);
 assert.doesNotMatch(QUERY,/password_hash|email|access_token|auth\.users|private_key/i);
 const source=fs.readFileSync(require.resolve('./gpt02-lifecycle-live-preflight.cjs'),'utf8');
 assert.match(source,/BEGIN READ ONLY/);assert.match(source,/ROLLBACK/);
 assert.doesNotMatch(source,/submitAiTask|queueDevBrowserWake|scheduleExecutionTracking/);
});
test('failed or missing database read reports NO_GO, never fakes green results',()=>{
 const r=evaluate();assert.equal(r.readOnly,true);assert.equal(r.releaseDecision,'NO_GO');
 assert.equal(r.dispatchPermitted,false);assert.equal(r.checks.connected,false);
 assert.ok(r.blockers.includes('CST_DEV_DB_READ_UNAVAILABLE'));
});

test('the signed approval table must enforce only future Task IDs at the DB layer',()=>{
 const sample={is_readonly:true,database_role:'gpt02_core_prep_login',hub_role_restricted:true,
   preparer_role_limited:true,issuer_role_ready:true,attestor_role_ready:true,
   preparation_table_exists:true,preparer_function_exists:true,
   attestor_function_exists:true,issuer_function_exists:true,
   approved_count:0,receipt_count:0,prepared_count:0,core_operator_admin_count:1};
 const old=evaluate(observedFromRow({...sample,historical_task_boundary_enforced:false},true));
 assert.equal(old.schemaState.historicalTaskBoundaryEnforced,false);
 assert.ok(old.blockers.includes('APPROVAL_SCHEMA_STILL_ACCEPTS_HISTORICAL_TASK_IDS'));
 const future=evaluate(observedFromRow({...sample,historical_task_boundary_enforced:true},true));
 assert.equal(future.schemaState.historicalTaskBoundaryEnforced,true);
 assert.ok(!future.blockers.includes('APPROVAL_SCHEMA_STILL_ACCEPTS_HISTORICAL_TASK_IDS'));
 assert.equal(future.releaseDecision,'NO_GO');assert.equal(future.dispatchPermitted,false);
});

test('dormant no-login preparer shows measurable progress without issuer or dispatch readiness',()=>{
 const r=evaluate(observedFromRow({database_role:'postgres',is_readonly:true,
   preparer_role_limited:false,preparer_dormant_staged:true,
   issuer_role_ready:false,attestor_role_ready:false,
   preparation_table_exists:false,preparer_function_exists:false},true));
 assert.equal(r.roleState.dormantPreparerStaged,true);
 assert.equal(r.roleState.preparerDedicated,false);
 assert.ok(r.blockers.includes('DEDICATED_PREPARER_LOGIN_MISSING_OR_DISABLED'));
 assert.equal(r.releaseDecision,'NO_GO');assert.equal(r.dispatchPermitted,false);
});

test('staged empty private table is visible separately from active Core preparation',()=>{
 const v=evaluate(observedFromRow({preparation_table_exists:true,dormant_table_locked:true,preparer_function_exists:false},true));
 assert.equal(v.schemaState.dormantPreparationTableStaged,true);
 assert.equal(v.schemaState.preparationInstalled,false);
 assert.ok(v.blockers.includes('HUB_CORE_PREPARATION_NOT_DEPLOYED'));
 assert.equal(v.releaseDecision,'NO_GO');assert.equal(v.dispatchPermitted,false);
});

test('dormant function and exact ten RLS policies are visible without granting lifecycle or execution',()=>{
 const base={database_role:'postgres',is_readonly:true,preparer_role_limited:false,
  preparer_dormant_staged:true,preparation_table_exists:true,dormant_table_locked:true,
  preparer_function_exists:false,dormant_function_locked:true,scoped_preparer_rls_exact:true,
  historical_task_boundary_enforced:true,
  issuer_role_ready:false,attestor_role_ready:false,
  approved_count:0,receipt_count:0,prepared_count:0};
 const result=evaluate(observedFromRow(base,true));
 assert.equal(result.schemaState.dormantPreparationTableStaged,true);
 assert.equal(result.schemaState.dormantPreparerFunctionVerified,true);
 assert.equal(result.schemaState.scopedPreparerRlsVerified,true);
 assert.equal(result.schemaState.preparationInstalled,false);
 assert.equal(result.roleState.preparerDedicated,false);
 assert.ok(result.blockers.includes('HUB_CORE_PREPARATION_NOT_DEPLOYED'));
 assert.ok(result.blockers.includes('FRESH_SUPER_ADMIN_SIGNATURE_NOT_VERIFIED'));
 assert.equal(result.dispatchPermitted,false);assert.equal(result.releaseDecision,'NO_GO');
 // A dormant function can never be called "verified" after an active-name
 // function appears, even if an old dormant copy still matches byte-for-byte.
 const active=evaluate(observedFromRow({...base,preparer_function_exists:true},true));
 assert.equal(active.schemaState.dormantPreparerFunctionVerified,false);
 assert.equal(active.dispatchPermitted,false);assert.equal(active.releaseDecision,'NO_GO');
});
test('mismatched function digest, leaked EXECUTE or changed RLS policy fingerprint fail closed',()=>{
 const base={is_readonly:true,preparation_table_exists:true,dormant_table_locked:true,
  preparer_function_exists:false,dormant_function_locked:true,scoped_preparer_rls_exact:true};
 for(const key of ['dormant_function_locked','scoped_preparer_rls_exact','dormant_table_locked']){
  const bad=evaluate(observedFromRow({...base,[key]:false},true));
  if(key!=='scoped_preparer_rls_exact')assert.equal(bad.schemaState.dormantPreparerFunctionVerified,false);
  if(key==='scoped_preparer_rls_exact')assert.equal(bad.schemaState.scopedPreparerRlsVerified,false);
  assert.equal(bad.dispatchPermitted,false);assert.equal(bad.releaseDecision,'NO_GO');
 }
 const absent=evaluate(observedFromRow({},true));
 assert.equal(absent.schemaState.dormantPreparerFunctionVerified,false);
 assert.equal(absent.schemaState.scopedPreparerRlsVerified,false);
 assert.equal(absent.releaseDecision,'NO_GO');
});
test('read-only catalog query pins exact dormant SHA-256, owner ACL, and policy fingerprint',()=>{
 assert.match(QUERY,/dormant_function_locked/);
 assert.match(QUERY,/scoped_preparer_rls_exact/);
 assert.match(QUERY,/b18275516add255e76f31414a28732bdd900b556b10f38d42e2e4bdf9f7415d4/);
 assert.match(QUERY,/b157e1fbfe1a844309373db42743257f1996895316dc87166d385637c9f8031d/);
 assert.match(QUERY,/has_function_privilege\('postgres',p.oid,'EXECUTE'\)/);
 assert.match(QUERY,/has_function_privilege\('gpt02_core_prep_login',p.oid,'EXECUTE'\)/);
 assert.match(QUERY,/has_table_privilege\('gpt02_core_prep_owner','public.ai_execution_jobs'/);
 assert.match(QUERY,/count\(\*\)=10/);
 assert.doesNotMatch(QUERY,/supabase_migrations\.schema_migrations/);
});
