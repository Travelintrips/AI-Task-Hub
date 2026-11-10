#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SQL="$ROOT/scripts/dev/gpt02-two-inert-evidence-readers.sql"
NAME="gpt02-inert-readers-$RANDOM-$$"
WORK="$(mktemp -d)"
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT
IMAGE="${GPT02_READER_TEST_IMAGE:-postgres:17-alpine}"
docker run --rm -d --network none --name "$NAME" -e POSTGRES_USER=fixture_root -e POSTGRES_DB=postgres -e POSTGRES_PASSWORD=fixture-only "$IMAGE" >/dev/null
ready=false
for i in $(seq 1 40); do
 if docker exec "$NAME" psql -X -U fixture_root -d postgres -Atqc 'SELECT 1' >/dev/null 2>&1; then ready=true;break;fi
 sleep 1
done
[[ "$ready" == true ]] || { echo PG_NOT_READY;exit 2; }
run(){ docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -q -U "$1" -d postgres; }
q(){ docker exec "$NAME" psql -X -Atqc "$1" -U fixture_root -d postgres; }
v="$(q 'SHOW server_version_num')"
if [[ "$IMAGE" == 'postgres:16-alpine' ]];then [[ "$v" == 16* ]] || exit 2; echo LOCAL_PG16_SMOKE;
else [[ "$v" == 17* ]] || exit 2; echo CI_PG17_AUTHORITATIVE;fi
run fixture_root <<'SQL' >/dev/null
CREATE ROLE postgres LOGIN CREATEROLE BYPASSRLS NOSUPERUSER;
GRANT pg_read_all_data TO postgres;
CREATE ROLE gpt02_store_owner NOLOGIN NOINHERIT CONNECTION LIMIT 0;
CREATE ROLE gpt02_core_prep_owner NOLOGIN NOINHERIT CONNECTION LIMIT 0;
CREATE ROLE gpt02_core_prep_login NOLOGIN NOINHERIT CONNECTION LIMIT 0;
CREATE ROLE dev_gpt02_issuer_evidence NOLOGIN NOINHERIT CONNECTION LIMIT 0;
CREATE ROLE dev_gpt02_attestor_evidence NOLOGIN NOINHERIT CONNECTION LIMIT 0;
CREATE SCHEMA gpt02_private;
CREATE SCHEMA gpt02_stage;
CREATE SCHEMA ai_platform;
CREATE TABLE gpt02_private.approvals(id int);
CREATE TABLE gpt02_private.receipts(id int);
CREATE TABLE gpt02_private.operator_links(id int);
CREATE TABLE gpt02_private.post_consumption_fences(id int);
CREATE TABLE gpt02_stage.core_preparations(id int);
CREATE TABLE public.ai_tasks(id int);
CREATE TABLE public.ai_execution_jobs(id int);
CREATE TABLE public.team_members(id int);
CREATE TABLE public.users(id int);
CREATE TABLE public.audit_logs(id int);
CREATE TABLE ai_platform.ai_coding_tasks(id int);
CREATE TABLE ai_platform.ai_coding_runs(id int);
CREATE TABLE ai_platform.ai_coding_bridge_commands(id int);
CREATE TABLE ai_platform.internal_users(id int);
SQL
run_migration(){ { printf 'BEGIN;\n';cat "$1";printf '\nCOMMIT;\n'; } | run postgres; }
# Injected failure must roll back CREATE ROLE and leave no reader identities.
python3 - "$SQL" "$WORK/failure.sql" <<'PY'
import sys
from pathlib import Path
s=Path(sys.argv[1]).read_text()
needle="COMMENT ON ROLE gpt02_core_evidence_reader IS"
pos=s.index(needle)
s=s[:pos]+"DO $$ BEGIN RAISE EXCEPTION 'synthetic rollback after roles'; END $$;\n"+s[pos:]
Path(sys.argv[2]).write_text(s)
PY
if run_migration "$WORK/failure.sql" >"$WORK/failure.log" 2>&1;then echo ROLE_ROLLBACK_FAILED;exit 1;fi
grep -Fq 'synthetic rollback after roles' "$WORK/failure.log" || { tail -20 "$WORK/failure.log";exit 1; }
[[ "$(q "SELECT count(*) FROM pg_roles WHERE rolname IN('gpt02_hub_evidence_reader','gpt02_core_evidence_reader')")" == 0 ]] || { echo ROLE_LEAK_AFTER_ROLLBACK;exit 1; }
echo PASS:ATOMIC_ROLE_CREATION_ROLLBACK
# Pre-existing name must refuse before any mutation.
run fixture_root <<<"CREATE ROLE gpt02_hub_evidence_reader NOLOGIN;" >/dev/null
if run_migration "$SQL" >"$WORK/preexisting.log" 2>&1;then echo EXISTING_ROLE_ALLOWED;exit 1;fi
grep -Fq GPT02_INERT_READERS_BASELINE_UNSAFE "$WORK/preexisting.log" || { tail -20 "$WORK/preexisting.log";exit 1; }
run fixture_root <<<"DROP ROLE gpt02_hub_evidence_reader;" >/dev/null
echo PASS:EXISTING_ROLE_REJECTED
# Unexpected nonempty ledger blocks role creation.
run fixture_root <<<"INSERT INTO gpt02_private.approvals VALUES (1);" >/dev/null
if run_migration "$SQL" >"$WORK/nonempty.log" 2>&1;then echo NONEMPTY_HISTORY_ALLOWED;exit 1;fi
grep -Fq GPT02_INERT_READERS_CONTEXT_UNSAFE "$WORK/nonempty.log" || { tail -20 "$WORK/nonempty.log";exit 1; }
run fixture_root <<<"TRUNCATE gpt02_private.approvals;" >/dev/null
echo PASS:NONEMPTY_HISTORY_REJECTED
run_migration "$SQL" >"$WORK/success.log" 2>&1 || { tail -40 "$WORK/success.log";exit 1; }
[[ "$(q "SELECT count(*) FROM pg_authid WHERE rolname IN('gpt02_hub_evidence_reader','gpt02_core_evidence_reader') AND NOT rolcanlogin AND NOT rolinherit AND NOT(rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls OR rolreplication) AND rolconnlimit=0 AND rolpassword IS NULL AND rolvaliduntil<clock_timestamp()")" == 2 ]] || { echo READER_ROLE_FLAGS_WRONG;exit 1; }
[[ "$(q "SELECT count(*) FROM pg_auth_members WHERE member IN('gpt02_hub_evidence_reader'::regrole,'gpt02_core_evidence_reader'::regrole) OR roleid IN('gpt02_hub_evidence_reader'::regrole,'gpt02_core_evidence_reader'::regrole)")" == 0 ]] || { echo READER_MEMBERSHIP_LEAK;exit 1; }
[[ "$(q "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','ai_platform','gpt02_private','gpt02_stage') AND c.relkind='r' AND (has_table_privilege('gpt02_hub_evidence_reader',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') OR has_table_privilege('gpt02_core_evidence_reader',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))")" == 0 ]] || { echo READER_TABLE_PRIVILEGE_LEAK;exit 1; }
echo PASS:READER_NOLOGIN_NO_MEMBERSHIPS_NO_TABLE_DML
if run_migration "$SQL" >"$WORK/repeat.log" 2>&1;then echo REPEAT_APPLIED;exit 1;fi
grep -Fq GPT02_INERT_READERS_BASELINE_UNSAFE "$WORK/repeat.log" || { tail -20 "$WORK/repeat.log";exit 1; }
echo PASS:REPEAT_FAILS_CLOSED
if [[ "$IMAGE" == 'postgres:16-alpine' ]];then echo GPT02_INERT_READERS_PG16_SMOKE_PASS;else echo GPT02_INERT_READERS_PG17_PASS;fi
