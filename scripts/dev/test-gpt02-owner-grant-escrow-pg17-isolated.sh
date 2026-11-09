#!/usr/bin/env bash
set -euo pipefail
# PostgreSQL 17 role escrow: DISPOSABLE ONLY; never point at a hosted server.
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SOURCE="$ROOT/scripts/dev/gpt02-cst-dev-approval-future-task-constraint.sql"
NAME="gpt02-pg17-owner-escrow-$$"
WORK="$(mktemp -d)"
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT
docker run -d --rm --network none --name "$NAME" -e POSTGRES_PASSWORD=synthetic-only postgres:17-alpine >/dev/null
ready=false
for i in $(seq 1 50); do
 if docker exec "$NAME" psql -X -U postgres -d postgres -Atqc "SELECT 1" >/dev/null 2>&1; then ready=true; break; fi
 sleep 1
done
[[ "$ready" == true ]] || { echo POSTGRES_17_NOT_READY >&2; exit 2; }
q(){ docker exec "$NAME" psql -X -v ON_ERROR_STOP=1 -U "$1" -d postgres -Atqc "$2"; }
run(){ docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U "$1" -d postgres -q; }
[[ "$(q postgres 'SHOW server_version_num')" == 17* ]] || { echo WRONG_POSTGRES_VERSION >&2; exit 1; }
run postgres <<'SQL' >/dev/null
CREATE ROLE supabase_admin LOGIN SUPERUSER;
CREATE ROLE gpt02_store_owner NOLOGIN NOINHERIT;
CREATE ROLE dev_gpt02_issuer_evidence NOLOGIN NOINHERIT CONNECTION LIMIT 0 VALID UNTIL '1970-01-01';
CREATE ROLE dev_gpt02_attestor_evidence NOLOGIN NOINHERIT CONNECTION LIMIT 0 VALID UNTIL '1970-01-01';
CREATE ROLE gpt02_core_prep_login NOLOGIN NOINHERIT CONNECTION LIMIT 0 VALID UNTIL '2000-01-01';
SQL
run supabase_admin <<'SQL' >/dev/null
CREATE SCHEMA gpt02_private AUTHORIZATION gpt02_store_owner;
SET ROLE gpt02_store_owner;
CREATE TABLE gpt02_private.approvals(task_id integer NOT NULL,
  CONSTRAINT approvals_task_id_check CHECK (task_id>0 AND task_id<>135));
CREATE TABLE gpt02_private.receipts(id integer PRIMARY KEY);
ALTER TABLE gpt02_private.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.approvals FORCE ROW LEVEL SECURITY;
CREATE POLICY evidence_owner_only ON gpt02_private.approvals USING(true) WITH CHECK(true);
RESET ROLE;
GRANT gpt02_store_owner TO postgres WITH ADMIN TRUE;
GRANT gpt02_store_owner TO postgres WITH SET FALSE;
GRANT gpt02_store_owner TO postgres WITH INHERIT FALSE;
ALTER ROLE postgres NOSUPERUSER CREATEROLE BYPASSRLS;
SQL
run postgres <<'SQL' >/dev/null
GRANT gpt02_store_owner TO postgres WITH SET FALSE;
GRANT gpt02_store_owner TO postgres WITH INHERIT FALSE;
SQL
member_state(){ q postgres "SELECT grantor.rolname || ':' || m.admin_option::text || ':' || m.inherit_option::text || ':' || m.set_option::text FROM pg_auth_members m JOIN pg_roles grantor ON grantor.oid=m.grantor WHERE m.roleid='gpt02_store_owner'::regrole AND m.member='postgres'::regrole ORDER BY grantor.rolname"; }
baseline="$(member_state)"
expected="$(printf 'postgres:false:false:false\nsupabase_admin:true:false:false')"
[[ "$baseline" == "$expected" ]] || { echo "UNEXPECTED_ROLE_GRANT_BASELINE:$baseline" >&2; exit 1; }
[[ "$(q postgres "SELECT NOT rolsuper AND rolcreaterole AND rolbypassrls FROM pg_roles WHERE rolname='postgres'")" == t ]] || { echo POSTGRES_SIMULATION_PRIVILEGE_MISMATCH >&2; exit 1; }
[[ "$(q postgres "SELECT pg_has_role('postgres','gpt02_store_owner','SET')")" == f ]] || { echo OWNER_SET_ALREADY_ENABLED >&2; exit 1; }
echo PASS:PG17_NON_SUPER_ROLE_WITH_EXACT_DUAL_GRANTORS
if run postgres < "$SOURCE" >"$WORK/denied.log" 2>&1; then echo DIRECT_APP_OWNER_BYPASS >&2; exit 1; fi
grep -Fq GPT02_APPROVAL_BOUNDARY_OWNER_AUTH_REQUIRED "$WORK/denied.log" || { cat "$WORK/denied.log" >&2; exit 1; }
echo PASS:APP_LOGIN_OWNER_DDL_DENIED
# Single transaction: temporarily enable SET ONLY on the self-granted
# membership. PostgreSQL17 keeps that uncommitted until final COMMIT.
cat >"$WORK/transaction.sql" <<'SQL'
BEGIN;
DO $pre$
BEGIN
 IF current_database()<>'postgres' OR current_user<>'postgres' OR session_user<>'postgres'
  OR (SELECT rolsuper OR NOT rolcreaterole FROM pg_roles WHERE rolname='postgres')
  OR pg_has_role('postgres','gpt02_store_owner','SET')
  OR pg_has_role('postgres','gpt02_store_owner','USAGE')
  OR (SELECT count(*) FROM pg_auth_members WHERE roleid='gpt02_store_owner'::regrole AND member='postgres'::regrole)<>2
  OR NOT EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.grantor
      WHERE m.roleid='gpt02_store_owner'::regrole AND m.member='postgres'::regrole
        AND g.rolname='postgres' AND NOT m.admin_option AND NOT m.inherit_option AND NOT m.set_option)
  OR NOT EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.grantor
      WHERE m.roleid='gpt02_store_owner'::regrole AND m.member='postgres'::regrole
        AND g.rolname='supabase_admin' AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option)
 THEN RAISE EXCEPTION 'BASELINE_ROLE_DRIFT'; END IF;
