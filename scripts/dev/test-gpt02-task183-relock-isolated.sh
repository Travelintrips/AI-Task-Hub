#!/bin/bash
set -euo pipefail
# Disposable local PostgreSQL fixture only. No Supabase credentials or network.
W="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAME=gpt02-task183-relock-candidate-$$
cleanup(){ docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --name "$NAME" --network none --security-opt no-new-privileges -e POSTGRES_USER=fixture_root -e POSTGRES_PASSWORD=SYNTHETIC_FIXTURE_ROOT -e POSTGRES_DB=postgres postgres:16-alpine >/dev/null
# PostgreSQL's initdb accepts one temporary local socket before shutdown
# and final server restart. Require the FINAL post-init ready marker, not
# just a fleeting successful SELECT during bootstrap.
ready=0
for i in $(seq 1 75); do
  logs=$(docker logs "$NAME" 2>&1 || true)
  if [[ "$logs" == *'PostgreSQL init process complete'* ]] &&
     [[ "${logs#*PostgreSQL init process complete}" == *'database system is ready to accept connections'* ]] &&
     docker exec "$NAME" psql -X -U fixture_root -d postgres -Atqc 'SELECT 1' >/dev/null 2>&1; then
    ready=1; break
  fi
  sleep 0.4
done
test "$ready" = 1 || { echo "POSTGRES_FINAL_INIT_NOT_READY"; exit 2; }
docker exec "$NAME" sh -c 'sed -i "1i host all all 127.0.0.1/32 scram-sha-256" "$PGDATA/pg_hba.conf"'
docker exec "$NAME" psql -X -U fixture_root -d postgres -Atqc 'SELECT pg_reload_conf()' >/dev/null
docker exec "$NAME" psql -X -v ON_ERROR_STOP=1 -U fixture_root -d postgres -c "CREATE ROLE gpt02_core_prep_login NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 0 PASSWORD NULL VALID UNTIL '2000-01-01'" >/dev/null
# The hosted candidate checks that preparer EXECUTE is explicitly revoked during a canary.
docker exec "$NAME" psql -X -v ON_ERROR_STOP=1 -U fixture_root -d postgres -c "CREATE SCHEMA gpt02_stage; REVOKE ALL ON SCHEMA gpt02_stage FROM PUBLIC; CREATE FUNCTION gpt02_stage.prepare_core_task(text,integer,text,text,text,text) RETURNS integer LANGUAGE SQL AS 'SELECT 1'; REVOKE ALL ON FUNCTION gpt02_stage.prepare_core_task(text,integer,text,text,text,text) FROM PUBLIC; GRANT USAGE ON SCHEMA gpt02_stage TO gpt02_core_prep_login; GRANT EXECUTE ON FUNCTION gpt02_stage.prepare_core_task(text,integer,text,text,text,text) TO gpt02_core_prep_login" >/dev/null
docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U fixture_root -d postgres < "$W/gpt02-task183-relock-hosted-candidate.sql" >/dev/null
docker exec "$NAME" psql -X -v ON_ERROR_STOP=1 -U fixture_root -d postgres -c "ALTER ROLE gpt02_task183_relock_login LOGIN CONNECTION LIMIT 1 PASSWORD 'SYNTHETIC_RELOCK_ONLY' VALID UNTIL '2030-01-01'" >/dev/null
# This identity can invoke the specific relock function, but cannot unlock a role directly.
if docker exec -e PGPASSWORD=SYNTHETIC_RELOCK_ONLY "$NAME" psql -X -w -h 127.0.0.1 -U gpt02_task183_relock_login -d postgres -Atqc 'ALTER ROLE gpt02_core_prep_login LOGIN' >/dev/null 2>&1;then echo 'UNEXPECTED_DIRECT_ALTER_ALLOWED';exit 3;fi
locked=$(docker exec -e PGPASSWORD=SYNTHETIC_RELOCK_ONLY "$NAME" psql -X -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -U gpt02_task183_relock_login -d postgres -Atqc 'SELECT * FROM gpt02_guard.relock_task183_preparer()')
test "$locked" = 't|0|0|f' || { echo "LOCKED_IDEMPOTENT_EXPECTED"; exit 4; }
docker exec "$NAME" psql -X -v ON_ERROR_STOP=1 -U fixture_root -d postgres -Atqc "ALTER ROLE gpt02_core_prep_login LOGIN CONNECTION LIMIT 1 PASSWORD 'SYNTHETIC_PREPARER_ONLY' VALID UNTIL '2030-01-01'" >/dev/null
far=$(docker exec -e PGPASSWORD=SYNTHETIC_RELOCK_ONLY "$NAME" psql -X -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -U gpt02_task183_relock_login -d postgres -Atqc 'SELECT * FROM gpt02_guard.relock_task183_preparer()')
test "$far" = 't|0|0|f' || { echo "OVERLONG_TTL_NOT_RELOCKED"; exit 5; }
docker exec "$NAME" psql -X -U fixture_root -d postgres -Atqc "REVOKE EXECUTE ON FUNCTION gpt02_stage.prepare_core_task(text,integer,text,text,text,text) FROM gpt02_core_prep_login" >/dev/null
docker exec "$NAME" psql -X -v ON_ERROR_STOP=1 -U fixture_root -d postgres -Atqc "DO \$\$ BEGIN EXECUTE format('ALTER ROLE gpt02_core_prep_login LOGIN CONNECTION LIMIT 1 PASSWORD %L VALID UNTIL %L','SYNTHETIC_PREPARER_ONLY',(clock_timestamp()+interval '40 seconds')::text); END \$\$;" >/dev/null
bounded=$(docker exec -e PGPASSWORD=SYNTHETIC_RELOCK_ONLY "$NAME" psql -X -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -U gpt02_task183_relock_login -d postgres -Atqc 'SELECT * FROM gpt02_guard.relock_task183_preparer()')
test "$bounded" = 'f|0|0|t' || { echo "BOUNDED_LOGIN_PREMATURE_RELOCK"; exit 6; }
# A failure to count a bounded canary's sessions must force NOLOGIN.
python3 - "$W" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]);src=(p/'gpt02-task183-relock-hosted-candidate.sql').read_text()
fn=src[src.index('CREATE FUNCTION gpt02_guard.relock_task183_preparer()'):src.index('REVOKE ALL ON FUNCTION')]
fn=fn.replace('CREATE FUNCTION ','CREATE OR REPLACE FUNCTION ',1)
needle=("SELECT count(*)::integer INTO remaining FROM pg_catalog.pg_stat_activity\n"
        "       WHERE usename='gpt02_core_prep_login';")
