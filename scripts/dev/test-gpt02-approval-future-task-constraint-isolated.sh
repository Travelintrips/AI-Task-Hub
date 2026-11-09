#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NAME="gpt02-approval-boundary-$$"
WORK="$(mktemp -d)"
cleanup(){ docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
SQLFILE="$ROOT/scripts/dev/gpt02-cst-dev-approval-future-task-constraint.sql"
docker run -d --rm --name "$NAME" --network none -e POSTGRES_PASSWORD=fixture-only postgres:16-alpine >/dev/null
ready=false
for i in $(seq 1 50); do
  if docker exec "$NAME" psql -X -U postgres -d postgres -Atqc 'SELECT 1' >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
[[ "$ready" == true ]] || { echo ISOLATED_POSTGRES_NOT_READY >&2; exit 2; }
cat <<'SETUP' | docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -q >/dev/null
CREATE ROLE gpt02_store_owner NOLOGIN NOINHERIT;
CREATE ROLE dev_gpt02_attestor_evidence NOLOGIN NOINHERIT CONNECTION LIMIT 0 VALID UNTIL '1970-01-01 00:00:00+00';
CREATE ROLE dev_gpt02_issuer_evidence NOLOGIN NOINHERIT CONNECTION LIMIT 0 VALID UNTIL '1970-01-01 00:00:00+00';
CREATE ROLE gpt02_core_prep_login NOLOGIN NOINHERIT CONNECTION LIMIT 0 VALID UNTIL '2000-01-01 00:00:00+00';
CREATE SCHEMA gpt02_private AUTHORIZATION gpt02_store_owner;
SET ROLE gpt02_store_owner;
CREATE TABLE gpt02_private.approvals(task_id integer NOT NULL CHECK(task_id>0 AND task_id<>135));
CREATE TABLE gpt02_private.receipts(id integer PRIMARY KEY);
ALTER TABLE gpt02_private.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.approvals FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON gpt02_private.approvals USING(true) WITH CHECK(true);
RESET ROLE;
SETUP
run_owner(){ local db="postgres"; if [[ $# -gt 0 ]]; then db="$1"; fi;
  { printf 'SET ROLE gpt02_store_owner;\n'; cat "$SQLFILE"; } |
    docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$db" -q; }
assert_reject(){ local tag="$1" expected="$2"; shift 2;
  if "$@" >"$WORK/reject.log" 2>&1; then echo "FAIL:$tag:accepted" >&2; exit 1; fi
  grep -Fq "$expected" "$WORK/reject.log" || { echo "FAIL:$tag:wrong_error" >&2; cat "$WORK/reject.log" >&2; exit 1; };
  echo "PASS:$tag"; }
run_shared(){ docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -q < "$SQLFILE"; }
assert_reject SHARED_LOGIN_HAS_NO_OWNER_AUTH GPT02_APPROVAL_BOUNDARY_OWNER_AUTH_REQUIRED run_shared
assert_reject WRONG_DATABASE_REJECTED GPT02_APPROVAL_BOUNDARY_OWNER_AUTH_REQUIRED run_owner template1
docker exec "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -q -c 'INSERT INTO gpt02_private.approvals(task_id) VALUES (137)' >/dev/null
assert_reject EXISTING_APPROVAL_ROWS_REJECTED GPT02_APPROVAL_HISTORY_NOT_EMPTY run_owner
missing="$(docker exec "$NAME" psql -X -U postgres -d postgres -Atqc "SELECT count(*) FROM pg_constraint WHERE conname='gpt02_approvals_future_task_only'")"
[[ "$missing" == 0 ]] || { echo FAIL:ROLLBACK_NOT_INERT >&2; exit 1; }
docker exec "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -q -c 'DELETE FROM gpt02_private.approvals' >/dev/null
docker exec "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -q -c 'ALTER ROLE dev_gpt02_issuer_evidence LOGIN' >/dev/null
assert_reject ACTIVE_ISSUER_REJECTED GPT02_APPROVAL_EVIDENCE_ROLES_NOT_DORMANT run_owner
docker exec "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -q -c 'ALTER ROLE dev_gpt02_issuer_evidence NOLOGIN' >/dev/null
run_owner >/dev/null
echo PASS:OWNER_SCOPED_ADD_VALIDATED_CONSTRAINT
run_owner >/dev/null
echo PASS:IDEMPOTENT_REAPPLY
valid="$(docker exec "$NAME" psql -X -U postgres -d postgres -Atqc "SELECT count(*) FROM pg_constraint c WHERE conname='gpt02_approvals_future_task_only' AND convalidated AND regexp_replace(pg_get_expr(c.conbin,c.conrelid),'[[:space:]()]','','g')='task_id>136'")"
[[ "$valid" == 1 ]] || { echo FAIL:CHECK_NOT_VALIDATED >&2; exit 1; }
assert_reject HISTORIC_TASK_135_REJECTED approvals_task_id_check \
  docker exec "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -q -c "INSERT INTO gpt02_private.approvals(task_id) VALUES (135)"
assert_reject HISTORIC_TASK_136_REJECTED gpt02_approvals_future_task_only \
  docker exec "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -q -c "INSERT INTO gpt02_private.approvals(task_id) VALUES (136)"
docker exec "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -q -c 'INSERT INTO gpt02_private.approvals(task_id) VALUES(137)' >/dev/null
echo PASS:FUTURE_SYNTHETIC_TASK_ALLOWED
roles="$(docker exec "$NAME" psql -X -U postgres -d postgres -Atqc "SELECT count(*) FROM pg_roles WHERE rolname IN ('dev_gpt02_issuer_evidence','dev_gpt02_attestor_evidence','gpt02_core_prep_login') AND rolcanlogin=false AND rolconnlimit=0")"
[[ "$roles" == 3 ]] || { echo FAIL:ROLE_ACTIVATED >&2; exit 1; }
echo PASS:ISSUER_ATTESTOR_PREPARER_STILL_NOLOGIN
echo GPT02_APPROVAL_FUTURE_BOUNDARY_ISOLATED_PASS_NO_LIVE_CHANGES
