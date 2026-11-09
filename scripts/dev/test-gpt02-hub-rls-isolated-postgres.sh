#!/usr/bin/env bash
set -euo pipefail
# Synthetic network-isolated PostgreSQL only. Never connects to CST-DEV/PROD.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NAME="gpt02-rls-policy-test-$$"
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
docker run -d --rm --name "$NAME" --network none -e POSTGRES_PASSWORD=isolated-only postgres:16-alpine >/dev/null
ready=false
for i in $(seq 1 60); do
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
RESET ROLE;
SQL
} | docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -At > /tmp/gpt02-rls-result-"$$".txt
result="$(cat /tmp/gpt02-rls-result-"$$".txt)"
rm -f /tmp/gpt02-rls-result-"$$".txt
for name in NO_CONTEXT TENANT_A CROSS_TENANT_UNSEEN TENANT_B; do
 grep -Fqx "$name|t" <<< "$result" || { echo "FAILED:$name"; exit 1; }
done
echo "ISOLATED_RLS_4_OF_4_PASS"
echo "WARNING: GUC spoofing by arbitrary SQL remains possible; middleware trust is NOT proven"
