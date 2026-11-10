#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FILE="$ROOT/scripts/dev/gpt02-private-operator-sidecars-inert.sql"
NAME="gpt02-inert-operator-pg17-$$"
WORK="$(mktemp -d)"
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT
IMAGE="${GPT02_FENCE_TEST_IMAGE:-postgres:17-alpine}"
docker run -d --rm --network none --name "$NAME" -e POSTGRES_USER=fixture_root -e POSTGRES_DB=postgres -e POSTGRES_PASSWORD=fixture-only "$IMAGE" >/dev/null
ready=false
for i in $(seq 1 55);do
 logs="$(docker logs "$NAME" 2>&1||true)"
 if [[ "$logs" == *'PostgreSQL init process complete'*'database system is ready to accept connections'* ]] &&
 docker exec "$NAME" psql -X -U fixture_root -d postgres -Atqc 'SELECT 1' >/dev/null 2>&1;then ready=true;break;fi
 sleep 1
done
[[ "$ready" == true ]]||{ echo PG17_NOT_READY >&2;exit 2; }
run(){ docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U "$1" -d postgres -q; }
q(){ docker exec "$NAME" psql -X -v ON_ERROR_STOP=1 -U "$1" -d postgres -Atqc "$2"; }
run_migration(){ { printf 'BEGIN;\n';cat "$1";printf '\nCOMMIT;\n'; }|run postgres; }
ver="$(q fixture_root 'SHOW server_version_num')"
if [[ "$IMAGE" == 'postgres:16-alpine' ]];then
 [[ "$ver" == 16* ]]||{ echo WRONG_PG_VERSION >&2;exit 2; }
 echo 'LOCAL_FALLBACK_PG16_NONAUTHORITATIVE'
else
 [[ "$ver" == 17* ]]||{ echo WRONG_PG_VERSION >&2;exit 2; }
 echo 'AUTHORITATIVE_PG17_FIXTURE'
fi
run fixture_root <<'SQL' >/dev/null
CREATE ROLE postgres LOGIN NOSUPERUSER CREATEROLE BYPASSRLS;
-- Match existing hosted CST-DEV: shared postgres has global read, but not write.
GRANT pg_read_all_data TO postgres;
CREATE ROLE supabase_admin LOGIN NOSUPERUSER CREATEROLE;
CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN;
CREATE ROLE gpt02_store_owner NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE CONNECTION LIMIT 0;
CREATE ROLE gpt02_core_prep_owner NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE CONNECTION LIMIT 0;
CREATE ROLE gpt02_core_prep_login NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE CONNECTION LIMIT 0;
CREATE ROLE dev_gpt02_issuer_evidence NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE CONNECTION LIMIT 0;
CREATE ROLE dev_gpt02_attestor_evidence NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE CONNECTION LIMIT 0;
CREATE SCHEMA gpt02_private AUTHORIZATION gpt02_store_owner;
CREATE SCHEMA gpt02_stage AUTHORIZATION gpt02_core_prep_owner;
CREATE SCHEMA ai_platform;
CREATE TABLE public.ai_tasks(id integer PRIMARY KEY);
CREATE TABLE public.ai_execution_jobs(id uuid PRIMARY KEY,company_id text,status text);
CREATE TABLE ai_platform.ai_coding_tasks(id uuid PRIMARY KEY,task_number text);
CREATE TABLE gpt02_stage.core_preparations(id integer PRIMARY KEY);
GRANT USAGE ON SCHEMA gpt02_private,gpt02_stage,ai_platform TO postgres;
GRANT SELECT ON gpt02_stage.core_preparations TO postgres;
SET ROLE gpt02_store_owner;
CREATE TABLE gpt02_private.approvals(command_id uuid PRIMARY KEY,task_id integer NOT NULL,
 CONSTRAINT gpt02_approvals_future_task_only CHECK(task_id>136));
CREATE TABLE gpt02_private.receipts(id uuid PRIMARY KEY,command_id uuid NOT NULL UNIQUE
 REFERENCES gpt02_private.approvals(command_id),nonce text);
ALTER TABLE gpt02_private.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.approvals FORCE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON gpt02_private.approvals TO gpt02_store_owner USING(true) WITH CHECK(true);
CREATE POLICY owner_only ON gpt02_private.receipts TO gpt02_store_owner USING(true) WITH CHECK(true);
CREATE FUNCTION gpt02_private.reject_mutation() RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $$
 BEGIN RAISE EXCEPTION 'APPEND_ONLY_EVIDENCE'; END $$;
CREATE TRIGGER immutable_approvals BEFORE UPDATE OR DELETE OR TRUNCATE ON gpt02_private.approvals
 FOR EACH STATEMENT EXECUTE FUNCTION gpt02_private.reject_mutation();
