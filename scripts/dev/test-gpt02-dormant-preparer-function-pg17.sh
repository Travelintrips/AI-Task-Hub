#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FILE="$ROOT/scripts/dev/gpt02-dormant-preparer-function-locked.sql"
NAME="gpt02-dormant-fn-pg17-$$"
WORK="$(mktemp -d)"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1||true;rm -rf "$WORK"; }
trap cleanup EXIT
node "$ROOT/scripts/dev/generate-gpt02-dormant-preparer.cjs" --check
NODE_IMAGE="${GPT02_DORMANT_TEST_IMAGE:-postgres:17-alpine}"
[[ "$NODE_IMAGE" == "postgres:17-alpine" || "$NODE_IMAGE" == "postgres:16-alpine" ]] || { echo UNSUPPORTED_TEST_IMAGE >&2;exit 2; }
docker run -d --name "$NAME" --network none -e POSTGRES_USER=fixture_root -e POSTGRES_DB=postgres -e POSTGRES_PASSWORD=synthetic-only "$NODE_IMAGE" >/dev/null
ready=false
for i in $(seq 1 55);do
 log="$(docker logs "$NAME" 2>&1||true)"
 if [[ "$log" == *'PostgreSQL init process complete'* ]] && [[ "${log#*PostgreSQL init process complete}" == *'database system is ready to accept connections'* ]] &&
 docker exec "$NAME" psql -X -U fixture_root -d postgres -Atqc 'SELECT 1' >/dev/null 2>&1;then ready=true;break;fi
 sleep 1
done
[[ "$ready" == true ]]|| { echo POSTGRES_17_NOT_READY >&2; exit 3; }
q(){ docker exec "$NAME" psql -X -v ON_ERROR_STOP=1 -U "$1" -d postgres -Atqc "$2"; }
run(){ docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U "$1" -d postgres -q; }
# The Supabase migration manager supplies BEGIN/COMMIT. Mirror that in psql:
# the SQL source MUST NOT commit early or migration history can be left behind.
run_migration(){ { printf 'BEGIN;\n';cat "$1";printf '\nCOMMIT;\n'; } | run postgres; }
version="$(q fixture_root 'SHOW server_version_num')"
if [[ "$NODE_IMAGE" == "postgres:17-alpine" ]];then [[ "$version" == 17* ]]|| { echo WRONG_POSTGRES_VERSION >&2;exit 2; };else [[ "$version" == 16* ]]|| { echo WRONG_POSTGRES_VERSION >&2;exit 2; };fi
run fixture_root <<'SQL' >/dev/null
CREATE ROLE postgres LOGIN CREATEROLE BYPASSRLS NOSUPERUSER NOINHERIT;
CREATE ROLE supabase_admin LOGIN CREATEROLE NOSUPERUSER;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE ROLE gpt02_core_prep_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 0 PASSWORD NULL;
CREATE ROLE gpt02_core_prep_login NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 0 PASSWORD NULL VALID UNTIL '2000-01-01';
GRANT gpt02_core_prep_owner TO supabase_admin WITH ADMIN TRUE;
CREATE SCHEMA ai_platform;
CREATE TABLE public.ai_execution_jobs(id uuid PRIMARY KEY,company_id text,status text);
CREATE TABLE ai_platform.ai_coding_tasks(id uuid PRIMARY KEY);
CREATE SCHEMA gpt02_private;
CREATE TABLE gpt02_private.approvals(task_id integer CONSTRAINT gpt02_approvals_future_task_only CHECK(task_id>136));
CREATE TABLE gpt02_private.receipts(id uuid PRIMARY KEY);
CREATE SCHEMA gpt02_stage AUTHORIZATION gpt02_core_prep_owner;
CREATE TABLE gpt02_stage.core_preparations(
 company_id text NOT NULL CHECK(company_id='default'),hub_task_id integer NOT NULL CHECK(hub_task_id>136),
 member_id integer NOT NULL,member_audit_id integer NOT NULL,operator_subject text NOT NULL,
 core_task_id uuid NOT NULL UNIQUE REFERENCES ai_platform.ai_coding_tasks(id),
 hub_execution_id uuid NOT NULL UNIQUE REFERENCES public.ai_execution_jobs(id),
 command_candidate_id uuid NOT NULL UNIQUE,attempt_id uuid NOT NULL UNIQUE,config_sha256 text NOT NULL,
 expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(company_id,hub_task_id));
