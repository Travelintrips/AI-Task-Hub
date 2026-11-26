#!/usr/bin/env bash
set -euo pipefail
# Synthetic network-isolated PostgreSQL only. Never connects to CST-DEV/PROD.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NAME="gpt02-rls-policy-test-$$"
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
docker run -d --rm --name "$NAME" --network none -e POSTGRES_PASSWORD=isolated-only postgres:16-alpine >/dev/null
ready=false
for i in $(seq 1 60); do
 # The official image starts a temporary initdb server, stops it, then starts
 # the final server. Waiting on SELECT 1 alone races that temporary shutdown.
 if ! docker logs "$NAME" 2>&1 | grep -q 'PostgreSQL init process complete'; then
  sleep 1
  continue
 fi
 if docker exec "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -Atqc 'SELECT 1' 2>/dev/null | grep -qx 1; then
  ready=true
  break
 fi
 sleep 1
done
if [[ "$ready" != true ]]; then
 docker logs --tail 30 "$NAME" >&2 || true
 echo "ISOLATED_POSTGRES_NOT_READY" >&2
 exit 2
fi
{
 cat "$ROOT/scripts/dev/gpt02-hub-rls-isolated-prototype.sql"
 cat <<'SQL'
SET ROLE gpt02_rls_test_app;
SELECT 'NO_CONTEXT', (SELECT count(*) FROM gpt02_rls_test.ai_tasks)=0 AND (SELECT count(*) FROM gpt02_rls_test.audit_logs)=0;
BEGIN;
SELECT set_config('app.company_id','tenant_a',true);
SELECT 'TENANT_A', (SELECT count(*) FROM gpt02_rls_test.ai_tasks)=1 AND (SELECT count(*) FROM gpt02_rls_test.ai_execution_jobs)=1 AND (SELECT count(*) FROM gpt02_rls_test.team_members)=1 AND (SELECT count(*) FROM gpt02_rls_test.audit_logs)=1;
UPDATE gpt02_rls_test.ai_tasks SET title='cross-tenant' WHERE id=2;
SELECT 'CROSS_TENANT_UNSEEN', (SELECT count(*) FROM gpt02_rls_test.ai_tasks WHERE id=2)=0;
ROLLBACK;
BEGIN;
SELECT set_config('app.company_id','tenant_b',true);
SELECT 'TENANT_B', (SELECT count(*) FROM gpt02_rls_test.ai_tasks)=1 AND (SELECT count(*) FROM gpt02_rls_test.audit_logs)=1;
ROLLBACK;
-- This reproduces the limitation, it is NOT a security PASS:
-- a role able to execute arbitrary SQL can reassign an application GUC.
BEGIN;
SELECT set_config('app.company_id','tenant_b',true);
SELECT 'GUC_SPOOFABLE', (SELECT count(*) FROM gpt02_rls_test.ai_tasks WHERE id=2)=1;
ROLLBACK;
RESET ROLE;
SQL
 cat "$ROOT/scripts/dev/gpt02-hub-identity-rls-isolated.sql"
} | docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -At > /tmp/gpt02-rls-result-"$$".txt
result="$(cat /tmp/gpt02-rls-result-"$$".txt)"
rm -f /tmp/gpt02-rls-result-"$$".txt
for name in NO_CONTEXT TENANT_A CROSS_TENANT_UNSEEN TENANT_B GUC_SPOOFABLE TENANT_A_ROLE_FENCED TENANT_A_GUC_CANNOT_ESCALATE TENANT_A_NO_ADMIN_MEMBERSHIP TENANT_B_ROLE_FENCED ADMIN_READ_TWO_TENANTS ADMIN_AUDIT_NULL_LEGACY ADMIN_NO_INSERT_PRIVILEGE; do
 grep -Fqx "$name|t" <<< "$result" || { echo "FAILED:$name"; exit 1; }
done
echo "ISOLATED_RLS_BASELINE_4_OF_4_PASS; ROLE_IDENTITY_7_OF_7_PASS"
echo "BLOCKER_GUC_SPOOFABLE_CONFIRMED; tenant RLS is NOT live-migration-ready"
