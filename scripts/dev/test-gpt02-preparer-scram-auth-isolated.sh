#!/usr/bin/env bash
set -euo pipefail
# Disposable authenticated-identity fixture ONLY. Never connect to hosted
# Supabase, touch production, or rotate any real password.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NAME="gpt02-auth-fixture-$$"
WORK="$(mktemp -d)"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
IMAGE="${GPT02_PREPARER_AUTH_TEST_IMAGE:-postgres:17-alpine}"
[[ "$IMAGE" == "postgres:17-alpine" || "$IMAGE" == "postgres:16-alpine" ]] || {
  echo INVALID_POSTGRES_TEST_IMAGE >&2; exit 2;
}
# Both passwords are fixed synthetic fixtures, NOT operational credentials.
# Network none: even a valid login has no route to the real CST-DEV or PROD.
docker run -d --name "$NAME" --network none \
  -e POSTGRES_USER=fixture_root -e POSTGRES_DB=postgres \
  -e POSTGRES_PASSWORD=fixture-root-scram-only \
  -e POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256 \
  "$IMAGE" >/dev/null
ready=false
for i in $(seq 1 60); do
  logs="$(docker logs "$NAME" 2>&1 || true)"
  if [[ "$logs" == *'PostgreSQL init process complete'* ]] &&
     [[ "${logs#*PostgreSQL init process complete}" == *'database system is ready to accept connections'* ]] &&
     docker exec "$NAME" psql -X -U fixture_root -d postgres -Atqc 'SELECT 1' >/dev/null 2>&1; then
    ready=true; break
  fi
  sleep 1
done
[[ "$ready" == true ]] || { echo SCRAM_FIXTURE_DATABASE_UNAVAILABLE >&2; exit 2; }
root() { docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U fixture_root -d postgres -At; }
rootq() { docker exec "$NAME" psql -X -v ON_ERROR_STOP=1 -U fixture_root -d postgres -Atqc "$1"; }
tcp() {
  local password="$1"
  shift
  docker exec -e "PGPASSWORD=$password" "$NAME" psql -X -v ON_ERROR_STOP=1 \
    -h 127.0.0.1 -p 5432 -U gpt02_core_prep_login -d postgres -Atqc "$1"
}
root <<'SQL' >/dev/null
SET password_encryption='scram-sha-256';
REVOKE CONNECT,TEMP,CREATE ON DATABASE postgres FROM PUBLIC;
CREATE ROLE gpt02_core_prep_login NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB
 NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 0
 PASSWORD NULL VALID UNTIL '2000-01-01';
CREATE ROLE gpt02_core_prep_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB
 NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 0 PASSWORD NULL;
CREATE ROLE dev_gpt02_issuer_evidence NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB
 NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 0 PASSWORD NULL;
CREATE ROLE dev_gpt02_attestor_evidence NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB
 NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 0 PASSWORD NULL;
CREATE SCHEMA ai_platform;
CREATE TABLE ai_platform.ai_coding_tasks(id uuid PRIMARY KEY);
CREATE TABLE ai_platform.ai_coding_bridge_commands(id uuid PRIMARY KEY);
CREATE TABLE public.ai_execution_jobs(id uuid PRIMARY KEY);
ALTER TABLE ai_platform.ai_coding_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.ai_coding_bridge_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_execution_jobs ENABLE ROW LEVEL SECURITY;
CREATE SCHEMA gpt02_stage AUTHORIZATION gpt02_core_prep_owner;
REVOKE ALL ON SCHEMA gpt02_stage FROM PUBLIC;
CREATE TABLE gpt02_stage.core_preparations(id uuid PRIMARY KEY);
ALTER TABLE gpt02_stage.core_preparations OWNER TO gpt02_core_prep_owner;
ALTER TABLE gpt02_stage.core_preparations ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_stage.core_preparations FORCE ROW LEVEL SECURITY;
-- This sentinel is deliberately inert; the actual production function body
-- is never called. Verify EXECUTE denial on its exact signature.
CREATE FUNCTION gpt02_stage.prepare_core_task_dormant(
  text,integer,text,text,text,text
) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog
AS $$ SELECT false $$;
ALTER FUNCTION gpt02_stage.prepare_core_task_dormant(
  text,integer,text,text,text,text
) OWNER TO gpt02_core_prep_owner;
REVOKE ALL ON FUNCTION gpt02_stage.prepare_core_task_dormant(
  text,integer,text,text,text,text
) FROM PUBLIC;
GRANT CONNECT ON DATABASE postgres TO gpt02_core_prep_login;
SQL
# The official container must enforce password verification for host TCP.
[[ "$(rootq "SELECT COUNT(*) FROM pg_hba_file_rules
  WHERE type='host' AND auth_method='scram-sha-256'
    AND error IS NULL")" -ge 1 ]] || {
  echo HOST_TCP_SCRAM_REQUIRED >&2; exit 2;
}
if tcp 'fixture-login-scram-only' 'SELECT 1' >"$WORK/disabled.log" 2>&1; then
 echo DISABLED_PREPARER_CONNECTED >&2; exit 1