ALTER TABLE gpt02_stage.core_preparations OWNER TO gpt02_core_prep_owner;
ALTER TABLE gpt02_stage.core_preparations ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_stage.core_preparations FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON gpt02_stage.core_preparations TO gpt02_core_prep_owner USING(true) WITH CHECK(true);
-- Mirror hosted CST-DEV: shared maintenance postgres has read-only catalog/table
-- visibility; the dormant preparer owner does NOT get Hub/Core parent table DML.
GRANT USAGE ON SCHEMA gpt02_stage,gpt02_private,ai_platform TO postgres;
GRANT SELECT ON gpt02_stage.core_preparations,gpt02_private.approvals,gpt02_private.receipts TO postgres;
ALTER TABLE public.ai_execution_jobs OWNER TO postgres;
ALTER TABLE ai_platform.ai_coding_tasks OWNER TO postgres;
SQL
run supabase_admin <<'SQL' >/dev/null
GRANT gpt02_core_prep_owner TO postgres WITH ADMIN TRUE;
GRANT gpt02_core_prep_owner TO postgres WITH SET FALSE;
GRANT gpt02_core_prep_owner TO postgres WITH INHERIT FALSE;
SQL
snapshot() { q postgres "SELECT g.rolname||':'||m.admin_option::text||':'||m.inherit_option::text||':'||m.set_option::text FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.grantor WHERE m.roleid='gpt02_core_prep_owner'::regrole AND m.member='postgres'::regrole ORDER BY g.rolname"; }
initial="$(snapshot)"
[[ "$initial" == 'supabase_admin:true:false:false' ]]|| { echo "BAD_OWNER_BASELINE:$initial" >&2; exit 1; }
[[ "$(q postgres "SELECT pg_has_role('postgres','gpt02_core_prep_owner','SET')")" == f ]]|| { echo OWNER_ALREADY_USABLE >&2; exit 1; }
echo PASS:PG17_ADMIN_ONLY_OWNER_MEMBERSHIP_INERT
# A failed attempt inside a transaction must roll back its temporary SET grant.
python3 - "$FILE" "$WORK/error-injected.sql" <<'PY'
from pathlib import Path
import sys
s=Path(sys.argv[1]).read_text()
old='SET ROLE gpt02_core_prep_owner;\n'
assert s.count(old)==1
Path(sys.argv[2]).write_text(s.replace(old,old+"DO $$ BEGIN RAISE EXCEPTION 'synthetic rollback proof'; END $$;\n"))
PY
if run_migration "$WORK/error-injected.sql" >"$WORK/aborted.log" 2>&1;then echo FAILED_TO_ROLLBACK >&2; exit 1;fi
grep -Fq 'synthetic rollback proof' "$WORK/aborted.log"|| { tail -20 "$WORK/aborted.log" >&2; exit 1; }
[[ "$(snapshot)" == "$initial" ]]|| { echo OWNER_GRANT_LEAK_AFTER_ROLLBACK >&2; exit 1; }
[[ "$(q postgres "SELECT count(*) FROM pg_proc WHERE pronamespace='gpt02_stage'::regnamespace AND proname='prepare_core_task_dormant'")" == 0 ]]|| { echo FUNCTION_SURVIVED_ABORT >&2; exit 1; }
echo PASS:PG17_ROLE_ESCROW_ROLLS_BACK_WITH_FUNCTION
# Approval evidence appearing before migration must fail closed without grants.
run fixture_root <<<"INSERT INTO gpt02_private.approvals(task_id) VALUES(137);" >/dev/null
if run_migration "$FILE" >"$WORK/nonempty.log" 2>&1;then echo NONEMPTY_APPROVAL_ACCEPTED >&2; exit 1;fi
grep -Fq GPT02_DORMANT_PREPARER_STAGING_OR_TASK_BOUNDARY_CHANGED "$WORK/nonempty.log"|| { tail -15 "$WORK/nonempty.log"; exit 1; }
[[ "$(snapshot)" == "$initial" ]]|| { echo OWNER_GRANT_LEAK_AFTER_PRECHECK >&2; exit 1; }
run fixture_root <<'SQL' >/dev/null
DELETE FROM gpt02_private.approvals;
SQL
echo PASS:PG17_NONEMPTY_APPROVALS_DENIED
run_migration "$FILE" >"$WORK/created.log" 2>&1|| { tail -45 "$WORK/created.log" >&2; exit 1; }
[[ "$(snapshot)" == "$initial" ]]|| { echo OWNER_GRANT_GRAPH_CHANGED >&2; exit 1; }
[[ "$(q postgres "SELECT pg_has_role('postgres','gpt02_core_prep_owner','SET')")" == f ]]|| { echo OWNER_SET_RETAINED >&2; exit 1; }
echo PASS:PG17_FUNCTION_CREATED_WITH_OWNER_GRANTS_RESTORED
# The future Supabase ledger repair is a verification-only migration: it must
# accept the exact existing body and refuse a changed hash without writes.
ATTEST="$ROOT/scripts/dev/gpt02-dormant-function-existing-state-attestation.sql"
run postgres < "$ATTEST" >"$WORK/attested.log" 2>&1 || { tail -25 "$WORK/attested.log" >&2;exit 1; }
python3 - "$ATTEST" "$WORK/attestation-tampered.sql" <<'PYI'
from pathlib import Path
import sys
s=Path(sys.argv[1]).read_text();old='b18275516add255e76f31414a28732bdd900b556b10f38d42e2e4bdf9f7415d4'
assert s.count(old)==1
Path(sys.argv[2]).write_text(s.replace(old,'0'*64))
PYI
if run postgres <"$WORK/attestation-tampered.sql" >"$WORK/bad-attest.log" 2>&1;then echo TAMPERED_ATTESTATION_ACCEPTED >&2;exit 1;fi
grep -Fq GPT02_DORMANT_VERIFICATION_BODY_OR_OWNER_MISMATCH "$WORK/bad-attest.log" || { tail -20 "$WORK/bad-attest.log"; exit 1; }
echo PASS:PG17_READONLY_ATTESTATION_EXACT_BODY_AND_TAMPER_REJECTION
# Catalog verification from privileged fixture root; all runtime principals fail.
actual="$(q fixture_root "SELECT p.prosecdef::text||':'||pg_get_userbyid(p.proowner)||':'||(SELECT count(*) FROM pg_proc WHERE pronamespace=p.pronamespace AND proname='prepare_core_task')::text||':'||has_function_privilege('postgres',p.oid,'EXECUTE')::text||':'||has_function_privilege('anon',p.oid,'EXECUTE')::text||':'||has_function_privilege('authenticated',p.oid,'EXECUTE')::text||':'||has_function_privilege('service_role',p.oid,'EXECUTE')::text||':'||has_function_privilege('gpt02_core_prep_login',p.oid,'EXECUTE')::text FROM pg_proc p WHERE p.pronamespace='gpt02_stage'::regnamespace AND p.proname='prepare_core_task_dormant'")"
[[ "$actual" == 'true:gpt02_core_prep_owner:0:false:false:false:false:false' ]]|| { echo "FUNCTION_PRIVILEGE_INVALID:$actual" >&2; exit 1; }
other="$(q fixture_root "SELECT (SELECT count(*) FROM gpt02_stage.core_preparations)||':'||(SELECT count(*) FROM ai_platform.ai_coding_tasks)||':'||(SELECT count(*) FROM public.ai_execution_jobs)||':'||has_table_privilege('gpt02_core_prep_owner','public.ai_execution_jobs','SELECT,INSERT,UPDATE,DELETE,REFERENCES')::text||':'||has_table_privilege('gpt02_core_prep_owner','ai_platform.ai_coding_tasks','SELECT,INSERT,UPDATE,DELETE,REFERENCES')::text||':'||has_schema_privilege('gpt02_core_prep_login','gpt02_stage','USAGE')::text")"
[[ "$other" == '0:0:0:false:false:false' ]]|| { echo "LIVE_TABLE_GRANT_OR_DATA_LEAK:$other" >&2; exit 1; }
echo PASS:PG17_ZERO_ROLE_EXECUTE_ZERO_PARENT_DML_ZERO_NEW_TASKS
if run_migration "$FILE" >"$WORK/reapply.log" 2>&1;then echo REAPPLIED_UNSAFE_FUNCTION >&2; exit 1;fi
grep -Fq GPT02_DORMANT_PREPARER_STAGING_OR_TASK_BOUNDARY_CHANGED "$WORK/reapply.log"|| { tail -12 "$WORK/reapply.log" >&2; exit 1; }
[[ "$(snapshot)" == "$initial" ]]|| { echo ROLE_ESCROW_LEAK_AFTER_REAPPLY >&2; exit 1; }
echo PASS:PG17_DUPLICATE_DORMANT_FUNCTION_DENIED
if run postgres <<<"SELECT * FROM gpt02_stage.prepare_core_task_dormant('default',137,'GPT02 DEV coding lifecycle','Travelintrips/Core-AI-Foundation','develop','test')" >"$WORK/blocked.log" 2>&1;then echo UNAUTHORIZED_FUNCTION_CALL_SUCCEEDED >&2; exit 1;fi
[[ "$(snapshot)" == "$initial" ]]|| { echo ROLE_CHANGED_AFTER_DENIAL >&2; exit 1; }
echo PASS:PG17_POSTGRES_CANNOT_CALL_DORMANT_FUNCTION
printf 'GPT02_DORMANT_PREPARER_PG17_PASS: NO_DISPATCH_NO_LOGIN_NO_RUNTIME_DML\n'

