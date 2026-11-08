#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="${AI_TASK_CONTAINER_NAME:-ai-task-production}"
PUBLIC_BASE_URL="${AI_TASK_PUBLIC_BASE_URL:-https://ai-task.cstlogistic.co.id}"
EXPECTED_PROJECT_ID="${AI_TASK_PROD_EXPECTED_PROJECT_ID:-nzdweipzckfszczzqtuw}"
STALE_MINUTES="${AI_TASK_LEDGER_AUDIT_STALE_MINUTES:-20}"
FAIL_ON_STALE="${AI_TASK_LEDGER_AUDIT_FAIL_ON_STALE:-true}"

if ! [[ "$STALE_MINUTES" =~ ^[1-9][0-9]*$ ]] || [ "$STALE_MINUTES" -gt 1440 ]; then
  echo "AI_TASK_LEDGER_AUDIT_ERROR=invalid_stale_minutes" >&2
  exit 64
fi
if [[ "$FAIL_ON_STALE" != "true" && "$FAIL_ON_STALE" != "false" ]]; then
  echo "AI_TASK_LEDGER_AUDIT_ERROR=invalid_fail_on_stale" >&2
  exit 64
fi
if ! docker inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
  echo "AI_TASK_LEDGER_AUDIT_ERROR=container_not_found" >&2
  exit 69
fi

probe_code() {
  local url="$1"
  curl --silent --show-error --connect-timeout 5 --max-time 15 \
    -o /dev/null -w '%{http_code}' "$url" || true
}

HEALTH_CODE="$(probe_code "${PUBLIC_BASE_URL%/}/api/healthz")"
READY_CODE="$(probe_code "${PUBLIC_BASE_URL%/}/api/readyz")"
AUDIT_ANON_CODE="$(probe_code "${PUBLIC_BASE_URL%/}/api/audit-logs")"

set +e
AUDIT_JSON="$({
  docker exec -i \
    -e AI_TASK_LEDGER_AUDIT_EXPECTED_PROJECT_ID="$EXPECTED_PROJECT_ID" \
    -e AI_TASK_LEDGER_AUDIT_STALE_MINUTES="$STALE_MINUTES" \
    -e AI_TASK_LEDGER_AUDIT_FAIL_ON_STALE="$FAIL_ON_STALE" \
    -e AI_TASK_LEDGER_AUDIT_HEALTH_CODE="$HEALTH_CODE" \
    -e AI_TASK_LEDGER_AUDIT_READY_CODE="$READY_CODE" \
    -e AI_TASK_LEDGER_AUDIT_ANON_CODE="$AUDIT_ANON_CODE" \
    -w /app/artifacts/api-server \
    "$CONTAINER_NAME" node --input-type=module - <<'NODE'
import pg from "pg";

const { Client } = pg;
const expectedProjectId = process.env.AI_TASK_LEDGER_AUDIT_EXPECTED_PROJECT_ID ?? "";
const staleMinutes = Number(process.env.AI_TASK_LEDGER_AUDIT_STALE_MINUTES ?? "20");
const failOnStale = process.env.AI_TASK_LEDGER_AUDIT_FAIL_ON_STALE === "true";
const healthCode = process.env.AI_TASK_LEDGER_AUDIT_HEALTH_CODE ?? "000";
const readyCode = process.env.AI_TASK_LEDGER_AUDIT_READY_CODE ?? "000";
const auditAnonymousCode = process.env.AI_TASK_LEDGER_AUDIT_ANON_CODE ?? "000";
const checkedAt = new Date().toISOString();

const interlockViolations = [];
const requireExact = (key, expected) => {
  if ((process.env[key] ?? "") !== expected) interlockViolations.push(`${key}_mismatch`);
};
requireExact("NODE_ENV", "production");
requireExact("RUN_STARTUP_MIGRATIONS", "false");
requireExact("AI_TASK_PROD_SOURCE_RECONCILE_ENABLED", "true");
requireExact("AI_TASK_PROD_RECONCILE_SCHEMA_READY", "true");
requireExact("AI_TASK_PROD_EXPECTED_PROJECT_ID", expectedProjectId);

if (process.env.AI_TASK_DEV_SOURCE_RECONCILE_ENABLED === "true") {
  interlockViolations.push("dev_reconciler_enabled");
}
for (const key of [
  "SUPABASE_DATABASE_URL_DEV",
  "SUPABASE_DEV_DATABASE_URL",
  "SUPABASE_PROD_DATABASE_URL",
]) {
  if ((process.env[key] ?? "").trim()) interlockViolations.push(`${key}_present`);
}