END $pre$;
GRANT gpt02_store_owner TO postgres WITH SET TRUE GRANTED BY postgres;
SET ROLE gpt02_store_owner;
SQL
sed -e '/^BEGIN;$/d' -e '/^COMMIT;$/d' "$SOURCE" >>"$WORK/transaction.sql"
cat >>"$WORK/transaction.sql" <<'SQL'
RESET ROLE;
REVOKE SET OPTION FOR gpt02_store_owner FROM postgres GRANTED BY postgres RESTRICT;
DO $post$
BEGIN
 IF current_user<>'postgres' OR session_user<>'postgres' OR
    pg_has_role('postgres','gpt02_store_owner','SET') OR
    pg_has_role('postgres','gpt02_store_owner','USAGE') OR
    (SELECT count(*) FROM pg_auth_members WHERE roleid='gpt02_store_owner'::regrole AND member='postgres'::regrole)<>2 OR
    EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='gpt02_store_owner'::regrole AND member='postgres'::regrole AND (set_option OR inherit_option))
 THEN RAISE EXCEPTION 'RESIDUAL_PRIVILEGE_LEAK'; END IF;
END $post$;
COMMIT;
SQL
check_restore(){ [[ "$(member_state)" == "$baseline" ]] || { echo "ROLE_GRANTS_CHANGED:$(member_state)" >&2; exit 1; }
 [[ "$(q postgres "SELECT pg_has_role('postgres','gpt02_store_owner','SET')")" == f ]] || { echo RESIDUAL_SET_OPTION >&2; exit 1; }; }
future_count(){ q postgres "SELECT count(*) FROM pg_constraint c WHERE c.conrelid='gpt02_private.approvals'::regclass AND c.conname='gpt02_approvals_future_task_only' AND c.convalidated"; }
run supabase_admin <<'SQL' >/dev/null
INSERT INTO gpt02_private.approvals(task_id) VALUES (137);
SQL
if run postgres <"$WORK/transaction.sql" >"$WORK/fail.log" 2>&1; then echo NONEMPTY_ROW_ACCEPTED >&2; exit 1; fi
grep -Fq GPT02_APPROVAL_HISTORY_NOT_EMPTY "$WORK/fail.log" || { cat "$WORK/fail.log" >&2; exit 1; }
check_restore
[[ "$(future_count)" == 0 ]] || { echo ABORTED_CONSTRAINT_PERSISTED >&2; exit 1; }
echo PASS:PG17_FAILURE_ROLLS_BACK_GRANT_AND_DDL
run supabase_admin <<'SQL' >/dev/null
DELETE FROM gpt02_private.approvals;
SQL
run postgres <"$WORK/transaction.sql" >"$WORK/pass.log" 2>&1 || { cat "$WORK/pass.log" >&2; exit 1; }
check_restore
[[ "$(future_count)" == 1 ]] || { echo CONSTRAINT_NOT_INSTALLED >&2; exit 1; }
echo PASS:PG17_ATOMIC_OWNER_CONSTRAINT_WITHOUT_GRANT_DRIFT
run postgres <"$WORK/transaction.sql" >"$WORK/reapply.log" 2>&1 || { cat "$WORK/reapply.log" >&2; exit 1; }
check_restore
[[ "$(future_count)" == 1 ]] || { echo IDEMPOTENCY_FAILED >&2; exit 1; }
echo PASS:PG17_IDEMPOTENT_REAPPLY
if run supabase_admin <<<"INSERT INTO gpt02_private.approvals(task_id) VALUES (136);" >"$WORK/task136.log" 2>&1; then echo HISTORICAL_136_ACCEPTED >&2; exit 1; fi
grep -Fq gpt02_approvals_future_task_only "$WORK/task136.log" || { cat "$WORK/task136.log" >&2; exit 1; }
run supabase_admin <<<"INSERT INTO gpt02_private.approvals(task_id) VALUES (137);" >/dev/null
echo PASS:PG17_TASK136_REJECTED_SYNTHETIC_137_ALLOWED
echo GPT02_PG17_TRANSACTIONAL_ROLE_ESCROW_OFFLINE_PASS_NOT_DEPLOYED