assert fn.count(needle)==1
(p/'inject-census-failure.sql').write_text(fn.replace(needle,"RAISE EXCEPTION 'SYNTHETIC_CANARY_CENSUS_FAILURE';",1))
(p/'restore-function.sql').write_text(fn)
PY
docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U fixture_root -d postgres < "$W/inject-census-failure.sql" >/dev/null
census=$(docker exec -e PGPASSWORD=SYNTHETIC_RELOCK_ONLY "$NAME" psql -X -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -U gpt02_task183_relock_login -d postgres -Atqc 'SELECT * FROM gpt02_guard.relock_task183_preparer()')
test "$census" = 't|0|0|f' || { echo "CANARY_CENSUS_FAILURE_DID_NOT_FORCE_RELOCK";exit 16; }
docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U fixture_root -d postgres < "$W/restore-function.sql" >/dev/null
docker exec "$NAME" psql -X -v ON_ERROR_STOP=1 -U fixture_root -d postgres -Atqc "DO \$\$ BEGIN EXECUTE format('ALTER ROLE gpt02_core_prep_login LOGIN CONNECTION LIMIT 1 PASSWORD %L VALID UNTIL %L','SYNTHETIC_PREPARER_ONLY',(clock_timestamp()+interval '40 seconds')::text); END \$\$;" >/dev/null
echo "CANARY_CENSUS_FAILURE_RELOCKED_ROLE_PASS"
docker exec -d -e PGPASSWORD=SYNTHETIC_PREPARER_ONLY "$NAME" psql -X -w -h 127.0.0.1 -U gpt02_core_prep_login -d postgres -Atqc 'SELECT pg_sleep(40)' >/dev/null
sleep 0.7
n=$(docker exec "$NAME" psql -X -U fixture_root -d postgres -Atqc "SELECT count(*) FROM pg_stat_activity WHERE usename='gpt02_core_prep_login'")
test "$n" = 1 || { echo "ACTIVE_PREPARER_SESSION_EXPECTED";exit 7; }
docker exec "$NAME" psql -X -v ON_ERROR_STOP=1 -U fixture_root -d postgres -Atqc "ALTER ROLE gpt02_core_prep_login VALID UNTIL '2000-01-01'" >/dev/null
final=$(docker exec -e PGPASSWORD=SYNTHETIC_RELOCK_ONLY "$NAME" psql -X -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -U gpt02_task183_relock_login -d postgres -Atqc 'SELECT * FROM gpt02_guard.relock_task183_preparer()')
# pg_terminate_backend may return true before pg_stat_activity stops showing
# the backend. An incomplete state MUST NOT be a false-positive PASS.
if test "$final" != 't|1|0|f' && test "$final" != 'f|1|1|f'; then
 echo "ACTIVE_SESSION_RELOCK_RESULT_MISMATCH";exit 8
