#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NAME="gpt02-inactive-role-test-$$"
cleanup(){ docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
# Exact `postgres` DB and superuser only inside disposable Postgres container.
docker run -d --name "$NAME" --network none -e POSTGRES_PASSWORD=synthetic-only postgres:16-alpine >/dev/null
ready=false
for n in $(seq 1 45);do
 if docker exec "$NAME" psql -X -U postgres -d postgres -Atqc 'SELECT 1' >/dev/null 2>&1;then ready=true;break;fi
 sleep 1
done
[[ "$ready" == true ]] || { echo ISOLATED_POSTGRES_NOT_READY >&2;exit 2; }
docker exec -i "$NAME" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -q < "$ROOT/scripts/dev/gpt02-core-preparer-role-dormant.sql"
first="$(docker exec "$NAME" psql -X -U postgres -d postgres -Atqc "SELECT rolcanlogin,rolinherit,rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls,rolconnlimit,(rolvaliduntil<clock_timestamp()),(SELECT count(*) FROM pg_auth_members WHERE member=r.oid) FROM pg_roles r WHERE rolname='gpt02_core_prep_login'")"
[[ "$first" == 'f|f|f|f|f|f|f|0|t|0' ]] || { echo "UNSAFE_ROLE_CREATED:$first" >&2;exit 1; }
echo PASS:INACTIVE_ROLE_NOLOGIN_EXPIRED_NO_MEMBERSHIPS
# Not a protected credential rotation: merely re-applying the same role creation
# must not mutate the user, privileges or hidden password.
docker exec -i "$NAME" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -q < "$ROOT/scripts/dev/gpt02-core-preparer-role-dormant.sql"
second="$(docker exec "$NAME" psql -X -U postgres -d postgres -Atqc "SELECT rolcanlogin,rolinherit,rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls,rolconnlimit,(rolvaliduntil<clock_timestamp()),(SELECT count(*) FROM pg_auth_members WHERE member=r.oid) FROM pg_roles r WHERE rolname='gpt02_core_prep_login'")"
[[ "$first" == "$second" ]] || { echo IDEMPOTENCY_ROLE_DRIFT >&2;exit 1; }
echo PASS:INACTIVE_MIGRATION_IDEMPOTENT
# The new role must have no direct access to Hub business / Core command tables.
docker exec "$NAME" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -q -c 'CREATE SCHEMA ai_platform; CREATE TABLE ai_platform.ai_coding_bridge_commands(id int); CREATE TABLE public.ai_tasks(id int);' >/dev/null
rights="$(docker exec "$NAME" psql -X -U postgres -d postgres -Atqc "SELECT has_table_privilege('gpt02_core_prep_login','public.ai_tasks','SELECT,INSERT,UPDATE,DELETE'),has_table_privilege('gpt02_core_prep_login','ai_platform.ai_coding_bridge_commands','SELECT,INSERT,UPDATE,DELETE'),has_schema_privilege('gpt02_core_prep_login','ai_platform','USAGE')")"
[[ "$rights" == 'f|f|f' ]] || { echo UNEXPECTED_TABLE_PRIVILEGES:$rights >&2;exit 1; }
echo PASS:NO_UNINTENDED_HUB_CORE_TABLE_GRANTS
# Simulate accidental privilege escalation on the disposable DB only. Migration
# MUST refuse rather than silently changing existing credentials/permissions.
docker exec "$NAME" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -q -c 'ALTER ROLE gpt02_core_prep_login LOGIN' >/dev/null
if docker exec -i "$NAME" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -q < "$ROOT/scripts/dev/gpt02-core-preparer-role-dormant.sql" > /tmp/gpt02-role-escalation-rejection-$$.log 2>&1;then
 echo FAIL:ROLE_ESCALATION_ACCEPTED >&2;exit 1
fi
if ! grep -Fq GPT02_DORMANT_ROLE_CONFIG_UNSAFE /tmp/gpt02-role-escalation-rejection-$$.log;then
 echo FAIL:UNEXPECTED_REJECTION_REASON >&2;cat /tmp/gpt02-role-escalation-rejection-$$.log;exit 1
fi
rm -f /tmp/gpt02-role-escalation-rejection-$$.log
echo PASS:PREEXISTING_ESCALATED_ROLE_REJECTED_NOT_ROTATED
if docker exec "$NAME" psql -X -U postgres -d postgres -Atqc 'SELECT rolcanlogin FROM pg_roles WHERE rolname=\x27gpt02_core_prep_login\x27' >/dev/null 2>&1;then :;fi
# A non-postgres DB is never eligible for the reviewed migration.
docker exec "$NAME" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -q -c 'CREATE DATABASE foreign_fixture' >/dev/null
if docker exec -i "$NAME" psql -X -U postgres -d foreign_fixture -v ON_ERROR_STOP=1 -q < "$ROOT/scripts/dev/gpt02-core-preparer-role-dormant.sql" >/dev/null 2>&1;then
 echo FAIL:FOREIGN_DATABASE_MIGRATION_ACCEPTED >&2;exit 1
fi
echo PASS:WRONG_DATABASE_REJECTED
echo GPT02_DORMANT_ROLE_ISOLATED_PASS_NO_PASSWORD_NO_DISPATCH
