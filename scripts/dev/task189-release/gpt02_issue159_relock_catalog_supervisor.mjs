#!/usr/bin/env node
// DEV-only independent GPT02 relock supervisor. Operational custody is
// deliberately separate from signer/issuer credentials and identities.
// Never authorizes signing or dispatch. Existing backend pg driver reused.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HOST = 'db.xssrfshdrtdfupgqwfdw.supabase.co';
const ROLE = 'dev_gpt02_relock_catalog_auditor';
const CERT = '/etc/gpt02-dev/supabase-root-ca-2021.crt';
const CRED = 'relock-catalog-dsn';
const EXPECTED = ['database','host','password','port','projectRef','sslMode','user'];
// Keep the harder deadline model ALREADY INSTALLED on the authorized VPS.
// The reviewed 3s/backend termination budget must not be silently replaced
// by a shorter timeout when adding the scoped reader cleanup lane.
export const RELOCK_TERMINATION_BUDGET = Object.freeze({
  roleSlots: 3,
  perBackendWaitMs: 3000,
  connectionTimeoutMs: 4000,
  preflightQueryTimeoutMs: 2500,
  phaseAQueryTimeoutMs: 4500,
  statementTimeoutMs: 12000,
  queryTimeoutMs: 15000,
  systemdStartTimeoutMs: 45000,
});


export function validateCredentials(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error('RELOCK_CREDENTIAL_SHAPE_INVALID');
  }
  const keys = Object.keys(candidate).sort();
  if (keys.length !== EXPECTED.length ||
      keys.some((value, index) => value !== EXPECTED[index])) {
    throw new Error('RELOCK_CREDENTIAL_FIELDS_INVALID');
  }
  if (candidate.host !== HOST ||
      candidate.projectRef !== 'xssrfshdrtdfupgqwfdw' ||
      candidate.database !== 'postgres' ||
      candidate.user !== ROLE ||
      candidate.port !== 5432 ||
      candidate.sslMode !== 'verify-full' ||
      typeof candidate.password !== 'string' ||
      candidate.password.length < 45 ||
      candidate.password.length > 256) {
    throw new Error('RELOCK_IDENTITY_OR_TLS_PIN_INVALID');
  }
  return true;
}

export function validateResult(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1000) {
    throw new Error('RELOCK_' + label + '_RESULT_NOT_BOUNDED_INTEGER');
  }
  return value;
}

function result(reason, extra = {}) {
  return {
    environment: 'DEV', independentSupervisor: true,
    authorizationGranted: false, signingPermitted: false,
    dispatchPermitted: false, releaseDecision: 'NO_GO',
    reason, ...extra,
  };
}

// Reuse ONE existing relock timer/service. This does not grant access:
// writer Phase A/B remain the original installed functions; optional reader
// Phase A/B are additive and handle ONLY exact task-scoped ephemeral roles.
// Each query uses its own committed transaction (no BEGIN/COMMIT wrapper).
// Historical live cleanup counts are observations, NOT proof that a
// connected backend was killed. Preserve this existing public contract.
export function cleanupEvidence(phaseA, phaseB) {
  return result('RELOCK_CLEANUP_ONLY', {
    phaseAWindowCount: validateResult(phaseA, 'PHASE_A'),
    phaseBCleanedWindowCount: validateResult(phaseB, 'PHASE_B'),
    connectedSessionTerminationProven: false,
  });
}

const WRITER_PHASES = [
  'SELECT gpt02_relock_audit.relock_expired_phase_a() AS count',
  'SELECT gpt02_relock_audit.relock_expired_phase_b() AS count',
];
const READER_PHASES = [
  'SELECT gpt02_relock_audit.relock_reader_phase_a() AS count',
  'SELECT gpt02_relock_audit.relock_reader_phase_b() AS count',
];

async function runPair(client, statements, label) {
  const a = await client.query({
    text: statements[0],
    query_timeout: RELOCK_TERMINATION_BUDGET.phaseAQueryTimeoutMs,
  });
  const phaseAWindowCount = validateResult(
    a.rows.length === 1 ? a.rows[0].count : null, label + '_A'
  );
  // The separate statement MUST commit before phase B opens.
  const b = await client.query({
    text: statements[1],
    query_timeout: RELOCK_TERMINATION_BUDGET.queryTimeoutMs,
  });
  const phaseBCleanedWindowCount = validateResult(
    b.rows.length === 1 ? b.rows[0].count : null, label + '_B'
  );
  return {phaseAWindowCount, phaseBCleanedWindowCount};
}