const databaseUrl = (process.env.SUPABASE_DATABASE_URL ?? "").trim();
if (!databaseUrl) interlockViolations.push("SUPABASE_DATABASE_URL_missing");
else if (!expectedProjectId || !databaseUrl.includes(expectedProjectId)) {
  interlockViolations.push("SUPABASE_DATABASE_URL_project_mismatch");
}

const bridgeToken = (process.env.AI_TASK_BRIDGE_TOKEN ?? "").trim();
const bridgeAckToken = (process.env.AI_TASK_BRIDGE_ACK_TOKEN ?? "").trim();
if (bridgeToken.length < 32) interlockViolations.push("AI_TASK_BRIDGE_TOKEN_invalid");
if (bridgeAckToken.length < 32) interlockViolations.push("AI_TASK_BRIDGE_ACK_TOKEN_invalid");
if (bridgeToken && bridgeAckToken && bridgeToken === bridgeAckToken) {
  interlockViolations.push("bridge_tokens_not_distinct");
}

const publicHealthy = healthCode === "200" && readyCode === "200" && auditAnonymousCode === "401";
const baseReport = {
  schema_version: 1,
  checked_at: checkedAt,
  stale_minutes: staleMinutes,
  fail_on_stale: failOnStale,
  public_healthy: publicHealthy,
  public_status: {
    healthz: healthCode,
    readyz: readyCode,
    audit_logs_anonymous: auditAnonymousCode,
  },
  interlock_violation_count: interlockViolations.length,
  interlock_violations: interlockViolations,
};

if (!databaseUrl) {
  console.log(JSON.stringify({
    ...baseReport,
    healthy: false,
    degraded_reasons: ["runtime_interlock"],
    database_query: "not_attempted",
  }));
  process.exit(2);
}

const client = new Client({
  connectionString: databaseUrl,
  application_name: "ai-task-ledger-prod-audit",
  statement_timeout: 15_000,
  query_timeout: 20_000,
});

