#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NAME="gpt02-cstdev-prep-test-$$"; CID=''
trap 'if [[ -n "$CID" ]]; then docker rm -fv "$CID" >/dev/null 2>&1 || true; fi' EXIT
CID="$(docker run -d --name "$NAME" --network none -e POSTGRES_PASSWORD=synthetic-isolated-only postgres:16-alpine)"
ready=false
for _ in $(seq 1 40); do
 if docker logs "$CID" 2>&1 | grep -F 'PostgreSQL init process complete' >/dev/null &&
 docker exec "$CID" psql -X -U postgres -Atqc 'SELECT 1' 2>/dev/null | grep -Fx 1 >/dev/null; then ready=true; break; fi
 sleep 1
done
[[ "$ready" == true ]] || { echo ISOLATED_DATABASE_NOT_READY >&2; exit 2; }
docker exec -i "$CID" psql -X -U postgres -v ON_ERROR_STOP=1 -q < "$ROOT/scripts/dev/gpt02-cst-dev-evidence-preparation.sql" >/dev/null
out="$(docker exec -i "$CID" psql -X -U postgres -v ON_ERROR_STOP=1 -At <<'SQL'
SELECT 'LOCKED_ROLES',count(*)=3 AND bool_and(NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb AND rolconnlimit=0) FROM pg_roles WHERE rolname IN ('gpt02_store_owner','dev_gpt02_attestor_evidence','dev_gpt02_issuer_evidence');
SELECT 'FORCED_RLS',count(*)=2 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='gpt02_store_owner') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='gpt02_private' AND c.relkind='r';
SELECT 'ZERO_EVIDENCE',(SELECT count(*) FROM gpt02_private.approvals)=0 AND (SELECT count(*) FROM gpt02_private.receipts)=0;
SELECT 'NO_DIRECT_CANDIDATE_ACCESS',NOT has_table_privilege('dev_gpt02_issuer_evidence','gpt02_private.approvals','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AND NOT has_table_privilege('dev_gpt02_attestor_evidence','gpt02_private.receipts','SELECT,INSERT,UPDATE,DELETE,TRUNCATE');
SELECT 'NO_SCHEMA_USAGE',NOT has_schema_privilege('dev_gpt02_issuer_evidence','gpt02_private','USAGE') AND NOT has_schema_privilege('dev_gpt02_attestor_evidence','gpt02_private','USAGE');
SELECT 'NO_CONSUME_RECORD_FUNCTIONS',NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='gpt02_private' AND p.proname IN ('record_approval','consume_approval'));
SELECT 'NO_CANDIDATE_MEMBERSHIPS',NOT EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname IN ('dev_gpt02_attestor_evidence','dev_gpt02_issuer_evidence'));
SQL
)"
for label in LOCKED_ROLES FORCED_RLS ZERO_EVIDENCE NO_DIRECT_CANDIDATE_ACCESS NO_SCHEMA_USAGE NO_CONSUME_RECORD_FUNCTIONS NO_CANDIDATE_MEMBERSHIPS; do
 grep -Fx "$label|t" <<< "$out" >/dev/null || { echo "FAILED:$label" >&2; exit 1; }; echo "PASS:$label"
done
echo CST_DEV_INACTIVE_PREPARATION_7_CHECKS_PASS