export async function runCleanupPhases(client) {
  const writer = await client.query(
    "SELECT to_regprocedure('gpt02_relock_audit.relock_expired_phase_a()')" +
    " IS NOT NULL AS phase_a," +
    "to_regprocedure('gpt02_relock_audit.relock_expired_phase_b()')" +
    " IS NOT NULL AS phase_b"
  );
  if (writer.rows.length !== 1 ||
      writer.rows[0].phase_a !== true ||
      writer.rows[0].phase_b !== true) {
    throw new Error('RELOCK_PHASE_FUNCTIONS_NOT_INSTALLED');
  }
  // Never allow an exception in the original writer lane to starve reader
  // cleanup. Both independent workloads are attempted, but any failure is
  // propagated. If writer A fails, writer B is NOT started uncommitted.
  let writerError;
  let writerCounts;
  try {
    writerCounts = await runPair(client, WRITER_PHASES, 'WRITER');
  } catch (error) {
    writerError = error;
  }
  let readerError;
  let readerInstalled = false;
  let readerCounts = null;
  try {
    const state = await client.query(
      "SELECT to_regprocedure('gpt02_relock_audit.relock_reader_phase_a()')" +
      " IS NOT NULL AS phase_a," +
      "to_regprocedure('gpt02_relock_audit.relock_reader_phase_b()')" +
      " IS NOT NULL AS phase_b"
    );
    if (state.rows.length !== 1 ||
        typeof state.rows[0].phase_a !== 'boolean' ||
        typeof state.rows[0].phase_b !== 'boolean') {
      throw new Error('RELOCK_READER_CATALOG_UNKNOWN');
    }
    if (state.rows[0].phase_a !== state.rows[0].phase_b) {
      throw new Error('RELOCK_READER_PARTIAL_INSTALL_DENIED');
    }
    readerInstalled = state.rows[0].phase_a;
    if (readerInstalled) {
      readerCounts = await runPair(client, READER_PHASES, 'READER');
    } else {
      // The original writer-only runtime is safe only when NO scoped reader
      // identity exists. A partial migration may have created a LOGIN but
      // omitted relock RPCs; never report successful cleanup in that state.
      const roles = await client.query(
        "SELECT count(*)::integer AS scoped_roles FROM pg_roles " +
        "WHERE left(rolname::text,15)='dev_gpt02_task_'"
      );
      if (roles.rows.length !== 1 ||
          !Number.isSafeInteger(roles.rows[0].scoped_roles) ||
          roles.rows[0].scoped_roles !== 0) {
        throw new Error('RELOCK_SCOPED_ROLE_EXISTS_WITHOUT_CLEANUP');
      }
    }
  } catch (error) {
    readerError = error;
  }
  if (writerError) throw writerError;
  if (readerError) throw readerError;
  return {readerInstalled, writerCounts, readerCounts};
}

// Additive Task183 lane; the existing auditor credentials/timer are reused.
// Fail closed until an independently reviewed exact-source function and the
// narrow relock-only ACL are installed. No writer/signer/dispatch authority.
export async function relockTask183WithExistingAuditor(client) {
  const check=await client.query({
    text: `SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_language l ON l.oid=p.prolang
      WHERE p.oid=pg_catalog.to_regprocedure('gpt02_guard.relock_task183_preparer()')
        AND session_user='dev_gpt02_relock_catalog_auditor'
        AND l.lanname='plpgsql' AND p.prosecdef AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
        AND p.proconfig=ARRAY['search_path=pg_catalog']
        AND p.proacl::text='{postgres=X/postgres,dev_gpt02_relock_catalog_auditor=X/postgres}'
        AND pg_catalog.has_schema_privilege(session_user,'gpt02_guard','USAGE')
        AND pg_catalog.has_function_privilege(session_user,p.oid,'EXECUTE')
        AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')
          IN ('b096bd1a8258d685f0053e528b35e729ecb4eccc459aea05679e25939800cb33')
    ) AS authorized`,
    query_timeout:2500,
  });
  if(check.rows?.length!==1 || check.rows[0].authorized!==true)
    throw new Error('RELOCK_TASK183_UNVERIFIED_SCOPE_OR_GRANT');
  const reply=await client.query({
    text:'SELECT role_locked,sessions_terminated,sessions_remaining,canary_active,operational_active '+
      'FROM gpt02_guard.relock_task183_preparer()',
    query_timeout:8000,
  });
  const row=reply.rows?.[0];
  if(reply.rows?.length!==1 ||
     typeof row?.role_locked!=='boolean' ||
     !Number.isSafeInteger(row?.sessions_terminated) || row.sessions_terminated<0 ||
     !Number.isSafeInteger(row?.sessions_remaining) ||
     row.sessions_remaining<0 || row.sessions_remaining>1 ||
     typeof row?.canary_active!=='boolean' ||
     typeof row?.operational_active!=='boolean' ||
     (row.canary_active && row.operational_active) ||
     (row.role_locked && (row.canary_active || row.operational_active ||
       row.sessions_remaining!==0)) ||
     // A partial relock with no valid active window is not a healthy cycle.
     // Report failure so the existing watchdog can retry and alert.
     (!row.role_locked && !row.canary_active && !row.operational_active) ||
     ((row.canary_active || row.operational_active) && row.sessions_terminated!==0))
    throw new Error('RELOCK_TASK183_UNTRUSTED_RESULT');
  return Object.freeze({
    roleLocked:row.role_locked,
    sessionsTerminated:row.sessions_terminated,
    sessionsRemaining:row.sessions_remaining,
    canaryActive:row.canary_active,
    operationalActive:row.operational_active,
    dispatchPermitted:false,preparationAttempted:false,
  });
}