fi
echo PASS:PREPARER_STARTS_NOLOGIN_AND_CANNOT_AUTHENTICATE
# Fixture-local activation: test only the independent SCRAM login, not grants
# to Hub/Core, issuer, actual function or operational workers.
root <<'SQL' >/dev/null
SET password_encryption='scram-sha-256';
ALTER ROLE gpt02_core_prep_login WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT 1 PASSWORD 'fixture-login-scram-only' VALID UNTIL '2099-01-01';
SQL
[[ "$(rootq "SELECT rolpassword LIKE 'SCRAM-SHA-256$%'
  FROM pg_authid WHERE rolname='gpt02_core_prep_login'")" == t ]] || {
 echo ROLE_PASSWORD_NOT_SCRAM >&2; exit 1;
}
if tcp 'incorrect-fixture-password' 'SELECT 1' >"$WORK/incorrect.log" 2>&1; then
 echo WRONG_PASSWORD_AUTHENTICATED >&2; exit 1
fi
grep -Fq 'password authentication failed' "$WORK/incorrect.log" || {
 echo INCORRECT_PASSWORD_WRONG_FAILURE >&2; exit 1;
}
echo PASS:SCRAM_REJECTS_WRONG_PASSWORD
identity="$(tcp 'fixture-login-scram-only' "SELECT current_user||':'||session_user||':'||
 (SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user)::text||':'||
 pg_has_role(current_user,'gpt02_core_prep_owner','SET')::text||':'||
 has_database_privilege(current_user,current_database(),'CREATE')::text||':'||
 has_database_privilege(current_user,current_database(),'TEMP')::text")"
[[ "$identity" == 'gpt02_core_prep_login:gpt02_core_prep_login:false:false:false:false' ]] || {
 echo PREPARER_AUTH_IDENTITY_OR_PRIVILEGE_DRIFT >&2; exit 1;
}
echo PASS:SCRAM_AUTHENTICATED_DEDICATED_SESSION_NO_ADMIN_AUTHORITY
access="$(tcp 'fixture-login-scram-only' "SELECT
 (SELECT has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,REFERENCES,TRIGGER')
  FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid
  WHERE n.nspname='public' AND c.relname='ai_execution_jobs')::text||':'||
 (SELECT has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,REFERENCES,TRIGGER')
  FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid
  WHERE n.nspname='ai_platform' AND c.relname='ai_coding_tasks')::text||':'||
 (SELECT has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,REFERENCES,TRIGGER')
  FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid
  WHERE n.nspname='ai_platform' AND c.relname='ai_coding_bridge_commands')::text||':'||
 (SELECT has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,REFERENCES,TRIGGER')
  FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid
  WHERE n.nspname='gpt02_stage' AND c.relname='core_preparations')::text||':'||
 has_schema_privilege(current_user,'gpt02_stage','USAGE')::text||':'||
 (SELECT has_function_privilege(current_user,p.oid,'EXECUTE')
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='gpt02_stage' AND p.proname='prepare_core_task_dormant')::text")"
[[ "$access" == 'false:false:false:false:false:false' ]] || {
 echo DIRECT_GRANT_OR_DORMANT_EXECUTE_LEAK >&2; exit 1;
}
echo PASS:PREPARER_LOGIN_HAS_ZERO_DIRECT_DML_AND_ZERO_FUNCTION_EXECUTE
if tcp 'fixture-login-scram-only' 'SET ROLE fixture_root' >"$WORK/role-switch-denied.log" 2>&1; then
 echo SUPERUSER_ROLE_SWITCH_UNEXPECTEDLY_SUCCEEDED >&2; exit 1
fi
grep -Eiq '(permission denied|must be able to SET ROLE)' "$WORK/role-switch-denied.log" || {
 echo SUPERUSER_ROLE_SWITCH_WRONG_ERROR >&2; exit 1
}
echo PASS:SCOPED_SESSION_CANNOT_ASSUME_SUPERUSER
if tcp 'fixture-login-scram-only' "SELECT * FROM
 gpt02_stage.prepare_core_task_dormant('default',137,'x','x','x','x')" \
 >"$WORK/execution-denied.log" 2>&1; then
 echo DORMANT_FUNCTION_UNEXPECTEDLY_CALLED >&2; exit 1;
fi
echo PASS:ACTUAL_DORMANT_FUNCTION_CALL_DENIED
[[ "$(rootq "SELECT (SELECT COUNT(*) FROM gpt02_stage.core_preparations)||':'||
 (SELECT COUNT(*) FROM public.ai_execution_jobs)||':'||
 (SELECT COUNT(*) FROM ai_platform.ai_coding_tasks)||':'||
 (SELECT COUNT(*) FROM ai_platform.ai_coding_bridge_commands)")" == '0:0:0:0' ]] || {
 echo SCRAM_TEST_CREATED_UNEXPECTED_TASK_OR_COMMAND >&2; exit 1;
}
# Restore all dormant attributes inside the disposable fixture.
root <<'SQL' >/dev/null
ALTER ROLE gpt02_core_prep_login WITH NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB
 NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 0
 PASSWORD NULL VALID UNTIL '2000-01-01';
SQL
[[ "$(rootq "SELECT
  (NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole
   AND rolconnlimit=0 AND rolpassword IS NULL AND rolvaliduntil<clock_timestamp())
 FROM pg_authid WHERE rolname='gpt02_core_prep_login'")" == t ]] || {
 echo DORMANT_ROLE_ATTRIBUTES_NOT_RESTORED >&2; exit 1;
}
if tcp 'fixture-login-scram-only' 'SELECT 1' >"$WORK/after.log" 2>&1;then
 echo PREPARER_CONNECTED_AFTER_DEACTIVATION >&2;exit 1
fi
echo PASS:PREPARER_DEACTIVATED_AND_CREDENTIAL_CLEARED
printf 'GPT02_PREPARER_SCRAM_SEPARATE_LOGIN_OFFLINE_PASS_NO_FUNCTION_OR_COMMAND\n'