try {
  await client.connect();
  await client.query("BEGIN READ ONLY");
  const { rows } = await client.query(`
    WITH canonical AS (
      SELECT 'coding-task:' || t.id::text AS external_id, t.status::text AS source_status
      FROM ai_platform.ai_coding_tasks t
      UNION ALL
      SELECT 'coding-workstream:' || w.id::text AS external_id, w.status::text AS source_status
      FROM ai_platform.ai_coding_workstreams w
    ), mapped AS (
      SELECT external_id, source_status,
        CASE source_status
          WHEN 'COMPLETED' THEN 'COMPLETED'
          WHEN 'FAILED' THEN 'FAILED'
          WHEN 'REVIEW_REQUIRED' THEN 'REVIEW_REQUIRED'
          ELSE NULL
        END AS expected_ledger_status
      FROM canonical
    ), mismatches AS (
      SELECT j.id, j.external_id, j.status AS ledger_status,
             m.source_status, m.expected_ledger_status, j.updated_at
      FROM ai_task_bridge.jobs j
      JOIN mapped m USING (external_id)
      WHERE j.source = 'AI_CORE'
        AND m.expected_ledger_status IS NOT NULL
        AND j.status <> m.expected_ledger_status
    ), review_ack_violations AS (
      SELECT j.id, j.external_id, j.callback_id,
             j.callback_received_at, j.result_verified_at, j.updated_at
      FROM ai_task_bridge.jobs j
      WHERE j.source = 'AI_CORE'
        AND j.status = 'REVIEW_REQUIRED'
        AND (
          j.callback_id IS NOT NULL OR
          j.callback_received_at IS NOT NULL OR
          j.result_verified_at IS NOT NULL OR
          EXISTS (
            SELECT 1 FROM ai_task_bridge.job_events e
            WHERE e.job_id = j.id AND e.kind = 'CALLBACK_ACK'
          )
        )
    ), stale_active AS (
      SELECT j.id, j.external_id, j.status, j.updated_at,
             EXTRACT(EPOCH FROM (now() - j.updated_at))::bigint AS age_seconds
      FROM ai_task_bridge.jobs j
      WHERE j.source = 'AI_CORE'
        AND j.status IN (
          'QUEUED', 'WAITING_FOR_WORKER', 'SUSPECTED_STALL',
          'RUNNING', 'WAITING_FOR_ACK'
        )
        AND j.updated_at < now() - make_interval(mins => $1::int)
    ), status_counts AS (
      SELECT status, count(*)::int AS count
      FROM ai_task_bridge.jobs
      WHERE source = 'AI_CORE'
      GROUP BY status
    )
    SELECT
      (SELECT count(*)::int FROM mismatches) AS mismatch_count,
      COALESCE((
        SELECT jsonb_agg(to_jsonb(m) ORDER BY m.updated_at DESC)
        FROM (SELECT * FROM mismatches ORDER BY updated_at DESC LIMIT 20) m
      ), '[]'::jsonb) AS mismatches,
      (SELECT count(*)::int FROM review_ack_violations) AS review_ack_violation_count,
      COALESCE((
        SELECT jsonb_agg(to_jsonb(v) ORDER BY v.updated_at DESC)
        FROM (SELECT * FROM review_ack_violations ORDER BY updated_at DESC LIMIT 20) v
      ), '[]'::jsonb) AS review_ack_violations,
      (SELECT count(*)::int FROM stale_active) AS stale_active_count,
      COALESCE((
        SELECT jsonb_agg(to_jsonb(s) ORDER BY s.updated_at ASC)
        FROM (SELECT * FROM stale_active ORDER BY updated_at ASC LIMIT 20) s
      ), '[]'::jsonb) AS stale_active,
      (SELECT count(*)::int FROM ai_task_bridge.jobs
       WHERE source = 'AI_CORE' AND status IN (
         'QUEUED', 'WAITING_FOR_WORKER', 'SUSPECTED_STALL',
         'RUNNING', 'WAITING_FOR_ACK'
       )) AS active_count,
      (SELECT count(*)::int FROM ai_task_bridge.jobs
       WHERE source = 'AI_CORE' AND status = 'WAITING_FOR_ACK') AS waiting_for_ack_count,
      COALESCE((SELECT jsonb_object_agg(status, count) FROM status_counts), '{}'::jsonb)
        AS ai_core_status_counts,
      (SELECT max(received_at) FROM ai_task_bridge.job_events
       WHERE sender = 'ai-task-source-reconciler') AS latest_reconciler_event_at,
      (SELECT max(received_at) FROM ai_task_bridge.job_events
       WHERE sender = 'ai-core-source-observer') AS latest_source_observer_event_at,
      (SELECT max(received_at) FROM ai_task_bridge.job_events) AS latest_bridge_event_at
  `, [staleMinutes]);
  await client.query("COMMIT");

  const row = rows[0] ?? {};
  const mismatchCount = Number(row.mismatch_count ?? 0);
  const reviewAckViolationCount = Number(row.review_ack_violation_count ?? 0);
  const staleActiveCount = Number(row.stale_active_count ?? 0);
  const degradedReasons = [];
  if (!publicHealthy) degradedReasons.push("public_readiness");
  if (interlockViolations.length > 0) degradedReasons.push("runtime_interlock");
  if (mismatchCount > 0) degradedReasons.push("ledger_mismatch");
  if (reviewAckViolationCount > 0) degradedReasons.push("review_ack_violation");
  if (failOnStale && staleActiveCount > 0) degradedReasons.push("stale_active_jobs");

  const report = {
    ...baseReport,
    healthy: degradedReasons.length === 0,
    degraded_reasons: degradedReasons,
    database_query: "ok",
    mismatch_count: mismatchCount,
    mismatches: row.mismatches ?? [],
    review_ack_violation_count: reviewAckViolationCount,
    review_ack_violations: row.review_ack_violations ?? [],
    stale_active_count: staleActiveCount,
    stale_active: row.stale_active ?? [],
    active_count: Number(row.active_count ?? 0),
    waiting_for_ack_count: Number(row.waiting_for_ack_count ?? 0),
    ai_core_status_counts: row.ai_core_status_counts ?? {},
    latest_reconciler_event_at: row.latest_reconciler_event_at ?? null,
    latest_source_observer_event_at: row.latest_source_observer_event_at ?? null,
    latest_bridge_event_at: row.latest_bridge_event_at ?? null,
  };
  console.log(JSON.stringify(report));
  process.exitCode = report.healthy ? 0 : 2;
} catch (error) {
  try { await client.query("ROLLBACK"); } catch {}
  const code = error && typeof error === "object" && "code" in error
    ? String(error.code).slice(0, 32)
    : null;
  console.log(JSON.stringify({
    ...baseReport,
    healthy: false,
    degraded_reasons: ["database_query_failed"],
    database_query: "failed",
    database_error_code: code,
  }));
  process.exitCode = 2;
} finally {
  await client.end().catch(() => undefined);
}
NODE
} 2>/dev/null)"
AUDIT_RC=$?
set -e

if [ -z "$AUDIT_JSON" ]; then
  echo "AI_TASK_LEDGER_AUDIT_ERROR=empty_audit_result" >&2
  exit 70
fi

echo "AI_TASK_LEDGER_AUDIT=$AUDIT_JSON"
exit "$AUDIT_RC"