CREATE TRIGGER immutable_receipts BEFORE UPDATE OR DELETE OR TRUNCATE ON gpt02_private.receipts
 FOR EACH STATEMENT EXECUTE FUNCTION gpt02_private.reject_mutation();
RESET ROLE;
GRANT SELECT ON gpt02_private.approvals,gpt02_private.receipts TO postgres;
GRANT SELECT ON public.ai_tasks,public.ai_execution_jobs,ai_platform.ai_coding_tasks TO postgres;
GRANT gpt02_store_owner TO supabase_admin WITH ADMIN TRUE;
GRANT gpt02_store_owner TO supabase_admin WITH SET FALSE;
GRANT gpt02_store_owner TO supabase_admin WITH INHERIT FALSE;
SQL
run supabase_admin <<'SQL' >/dev/null
GRANT gpt02_store_owner TO postgres WITH ADMIN TRUE;
GRANT gpt02_store_owner TO postgres WITH SET FALSE;
GRANT gpt02_store_owner TO postgres WITH INHERIT FALSE;
SQL
run postgres <<'SQL' >/dev/null
GRANT gpt02_store_owner TO postgres WITH SET FALSE;
GRANT gpt02_store_owner TO postgres WITH INHERIT FALSE;
SQL

OPERATOR="$FILE"
FILE="$ROOT/scripts/dev/gpt02-post-consumption-fence-hosted-inert.sql"
membership(){ q postgres "SELECT g.rolname||':'||m.admin_option||':'||m.inherit_option||':'||m.set_option FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.grantor WHERE m.roleid='gpt02_store_owner'::regrole AND m.member='postgres'::regrole ORDER BY g.rolname"; }
initial="$(membership)"
[[ "$initial" == "$(printf 'postgres:false:false:false\nsupabase_admin:true:false:false')" ]] || { echo OWNER_BASELINE_BAD;exit 1; }
run_migration "$OPERATOR" >"$WORK/sidecar.log" 2>&1 || { tail -30 "$WORK/sidecar.log"; exit 1; }
[[ "$(membership)" == "$initial" ]] || { echo OPERATOR_BOOTSTRAP_GRANT_LEAK;exit 1; }
echo PASS:OPERATOR_SIDECARS_BASELINE

# Even after the transient owner SET grant, an error must roll back the table and membership.
python3 - "$FILE" "$WORK/injected.sql" <<'PY'
from pathlib import Path
import sys
s=Path(sys.argv[1]).read_text()
needle='SET ROLE gpt02_store_owner;'
assert s.count(needle)==1
Path(sys.argv[2]).write_text(s.replace(needle,needle+"\nDO $$ BEGIN RAISE EXCEPTION 'injected fence rollback'; END $$;"))
PY
if run_migration "$WORK/injected.sql" >"$WORK/injected.log" 2>&1; then echo ROLLBACK_NOT_ENFORCED;exit 1; fi
grep -Fq 'injected fence rollback' "$WORK/injected.log" || { tail -30 "$WORK/injected.log";exit 1; }
[[ "$(membership)" == "$initial" ]] || { echo GRANT_LEAK_AFTER_EXCEPTION;exit 1; }
[[ "$(q fixture_root "SELECT to_regclass('gpt02_private.post_consumption_fences') IS NULL")" == t ]] || { echo TABLE_LEAK_AFTER_EXCEPTION;exit 1; }
echo PASS:INJECTED_ROLLBACK_WITH_NO_RESIDUAL_SET_ROLE

# A nonempty approval history must fail closed, without changing pre-existing data.
run fixture_root <<<"INSERT INTO gpt02_private.approvals VALUES ('8cc32c08-f9c2-4312-b1ad-a65fd4f14e2e',137);" >/dev/null
if run_migration "$FILE" >"$WORK/history.log" 2>&1;then echo NONEMPTY_HISTORY_ACCEPTED;exit 1;fi
grep -Fq GPT02_INERT_FENCE_PREEXISTING_ACTIVITY "$WORK/history.log" || { tail -20 "$WORK/history.log";exit 1; }
[[ "$(membership)" == "$initial" ]] || { echo GRANT_LEAK_AFTER_HISTORY;exit 1; }
[[ "$(q fixture_root "SELECT to_regclass('gpt02_private.post_consumption_fences') IS NULL")" == t ]] || { echo TABLE_LEAK_AFTER_HISTORY;exit 1; }
run fixture_root <<'SQL' >/dev/null
ALTER TABLE gpt02_private.approvals DISABLE TRIGGER USER;
DELETE FROM gpt02_private.approvals;
ALTER TABLE gpt02_private.approvals ENABLE TRIGGER USER;
SQL
echo PASS:NONEMPTY_APPROVAL_REJECTED

