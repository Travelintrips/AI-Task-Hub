#!/bin/bash
set -euo pipefail
# Disposable local PostgreSQL fixture only. No Supabase credentials or network.
W="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAME=gpt02-task183-relock-candidate-$$
cleanup(){ docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --name "$NAME" --network none --security-opt no-new-privileges -e POSTGRES_USER=fixture_root -e POSTGRES_PASSWORD=SYNTHETIC_FIXTURE_ROOT -e POSTGRES_DB=postgres postgres:16-alpine >/dev/null
ready=0
for i in $(seq 1 40);do if docker exec "$NAME" psql -X -U fixture_root -d postgres -Atqc 'SELECT 1' >/dev/null 2>&1; then ready=1;break;fi;sleep 0.3;done
test "$ready" = 1
docker exec "$NAME" sh -c 'sed -i "1i host all all 127.0.0.1/32 scram-sha-256" "$PGDATA/pg_hba.conf"'
docker exec "$NAME" psql -X -U fixture_root -d postgres -Atqc 'SELECT pg_reload_conf()' >/dev/null
docker exec "$NAME" psql -X -v ON_ERROR_STOP=1 -U fixture_root -d postgres -c "CREATE ROLE gpt02_core_prep_login NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 0 PASSWORD NULL VALID UNTIL '2000-01-01'" >/dev/null
docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U fixture_root -d postgres < "$W/gpt02-task183-relock-hosted-candidate.sql" >/dev/null
docker exec "$NAME" psql -X -v ON_ERROR_STOP=1 -U fixture_root -d postgres -c "ALTER ROLE gpt02_task183_relock_login LOGIN CONNECTION LIMIT 1 PASSWORD 'SYNTHETIC_RELOCK_ONLY' VALID UNTIL '2030-01-01'" >/dev/null
# This identity can invoke the specific relock function, but cannot unlock a role directly.
if docker exec -e PGPASSWORD=SYNTHETIC_RELOCK_ONLY "$NAME" psql -X -w -h 127.0.0.1 -U gpt02_task183_relock_login -d postgres -Atqc 'ALTER ROLE gpt02_core_prep_login LOGIN' >/dev/null 2>&1;then echo 'UNEXPECTED_DIRECT_ALTER_ALLOWED';exit 3;fi
locked=$(docker exec -e PGPASSWORD=SYNTHETIC_RELOCK_ONLY "$NAME" psql -X -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -U gpt02_task183_relock_login -d postgres -Atqc 'SELECT * FROM gpt02_guard.relock_task183_preparer()')
test "$locked" = 't|0' || { echo "LOCKED_IDEMPOTENT_EXPECTED"; exit 4; }
docker exec "$NAME" psql -X -v ON_ERROR_STOP=1 -U fixture_root -d postgres -Atqc "ALTER ROLE gpt02_core_prep_login LOGIN CONNECTION LIMIT 1 PASSWORD 'SYNTHETIC_PREPARER_ONLY' VALID UNTIL '2030-01-01'" >/dev/null
far=$(docker exec -e PGPASSWORD=SYNTHETIC_RELOCK_ONLY "$NAME" psql -X -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -U gpt02_task183_relock_login -d postgres -Atqc 'SELECT * FROM gpt02_guard.relock_task183_preparer()')
test "$far" = 't|0' || { echo "OVERLONG_TTL_NOT_RELOCKED"; exit 5; }
docker exec "$NAME" psql -X -v ON_ERROR_STOP=1 -U fixture_root -d postgres -Atqc "DO \$\$ BEGIN EXECUTE format('ALTER ROLE gpt02_core_prep_login LOGIN CONNECTION LIMIT 1 PASSWORD %L VALID UNTIL %L','SYNTHETIC_PREPARER_ONLY',(clock_timestamp()+interval '40 seconds')::text); END \$\$;" >/dev/null
bounded=$(docker exec -e PGPASSWORD=SYNTHETIC_RELOCK_ONLY "$NAME" psql -X -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -U gpt02_task183_relock_login -d postgres -Atqc 'SELECT * FROM gpt02_guard.relock_task183_preparer()')
test "$bounded" = 'f|0' || { echo "BOUNDED_LOGIN_PREMATURE_RELOCK"; exit 6; }
docker exec -d -e PGPASSWORD=SYNTHETIC_PREPARER_ONLY "$NAME" psql -X -w -h 127.0.0.1 -U gpt02_core_prep_login -d postgres -Atqc 'SELECT pg_sleep(40)' >/dev/null
sleep 0.7
n=$(docker exec "$NAME" psql -X -U fixture_root -d postgres -Atqc "SELECT count(*) FROM pg_stat_activity WHERE usename='gpt02_core_prep_login'")
test "$n" = 1 || { echo "ACTIVE_PREPARER_SESSION_EXPECTED";exit 7; }
docker exec "$NAME" psql -X -v ON_ERROR_STOP=1 -U fixture_root -d postgres -Atqc "ALTER ROLE gpt02_core_prep_login VALID UNTIL '2000-01-01'" >/dev/null
final=$(docker exec -e PGPASSWORD=SYNTHETIC_RELOCK_ONLY "$NAME" psql -X -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -U gpt02_task183_relock_login -d postgres -Atqc 'SELECT * FROM gpt02_guard.relock_task183_preparer()')
test "$final" = 't|1' || { echo "ACTIVE_SESSION_RELOCK_RESULT_MISMATCH";exit 8; }
check=$(docker exec "$NAME" psql -X -U fixture_root -d postgres -Atqc "SELECT rolcanlogin,rolconnlimit,rolpassword IS NULL,rolvaliduntil<now(),(SELECT count(*) FROM pg_stat_activity WHERE usename='gpt02_core_prep_login') FROM pg_authid WHERE rolname='gpt02_core_prep_login'")
test "$check" = 'f|0|t|t|0' || { echo "FINAL_CATALOG_RELOCK_MISMATCH";exit 9; }
if docker exec -e PGPASSWORD=SYNTHETIC_PREPARER_ONLY "$NAME" psql -X -w -h 127.0.0.1 -U gpt02_core_prep_login -d postgres -Atqc 'SELECT 1' >/dev/null 2>&1;then echo "OLD_PASSWORD_RELOGIN_ALLOWED";exit 10;fi
echo "TASK183_SQL_RELOCK_CANDIDATE_ISOLATED_PASS"
echo "LOCKED_IDEMPOTENCE_AND_OVERLONG_TTL_PASS"
echo "BOUNDED_CANARY_NOT_PREMATURELY_RELOCKED_PASS"
echo "ACTIVE_SESSION_ENDED_PASSWORD_CLEARED_PASS"
echo "PRIVILEGE_BOUNDARY_NO_DIRECT_ALTER_PASS"
echo "NETWORK_NONE_NO_HOSTED_WRITES"