# Additional gate: prove the narrow future parent grants do not activate either
# the preparer login or the unreachable SECURITY DEFINER function. Synthetic DB only.
CANDIDATE="$ROOT/scripts/dev/gpt02-preparer-parent-grants-offline-candidate.sql"
run fixture_root <<'SQL' >/dev/null
CREATE ROLE dev_gpt02_issuer_evidence NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE CONNECTION LIMIT 0;
CREATE ROLE dev_gpt02_attestor_evidence NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE CONNECTION LIMIT 0;
ALTER SCHEMA ai_platform OWNER TO postgres;
CREATE SCHEMA extensions AUTHORIZATION postgres;
CREATE TABLE public.ai_tasks(id integer);
CREATE TABLE public.team_members(id integer);
CREATE TABLE public.audit_logs(id integer);
CREATE TABLE public.users(id text);
CREATE TABLE ai_platform.ai_coding_runs(id uuid);
CREATE TABLE ai_platform.ai_coding_bridge_commands(id uuid);
ALTER TABLE public.ai_tasks OWNER TO postgres;
ALTER TABLE public.team_members OWNER TO postgres;
ALTER TABLE public.audit_logs OWNER TO postgres;
ALTER TABLE public.users OWNER TO postgres;
ALTER TABLE ai_platform.ai_coding_runs OWNER TO postgres;
ALTER TABLE ai_platform.ai_coding_bridge_commands OWNER TO postgres;
ALTER TABLE public.ai_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_execution_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.ai_coding_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.ai_coding_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.ai_coding_bridge_commands ENABLE ROW LEVEL SECURITY;
CREATE POLICY gpt02_preparer_hub_task_read ON public.ai_tasks FOR SELECT TO gpt02_core_prep_owner USING(false);
CREATE POLICY gpt02_preparer_pic_read ON public.team_members FOR SELECT TO gpt02_core_prep_owner USING(false);
CREATE POLICY gpt02_preparer_pic_audit_read ON public.audit_logs FOR SELECT TO gpt02_core_prep_owner USING(false);
CREATE POLICY gpt02_preparer_operator_read ON public.users FOR SELECT TO gpt02_core_prep_owner USING(false);
CREATE POLICY gpt02_preparer_hub_execution_read ON public.ai_execution_jobs FOR SELECT TO gpt02_core_prep_owner USING(false);
CREATE POLICY gpt02_preparer_hub_execution_insert ON public.ai_execution_jobs FOR INSERT TO gpt02_core_prep_owner WITH CHECK(false);
CREATE POLICY gpt02_preparer_core_task_read ON ai_platform.ai_coding_tasks FOR SELECT TO gpt02_core_prep_owner USING(false);
CREATE POLICY gpt02_preparer_core_task_insert ON ai_platform.ai_coding_tasks FOR INSERT TO gpt02_core_prep_owner WITH CHECK(false);
CREATE POLICY gpt02_preparer_core_runs_read ON ai_platform.ai_coding_runs FOR SELECT TO gpt02_core_prep_owner USING(false);
CREATE POLICY gpt02_preparer_core_commands_read ON ai_platform.ai_coding_bridge_commands FOR SELECT TO gpt02_core_prep_owner USING(false);
SQL
# A real PostgreSQL transaction failure AFTER all GRANT statements must roll back
# schema and relation grants, leaving the role graph and function ACL unchanged.
if { printf 'BEGIN;\nSET LOCAL gpt02.offline_grant_fixture = yes;\n'; cat "$CANDIDATE";
     cat <<'SQL'
DO $$ BEGIN RAISE EXCEPTION 'injected grant rollback'; END $$;
COMMIT;
SQL
     } \
    | run postgres >"$WORK/grants-rollback.log" 2>&1; then
 echo FAILED_TO_ROLLBACK_CANDIDATE_GRANTS >&2; exit 1