// The new lane is opt-in and must NOT starve old writer/reader cleanup.
// A fault in one lane must not prevent the other from being attempted.
// Caller receives NO_GO on any failure; missing gates never count as PASS.
export async function runCombinedRelockLanes(client,{
  task183Enabled=false,
  runLegacy=runCleanupPhases,
  runTask183=relockTask183WithExistingAuditor,
}={}) {
  let legacyResult,task183Result,legacyFailed=false,task183Failed=false;
  try { legacyResult=await runLegacy(client); }
  catch {legacyFailed=true;}
  if(task183Enabled) {
    try {task183Result=await runTask183(client);}
    catch {task183Failed=true;}
  }
  if(legacyFailed || task183Failed)
    throw new Error(legacyFailed && task183Failed ?
      'RELOCK_MULTIPLE_LANES_FAILED' :
      legacyFailed ? 'RELOCK_LEGACY_LANE_FAILED' : 'RELOCK_TASK183_LANE_FAILED');
  return Object.freeze({
    ...legacyResult,task183RelockEnabled:task183Enabled,
    task183Relock:task183Enabled?task183Result:null,
  });
}

export async function main() {
  let client;
  try {
    if (process.env.APP_ENV !== 'development') {
      throw new Error('RELOCK_EXPLICIT_DEV_MODE_REQUIRED');
    }
    const directory = process.env.CREDENTIALS_DIRECTORY;
    if (!directory?.startsWith('/run/credentials/') ||
        directory.includes('..')) {
      throw new Error('RELOCK_SYSTEMD_CREDENTIALS_REQUIRED');
    }
    const path = directory + '/' + CRED;
    const credentials = JSON.parse(readFileSync(path, { encoding: 'utf8' }));
    validateCredentials(credentials);
    const { Client } = require('/opt/gpt02-reader-runtime/node_modules/pg');
    const ca = readFileSync(CERT, 'utf8');
    client = new Client({
      host: HOST, port: 5432, database: 'postgres', user: ROLE,
      password: credentials.password,
      ssl: { ca, rejectUnauthorized: true, servername: HOST },
      application_name: 'gpt02-issue159-independent-relock-dev',
      connectionTimeoutMillis: RELOCK_TERMINATION_BUDGET.connectionTimeoutMs,
      query_timeout: RELOCK_TERMINATION_BUDGET.preflightQueryTimeoutMs,
      statement_timeout: RELOCK_TERMINATION_BUDGET.statementTimeoutMs,
    });
    await client.connect();
    const identity = await client.query(
      'SELECT session_user::text AS actor,current_database()::text AS database'
    );
    if (identity.rows.length !== 1 ||
        identity.rows[0].actor !== ROLE ||
        identity.rows[0].database !== 'postgres') {
      throw new Error('RELOCK_NATIVE_DATABASE_IDENTITY_INVALID');
    }
    const {readerInstalled, writerCounts, readerCounts,
      task183Relock,task183RelockEnabled} =
      await runCombinedRelockLanes(client,{
        task183Enabled:process.env.GPT02_TASK183_RELOCK_REUSE_ENABLED==='true'
      });
    // Preserve LIVE counts/evidence semantics: success is NOT proof that a
    // connected client backend terminated, nor authority to issue/dispatch.
    const evidence = cleanupEvidence(
      writerCounts.phaseAWindowCount, writerCounts.phaseBCleanedWindowCount
    );
    console.log(JSON.stringify({
      ...evidence,
      reason: readerInstalled ? 'RELOCK_CLEANUP_ONLY' :
        'RELOCK_WRITER_ONLY_READER_NOT_INSTALLED',
      readerPhaseAWindowCount: readerCounts?.phaseAWindowCount ?? 0,
      readerPhaseBCleanedWindowCount: readerCounts?.phaseBCleanedWindowCount ?? 0,
      readerLaneInstalled: readerInstalled,
      task183Relock,task183RelockEnabled,
    }));
    return 0;
  } catch (error) {
    // No SQL text, connection strings, passwords or raw DB errors in logs.
    const reason = typeof error?.message === 'string' &&
      error.message.startsWith('RELOCK_') ? error.message :
      'RELOCK_DATABASE_OR_CUSTODY_UNAVAILABLE';
    console.error(JSON.stringify(result(reason)));
    return 3;
  } finally {
    if (client) {
      try { await client.end(); } catch { /* fail closed */ }
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
