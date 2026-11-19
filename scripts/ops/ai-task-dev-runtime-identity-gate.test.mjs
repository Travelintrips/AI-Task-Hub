import test from 'node:test';
import assert from 'node:assert/strict';
import { assessIsolatedDevRuntime as audit } from './ai-task-dev-runtime-identity-gate.mjs';

const project='xssrfshdrtdfupgqwfdw';
const base = () => ({
  NODE_ENV:'development', APP_ENV:'development',
  AI_TASK_DEV_ISOLATED_E2E:'true',
  DISABLE_BACKGROUND_SCHEDULERS:'true', RUN_STARTUP_MIGRATIONS:'false',
  AI_TASK_DEV_REQUIRE_VERIFIED_TLS:'true',
  AI_TASK_DEV_DB_CA_CERT_PATH:'/run/credentials/ai-task-dev/supabase-ca.pem',
  SUPABASE_DATABASE_URL_DEV:'postgresql://ai_task_operational_dev.'+project+':not-a-real-secret@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres',
});
const check = (change, expected) => {
  const result = audit({...base(), ...change});
  assert.equal(result.formatPass, false);
  assert.ok(result.blockers.includes(expected), result.blockers.join(','));
  assert.equal(result.e2eAuthorized, false);
};

test('candidate syntax can pass, but no fake E2E/TLS/RLS PASS',()=>{
  const a=audit(base());
  assert.equal(a.formatPass,true);
  assert.equal(a.e2eAuthorized,false);
  assert.equal(a.tlsAuthenticated,false);
  assert.equal(a.rlsIsolationProven,false);
});
test('real PR196-like postgres session pooler is blocked',()=>
  check({SUPABASE_DATABASE_URL_DEV:'postgresql://postgres.'+project+':anything@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres'},'UNAPPROVED_DEV_DATABASE_ROLE'));
test('legacy reader NOLOGIN cannot be promoted by syntax check',()=>
  check({SUPABASE_DATABASE_URL_DEV:'postgresql://ai_task_vps_identity_reader_dev.'+project+':anything@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres'},'UNAPPROVED_DEV_DATABASE_ROLE'));
test('old ai_task_hostinger BYPASSRLS is rejected',()=>
  check({SUPABASE_DATABASE_URL_DEV:'postgresql://ai_task_hostinger.'+project+':anything@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres'},'UNAPPROVED_DEV_DATABASE_ROLE'));
test('wrong pooler port rejected',()=>
  check({SUPABASE_DATABASE_URL_DEV:base().SUPABASE_DATABASE_URL_DEV.replace(':6543/',':5432/')},'UNAPPROVED_DEV_POOLER_PORT'));
test('foreign-host target rejected',()=>
  check({SUPABASE_DATABASE_URL_DEV:base().SUPABASE_DATABASE_URL_DEV.replace('aws-0-ap-southeast-2.pooler.supabase.com','db.evil.example')},'UNAPPROVED_DEV_DATABASE_HOST'));
test('non-DEV environment rejected',()=>check({NODE_ENV:'production'},'NON_DEV_ENVIRONMENT'));
test('background schedulers must be off for isolated E2E',()=>check({DISABLE_BACKGROUND_SCHEDULERS:'false'},'BACKGROUND_SCHEDULERS_NOT_DISABLED'));
test('startup DDL must be off for isolated E2E',()=>check({RUN_STARTUP_MIGRATIONS:'true'},'STARTUP_MIGRATIONS_NOT_DISABLED'));
test('explicit TLS off rejected',()=>check({DB_SSL:'false'},'TLS_EXPLICITLY_DISABLED'));
test('missing DSN rejected',()=>check({SUPABASE_DATABASE_URL_DEV:''},'MISSING_DEV_DATABASE_URL'));
test('badly encoded URL rejected',()=>check({SUPABASE_DATABASE_URL_DEV:'not a URL'},'INVALID_DEV_DATABASE_URL'));
test('blank password rejected',()=>check({SUPABASE_DATABASE_URL_DEV:base().SUPABASE_DATABASE_URL_DEV.replace(':not-a-real-secret@', '@')},'MISSING_DEV_DATABASE_SECRET'));
test('diagnostics contain no credential, URL or hostname',()=>{
  const secret='topSecret_123456';
  const result=audit({...base(), SUPABASE_DATABASE_URL_DEV:'postgresql://postgres.'+project+':'+secret+'@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres'});
  const serialized=JSON.stringify(result);
  assert.equal(serialized.includes(secret),false);
  assert.equal(serialized.includes('postgresql://'),false);
  assert.equal(serialized.includes('pooler.supabase.com'),false);
});

test('query user override cannot impersonate postgres',()=>
  check({SUPABASE_DATABASE_URL_DEV:base().SUPABASE_DATABASE_URL_DEV+'?user=postgres.'+project},'UNAPPROVED_DATABASE_URL_PARAMETERS'));
test('query host/port overrides cannot bypass the authority check',()=>
  check({SUPABASE_DATABASE_URL_DEV:base().SUPABASE_DATABASE_URL_DEV+'?host=db.other.example&port=5432'},'UNAPPROVED_DATABASE_URL_PARAMETERS'));
test('TLS downgrade query is rejected before database access',()=>
  check({SUPABASE_DATABASE_URL_DEV:base().SUPABASE_DATABASE_URL_DEV+'?sslmode=disable'},'UNAPPROVED_DATABASE_URL_PARAMETERS'));
test('unexpected database name is rejected',()=>
  check({SUPABASE_DATABASE_URL_DEV:base().SUPABASE_DATABASE_URL_DEV.replace('/postgres','/foreign_db')},'UNAPPROVED_DATABASE_NAME'));
test('URL fragments are rejected rather than ignored by a driver',()=>
  check({SUPABASE_DATABASE_URL_DEV:base().SUPABASE_DATABASE_URL_DEV+'#bad'},'UNAPPROVED_DATABASE_URL_PARAMETERS'));

test('verified TLS mode is mandatory for candidate E2E',()=>check({AI_TASK_DEV_REQUIRE_VERIFIED_TLS:'false'},'CERTIFICATE_VERIFICATION_NOT_CONFIGURED'));
test('Supabase approved CA custody path is mandatory for candidate E2E',()=>check({AI_TASK_DEV_DB_CA_CERT_PATH:'/tmp/untrusted.pem'},'CERTIFICATE_VERIFICATION_NOT_CONFIGURED'));

test('isolated preflight cannot run without explicit E2E mode',()=>check({AI_TASK_DEV_ISOLATED_E2E:'false'},'ISOLATED_E2E_MODE_NOT_ENABLED'));