fi
grep -Fq 'injected grant rollback' "$WORK/grants-rollback.log" || { tail -20 "$WORK/grants-rollback.log"; exit 1; }
[[ "$(q postgres "SELECT has_table_privilege('gpt02_core_prep_owner','public.ai_execution_jobs','INSERT')")" == f ]] || { echo GRANT_LEAK_AFTER_ROLLBACK >&2; exit 1; }
[[ "$(q postgres "SELECT has_schema_privilege('gpt02_core_prep_owner','ai_platform','USAGE')")" == f ]] || { echo SCHEMA_GRANT_LEAK_AFTER_ROLLBACK >&2; exit 1; }
echo PASS:PG_PARENT_GRANT_ATOMIC_ROLLBACK_WITHOUT_ESCALATION
# A stale/missing offline-only marker is rejected BEFORE any GRANT.
if { printf 'BEGIN;\n'; cat "$CANDIDATE"; printf '\nCOMMIT;\n'; } | run postgres >"$WORK/grants-target-denied.log" 2>&1;then
 echo UNSCOPED_GRANT_SCRIPT_ACCEPTED >&2;exit 1
fi
grep -Fq GPT02_OFFLINE_GRANT_TARGET_DENIED "$WORK/grants-target-denied.log" || { tail -20 "$WORK/grants-target-denied.log";exit 1; }
echo PASS:PG_PARENT_GRANTS_REJECT_NON_FIXTURE_CONTEXT
# Removing RLS from even one parent must reject the grant without partial DML.
run fixture_root <<<"ALTER TABLE public.ai_tasks DISABLE ROW LEVEL SECURITY;" >/dev/null
if { printf 'BEGIN;\nSET LOCAL gpt02.offline_grant_fixture = yes;\n'; cat "$CANDIDATE"; printf '\nCOMMIT;\n'; } | run postgres >"$WORK/grants-no-rls.log" 2>&1;then
 echo GRANT_WITH_DISABLED_PARENT_RLS >&2;exit 1
