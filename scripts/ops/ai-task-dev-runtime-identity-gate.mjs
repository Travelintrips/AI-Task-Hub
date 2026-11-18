/**
 * Offline, fail-closed preflight for an isolated candidate AI Task Hub DEV E2E.
 * This does NOT connect to PostgreSQL, prove TLS, grant SQL permissions, or
 * replace the legacy systemd block. It only checks a planned release's env.
 * No URL, password, user name, or hostname is ever returned or logged.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEV_PROJECT = 'xssrfshdrtdfupgqwfdw';
const EXPECTED_OPERATING_IDENTITY = 'ai_task_operational_dev.' + DEV_PROJECT;
const APPROVED_POOLER_HOST = /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/;

export function assessIsolatedDevRuntime(env) {
  const blockers = [];
  if (env.NODE_ENV !== 'development' || env.APP_ENV !== 'development') {
    blockers.push('NON_DEV_ENVIRONMENT');
  }
  if (env.DISABLE_BACKGROUND_SCHEDULERS !== 'true') {
    blockers.push('BACKGROUND_SCHEDULERS_NOT_DISABLED');
  }
  if (env.RUN_STARTUP_MIGRATIONS !== 'false') {
    blockers.push('STARTUP_MIGRATIONS_NOT_DISABLED');
  }
  if (env.DB_SSL === 'false') {
    blockers.push('TLS_EXPLICITLY_DISABLED');
  }
  const raw = env.SUPABASE_DATABASE_URL_DEV;
  if (typeof raw !== 'string' || !raw.trim()) {
    blockers.push('MISSING_DEV_DATABASE_URL');
  } else {
    try {
      const parsed = new URL(raw);
      const user = decodeURIComponent(parsed.username);
      if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) blockers.push('UNSUPPORTED_DATABASE_SCHEME');
      // A new dedicated role must be provisioned separately and independently
      // verified. Do NOT turn the existing identity-reader NOLOGIN into a writer.
      if (user !== EXPECTED_OPERATING_IDENTITY) blockers.push('UNAPPROVED_DEV_DATABASE_ROLE');
      if (!APPROVED_POOLER_HOST.test(parsed.hostname)) blockers.push('UNAPPROVED_DEV_DATABASE_HOST');
      if (parsed.port !== '6543') blockers.push('UNAPPROVED_DEV_POOLER_PORT');
      if (!parsed.password) blockers.push('MISSING_DEV_DATABASE_SECRET');
    } catch {
      blockers.push('INVALID_DEV_DATABASE_URL');
    }
  }
  const codes = [...new Set(blockers)];
  return {
    formatPass: codes.length === 0,
    // Deliberately non-authorizing: an env format cannot prove LOGIN, RLS,
    // company isolation, actual TLS certificate validation or E2E permissions.
    tlsAuthenticated: false,
    rlsIsolationProven: false,
    e2eAuthorized: false,
    blockers: codes,
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const result = assessIsolatedDevRuntime(process.env);
  console.log(result.formatPass
    ? 'AI_TASK_DEV_CANDIDATE_FORMAT_PASS — LIVE_AUTH_TLS_RLS_E2E_NOT_PROVEN'
    : 'AI_TASK_DEV_CANDIDATE_NO_GO — ' + result.blockers.join(','));
  process.exitCode = result.formatPass ? 0 : 78;
}