fi
if test "$final" = 'f|1|1|f'; then
 echo "RELOCK_FIRST_CYCLE_INCOMPLETE_IS_NOT_PASS"
fi
# The independent watchdog's next tick must confirm zero sessions and NOLOGIN.
sleep 0.5
confirmed=$(docker exec -e PGPASSWORD=SYNTHETIC_RELOCK_ONLY "$NAME" psql -X -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -U gpt02_task183_relock_login -d postgres -Atqc 'SELECT * FROM gpt02_guard.relock_task183_preparer()')
test "$confirmed" = 't|0|0|f' || { echo "SECOND_WATCHDOG_CYCLE_DID_NOT_CLEAR_SESSION";exit 8; }
check=$(docker exec "$NAME" psql -X -U fixture_root -d postgres -Atqc "SELECT rolcanlogin,rolconnlimit,rolpassword IS NULL,rolvaliduntil<now(),(SELECT count(*) FROM pg_stat_activity WHERE usename='gpt02_core_prep_login') FROM pg_authid WHERE rolname='gpt02_core_prep_login'")
test "$check" = 'f|0|t|t|0' || { echo "FINAL_CATALOG_RELOCK_MISMATCH";exit 9; }
if docker exec -e PGPASSWORD=SYNTHETIC_PREPARER_ONLY "$NAME" psql -X -w -h 127.0.0.1 -U gpt02_core_prep_login -d postgres -Atqc 'SELECT 1' >/dev/null 2>&1;then echo "OLD_PASSWORD_RELOGIN_ALLOWED";exit 10;fi
# If the protected preparation function disappears, bounded canary admission
# must fail closed by relocking (not throw and roll back).
docker exec "$NAME" psql -X -v ON_ERROR_STOP=1 -U fixture_root -d postgres -Atqc "DROP FUNCTION gpt02_stage.prepare_core_task(text,integer,text,text,text,text)" >/dev/null
docker exec "$NAME" psql -X -v ON_ERROR_STOP=1 -U fixture_root -d postgres -Atqc "DO \$\$ BEGIN EXECUTE format('ALTER ROLE gpt02_core_prep_login LOGIN CONNECTION LIMIT 1 PASSWORD %L VALID UNTIL %L','SYNTHETIC_PREPARER_ONLY',(clock_timestamp()+interval '40 seconds')::text); END \$\$;" >/dev/null
missing=$(docker exec -e PGPASSWORD=SYNTHETIC_RELOCK_ONLY "$NAME" psql -X -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -U gpt02_task183_relock_login -d postgres -Atqc 'SELECT * FROM gpt02_guard.relock_task183_preparer()')
test "$missing" = 't|0|0|f' || { echo "MISSING_PREPARATION_FUNCTION_DID_NOT_FAIL_CLOSED"; exit 15; }
echo "MISSING_PREPARATION_FUNCTION_CANARY_FAIL_CLOSED_PASS"
# Simulate a backend termination error. PostgreSQL MUST commit NOLOGIN even
# while one synthetic session survives to be terminated in a later cycle.
docker exec "$NAME" psql -X -v ON_ERROR_STOP=1 -U fixture_root -d postgres -Atqc "ALTER ROLE gpt02_core_prep_login LOGIN CONNECTION LIMIT 1 PASSWORD 'SYNTHETIC_PREPARER_ONLY' VALID UNTIL '2030-01-01'" >/dev/null
docker exec -d -e PGPASSWORD=SYNTHETIC_PREPARER_ONLY "$NAME" psql -X -w -h 127.0.0.1 -U gpt02_core_prep_login -d postgres -Atqc 'SELECT pg_sleep(40)' >/dev/null
sleep 0.7
before=$(docker exec "$NAME" psql -X -U fixture_root -d postgres -Atqc "SELECT count(*) FROM pg_stat_activity WHERE usename='gpt02_core_prep_login'")
test "$before" = 1 || { echo "FAILURE_SESSION_FIXTURE_MISSING"; exit 11; }
python3 - "$W" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]);src=(p/'gpt02-task183-relock-hosted-candidate.sql').read_text()
fn=src[src.index('CREATE FUNCTION gpt02_guard.relock_task183_preparer()'):src.index('REVOKE ALL ON FUNCTION')]
assert fn.count('IF pg_catalog.pg_terminate_backend(sess.pid) THEN')==1
fn=fn.replace('CREATE FUNCTION ','CREATE OR REPLACE FUNCTION ',1)
fn=fn.replace('IF pg_catalog.pg_terminate_backend(sess.pid) THEN',"RAISE EXCEPTION 'SYNTHETIC_TERMINATION_FAILURE';\n     IF pg_catalog.pg_terminate_backend(sess.pid) THEN")
(p/'inject-termination-failure.sql').write_text(fn)
PY
docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U fixture_root -d postgres < "$W/inject-termination-failure.sql" >/dev/null
partial=$(docker exec -e PGPASSWORD=SYNTHETIC_RELOCK_ONLY "$NAME" psql -X -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -U gpt02_task183_relock_login -d postgres -Atqc 'SELECT * FROM gpt02_guard.relock_task183_preparer()')
test "$partial" = 'f|0|1|f' || { echo "PARTIAL_RELOCK_RESPONSE_MISSING"; exit 12; }
safe=$(docker exec "$NAME" psql -X -U fixture_root -d postgres -Atqc "SELECT rolcanlogin,rolconnlimit,rolpassword IS NULL,rolvaliduntil<now(),(SELECT count(*) FROM pg_stat_activity WHERE usename='gpt02_core_prep_login') FROM pg_authid WHERE rolname='gpt02_core_prep_login'")
test "$safe" = 'f|0|t|t|1' || { echo "CATALOG_RELOCK_ROLLED_BACK_ON_FAILURE"; exit 13; }
# Terminate the residual session as local fixture owner; the next watchdog
# invocation must transition pending->fully locked (not a false PASS).
docker exec "$NAME" psql -X -U fixture_root -d postgres -Atqc "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename='gpt02_core_prep_login'" >/dev/null
recovered=$(docker exec -e PGPASSWORD=SYNTHETIC_RELOCK_ONLY "$NAME" psql -X -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -U gpt02_task183_relock_login -d postgres -Atqc 'SELECT * FROM gpt02_guard.relock_task183_preparer()')
test "$recovered" = 't|0|0|f' || { echo "NEXT_CYCLE_DID_NOT_REPORT_FULL_RELOCK"; exit 14; }
echo "TERMINATION_FAILURE_NOLOGIN_REMAINS_COMMITTED_PASS"
echo "INCOMPLETE_RELOCK_REPORTED_AND_NEXT_CYCLE_RECOVERED_PASS"
echo "TASK183_SQL_RELOCK_CANDIDATE_ISOLATED_PASS"
echo "LOCKED_IDEMPOTENCE_AND_OVERLONG_TTL_PASS"
echo "BOUNDED_CANARY_NOT_PREMATURELY_RELOCKED_PASS"
echo "ACTIVE_SESSION_ENDED_PASSWORD_CLEARED_PASS"
echo "PRIVILEGE_BOUNDARY_NO_DIRECT_ALTER_PASS"
echo "NETWORK_NONE_NO_HOSTED_WRITES"