fi
grep -Fq GPT02_OFFLINE_GRANT_PARENT_BASELINE_CHANGED "$WORK/grants-no-rls.log" || { tail -20 "$WORK/grants-no-rls.log";exit 1; }
run fixture_root <<<"ALTER TABLE public.ai_tasks ENABLE ROW LEVEL SECURITY;" >/dev/null
[[ "$(q postgres "SELECT has_table_privilege('gpt02_core_prep_owner','ai_platform.ai_coding_tasks','INSERT')")" == f ]] || { echo GRANT_LEAK_AFTER_RLS_DENIAL >&2;exit 1; }
echo PASS:PG_PARENT_GRANTS_REJECT_DISABLED_RLS
# A future approval already present changes the baseline, so don't allow GRANT.
run fixture_root <<<"INSERT INTO gpt02_private.approvals(task_id) VALUES(137);" >/dev/null
if { printf 'BEGIN;\nSET LOCAL gpt02.offline_grant_fixture = yes;\n'; cat "$CANDIDATE"; printf '\nCOMMIT;\n'; } | run postgres >"$WORK/grants-nonempty.log" 2>&1;then
 echo GRANT_WITH_NONEMPTY_APPROVALS >&2;exit 1
fi
grep -Fq GPT02_OFFLINE_GRANT_SECURITY_BASELINE_CHANGED "$WORK/grants-nonempty.log" || { tail -20 "$WORK/grants-nonempty.log";exit 1; }
run fixture_root <<<"DELETE FROM gpt02_private.approvals;" >/dev/null
echo PASS:PG_PARENT_GRANTS_REJECT_EXISTING_APPROVAL
{ printf 'BEGIN;\nSET LOCAL gpt02.offline_grant_fixture = yes;\n'; cat "$CANDIDATE"; printf '\nCOMMIT;\n'; } \
 | run postgres >"$WORK/grants-positive.log" 2>&1 || { tail -25 "$WORK/grants-positive.log";exit 1; }