run_migration "$FILE" >"$WORK/ok.log" 2>&1 || { tail -60 "$WORK/ok.log";exit 1; }
[[ "$(membership)" == "$initial" ]] || { echo ROLE_GRAPH_CHANGED;exit 1; }
[[ "$(q postgres "SELECT pg_has_role('postgres','gpt02_store_owner','SET')")" == f ]] || { echo OWNER_SET_ROLE_ESCAPED;exit 1; }
[[ "$(q fixture_root "SELECT c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='gpt02_store_owner' FROM pg_class c WHERE c.oid='gpt02_private.post_consumption_fences'::regclass")" == t ]] || { echo FENCE_NOT_PRIVATE;exit 1; }
[[ "$(q fixture_root "SELECT count(*) FROM pg_trigger WHERE tgrelid='gpt02_private.post_consumption_fences'::regclass AND tgname='immutable_post_consumption_fences' AND tgenabled='O'")" == 1 ]] || { echo IMMUTABILITY_TRIGGER_MISSING;exit 1; }
[[ "$(q fixture_root "SELECT count(*) FROM pg_constraint WHERE conrelid='gpt02_private.post_consumption_fences'::regclass AND contype='f'")" == 3 ]] || { echo FENCE_FOREIGN_KEYS_MISSING;exit 1; }
[[ "$(q fixture_root "SELECT count(*) FROM pg_constraint WHERE conrelid='gpt02_private.post_consumption_fences'::regclass AND contype='u'")" == 6 ]] || { echo UNIQUE_FENCES_MISSING;exit 1; }
[[ "$(q fixture_root "SELECT count(*) FROM pg_constraint WHERE conrelid='gpt02_private.post_consumption_fences'::regclass AND contype='c' AND convalidated AND (pg_get_constraintdef(oid) LIKE '%dispatch_allowed = false%' OR pg_get_constraintdef(oid) LIKE '%core_ledger_written = false%')")" == 2 ]] || { echo FALSE_ONLY_CONSTRAINTS_MISSING;exit 1; }
[[ "$(q fixture_root "SELECT count(*) FROM gpt02_private.post_consumption_fences")" == 0 ]] || { echo UNEXPECTED_FENCE_ROW;exit 1; }
[[ "$(q fixture_root "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='gpt02_private' AND p.proname='reserve_post_consumption_fence'")" == 0 ]] || { echo OPERATIONAL_FUNCTION_ENABLED;exit 1; }
[[ "$(q fixture_root "SELECT count(*) FROM pg_roles WHERE rolname IN ('gpt02_store_owner','gpt02_core_prep_owner','gpt02_core_prep_login','dev_gpt02_issuer_evidence','dev_gpt02_attestor_evidence') AND NOT rolcanlogin AND rolconnlimit=0")" == 5 ]] || { echo ROLE_ACTIVATED;exit 1; }
echo PASS:HOSTED_SHAPE_INERT_RLS_FK_UNIQUE_FALSE_ONLY_NO_LOGIN

[[ "$(q fixture_root "SELECT has_table_privilege('postgres','gpt02_private.post_consumption_fences','INSERT,UPDATE,DELETE,TRUNCATE')::text || ':' || has_table_privilege('dev_gpt02_issuer_evidence','gpt02_private.post_consumption_fences','SELECT,INSERT,UPDATE,DELETE')::text || ':' || has_table_privilege('dev_gpt02_attestor_evidence','gpt02_private.post_consumption_fences','SELECT,INSERT,UPDATE,DELETE')::text")" == false:false:false ]] || { echo FENCE_GRANTS_LEAKED;exit 1; }
echo PASS:NO_ISSUER_OR_APPLICATION_DML

# Trigger prevents mutation even under synthetic bootstrap superuser.
if run fixture_root <<<"UPDATE gpt02_private.post_consumption_fences SET worker_id='other';" >"$WORK/update.log" 2>&1;then echo UPDATE_PERMITTED;exit 1;fi
grep -Fq APPEND_ONLY_EVIDENCE "$WORK/update.log" || { tail -15 "$WORK/update.log";exit 1; }
if run fixture_root <<<"TRUNCATE gpt02_private.post_consumption_fences;" >"$WORK/truncate.log" 2>&1;then echo TRUNCATE_PERMITTED;exit 1;fi
grep -Fq APPEND_ONLY_EVIDENCE "$WORK/truncate.log" || { tail -15 "$WORK/truncate.log";exit 1; }
echo PASS:APPEND_ONLY_UPDATE_AND_TRUNCATE

if run_migration "$FILE" >"$WORK/duplicate.log" 2>&1;then echo DUPLICATE_NOT_REJECTED;exit 1;fi
grep -Fq GPT02_INERT_FENCE_ALREADY_EXISTS "$WORK/duplicate.log" || { tail -20 "$WORK/duplicate.log";exit 1; }
[[ "$(membership)" == "$initial" ]] || { echo RETRY_GRANTED_SET_ROLE;exit 1; }
echo PASS:REPEATED_MIGRATION_FAIL_CLOSED
echo GPT02_HOSTED_INERT_FENCE_PG17_PASS
