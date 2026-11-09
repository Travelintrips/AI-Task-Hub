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
 assert.doesNotMatch(QUERY,/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|CALL|COPY)\b/i);
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