[[ "$(q postgres "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE ((n.nspname='public' AND c.relname IN ('ai_tasks','team_members','audit_logs','users','ai_execution_jobs'))
OR (n.nspname='ai_platform' AND c.relname IN ('ai_coding_tasks','ai_coding_runs','ai_coding_bridge_commands')))
AND has_table_privilege('gpt02_core_prep_owner',c.oid,'SELECT')")" == 8 ]] || { echo OWNER_MINIMUM_PARENT_READ_INCOMPLETE >&2; exit 1; }
[[ "$(q postgres "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE ((n.nspname='public' AND c.relname IN ('ai_tasks','team_members','audit_logs','users','ai_execution_jobs'))
OR (n.nspname='ai_platform' AND c.relname IN ('ai_coding_tasks','ai_coding_runs','ai_coding_bridge_commands')))
AND has_table_privilege('gpt02_core_prep_owner',c.oid,'INSERT')")" == 2 ]] || { echo OWNER_INSERT_SCOPE_TOO_WIDE >&2; exit 1; }
[[ "$(q postgres "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE ((n.nspname='public' AND c.relname IN ('ai_tasks','team_members','audit_logs','users','ai_execution_jobs'))
OR (n.nspname='ai_platform' AND c.relname IN ('ai_coding_tasks','ai_coding_runs','ai_coding_bridge_commands')))
AND has_table_privilege('gpt02_core_prep_owner',c.oid,'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')")" == 0 ]] || { echo OWNER_UNNECESSARY_WRITE_ESCALATION >&2; exit 1; }
[[ "$(q postgres "SELECT (SELECT count(*) FROM gpt02_stage.core_preparations)||':'||(SELECT count(*) FROM public.ai_execution_jobs)||':'||(SELECT count(*) FROM ai_platform.ai_coding_tasks)||':'||(SELECT count(*) FROM gpt02_private.approvals)||':'||(SELECT count(*) FROM gpt02_private.receipts)")" == '0:0:0:0:0' ]] || { echo GRANTS_CREATED_UNEXPECTED_DATA >&2; exit 1; }
[[ "$(q postgres "SELECT rolcanlogin::text||':'||has_function_privilege('gpt02_core_prep_login','gpt02_stage.prepare_core_task_dormant(text,integer,text,text,text,text)','EXECUTE')::text||':'||has_schema_privilege('gpt02_core_prep_login','gpt02_stage','USAGE')::text FROM pg_roles WHERE rolname='gpt02_core_prep_login'")" == 'false:false:false' ]] || { echo RUNTIME_LOGIN_ENABLED_BY_GRANT >&2; exit 1; }
[[ "$(snapshot)" == "$initial" ]] || { echo OWNER_MEMBERSHIP_DRIFT_AFTER_GRANTS >&2; exit 1; }
echo PASS:PG_PARENT_GRANTS_EXACT_8_SELECT_2_INSERT_ZERO_RUNTIME_AUTHORITY
# Re-applying a grant candidate must fail, not silently widen permissions.
if { printf 'BEGIN;\nSET LOCAL gpt02.offline_grant_fixture = yes;\n'; cat "$CANDIDATE";printf '\nCOMMIT;\n'; } | run postgres >"$WORK/grants-repeat.log" 2>&1;then
 echo REAPPLIED_PARENT_GRANTS_WITHOUT_REVIEW >&2;exit 1
fi
grep -Fq GPT02_OFFLINE_GRANT_PARENT_BASELINE_CHANGED "$WORK/grants-repeat.log" || { tail -20 "$WORK/grants-repeat.log";exit 1; }
echo PASS:PG_PARENT_GRANT_REPEAT_FAIL_CLOSED
printf 'GPT02_DORMANT_PREPARER_MINIMAL_GRANTS_OFFLINE_PASS_NO_LOGIN_NO_COMMAND\n'
