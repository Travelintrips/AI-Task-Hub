#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NAME="gpt02-nonsuper-stage-$$"; WORK="$(mktemp -d)"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true;rm -rf "$WORK"; }
trap cleanup EXIT
NODE_IMAGE="${GPT02_PRIVATE_SCHEMA_TEST_IMAGE:-postgres:16-alpine}"
[[ "$NODE_IMAGE" == "postgres:16-alpine" || "$NODE_IMAGE" == "postgres:17-alpine" ]] || { echo INVALID_FIXTURE_POSTGRES_IMAGE >&2;exit 2; }
docker run -d --name "$NAME" --network none -e POSTGRES_PASSWORD=fixture-only "$NODE_IMAGE" >/dev/null
for i in $(seq 1 45);do docker exec "$NAME" psql -X -U postgres -d postgres -Atqc 'SELECT 1' >/dev/null 2>&1 && break;sleep 1;done
docker exec -i "$NAME" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -q < "$ROOT/scripts/dev/gpt02-core-preparer-role-dormant.sql" > "$WORK/login.log" 2>&1
docker exec -i "$NAME" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE ROLE gpt02_fixture_admin LOGIN CREATEROLE NOBYPASSRLS NOSUPERUSER NOINHERIT;
GRANT CREATE ON DATABASE postgres TO gpt02_fixture_admin WITH GRANT OPTION;
GRANT CREATE ON SCHEMA public TO gpt02_fixture_admin;
GRANT USAGE ON SCHEMA public TO gpt02_fixture_admin WITH GRANT OPTION;
CREATE SCHEMA ai_platform AUTHORIZATION gpt02_fixture_admin;
CREATE TABLE public.ai_execution_jobs(id uuid PRIMARY KEY);
CREATE TABLE ai_platform.ai_coding_tasks(id uuid PRIMARY KEY);
ALTER TABLE public.ai_execution_jobs OWNER TO gpt02_fixture_admin;
ALTER TABLE ai_platform.ai_coding_tasks OWNER TO gpt02_fixture_admin;
SQL
# In the fixture only, substitute the name of the non-superuser CREATEROLE
# migrator for Supabase's non-superuser `postgres` actor.
sed 's/current_user<>\x27postgres\x27/current_user<>\x27gpt02_fixture_admin\x27/g;s/TO postgres WITH SET TRUE/TO gpt02_fixture_admin WITH SET TRUE/g;s/FROM postgres;/FROM gpt02_fixture_admin;/g;s/rolname=\x27postgres\x27/rolname=\x27gpt02_fixture_admin\x27/g' \
 "$ROOT/scripts/dev/gpt02-private-preparation-staging-inactive.sql" > "$WORK/migration.sql"
{ printf 'SET SESSION AUTHORIZATION gpt02_fixture_admin;\nBEGIN;\n';cat "$WORK/migration.sql";printf '\nCOMMIT;\n'; } | \
 docker exec -i "$NAME" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -q > "$WORK/run.log" 2>&1 || { tail -35 "$WORK/run.log"; exit 2; }
checks="$(docker exec "$NAME" psql -X -U postgres -d postgres -Atqc "SELECT c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner),(SELECT count(*) FROM pg_auth_members m WHERE m.roleid=(SELECT oid FROM pg_roles WHERE rolname='gpt02_core_prep_owner') AND (m.member IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname='gpt02_fixture_admin') OR m.set_option OR m.inherit_option OR NOT m.admin_option)),has_table_privilege('gpt02_core_prep_owner','public.ai_execution_jobs','REFERENCES'),has_table_privilege('gpt02_core_prep_owner','ai_platform.ai_coding_tasks','REFERENCES') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='gpt02_stage' AND c.relname='core_preparations'")"
[[ "$checks" == 't|t|gpt02_core_prep_owner|0|f|f' ]] || { echo "POST_MIGRATION_ROLE_LEAK:$checks"; exit 1; }
echo 'GPT02_NON_SUPERUSER_MIGRATOR_ISOLATED_PASS: OWNER_NOLOGIN, NO_USABLE_MEMBERSHIP, ALL_PARENT_GRANTS_REVOKED'
