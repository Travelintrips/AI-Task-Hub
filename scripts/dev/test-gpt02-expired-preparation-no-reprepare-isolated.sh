#!/usr/bin/env bash
set -euo pipefail
# Disposable PostgreSQL16 only; canonical 15-minute function left unchanged.
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
if [[ -n "${GPT02_TEST_SOURCE_ROOT:-}" ]];then ROOT="$GPT02_TEST_SOURCE_ROOT";fi
NAME="gpt02-prep-expiry-$PPID-$$"
VOL="gpt02-prep-expiry-volume-$PPID-$$"
WORK="$(mktemp -d /tmp/gpt02-prep-expiry.XXXXXXXX)"
cleanup() {
 docker rm -f "$NAME" >/dev/null 2>&1 || true
 docker volume rm "$VOL" >/dev/null 2>&1 || true
 rm -rf "$WORK"
}
trap cleanup EXIT
docker volume create "$VOL" >/dev/null
docker run -d --name "$NAME" --network none \
 --mount "type=volume,src=$VOL,dst=/var/run/postgresql" \
 -e POSTGRES_PASSWORD=synthetic-offline-fixture postgres:16-alpine \
 -c unix_socket_directories=/var/run/postgresql >/dev/null
ready=false
for n in $(seq 1 60);do
 logs="$(docker logs "$NAME" 2>&1 || true)"
 if [[ "$logs" == *"PostgreSQL init process complete"* ]] &&
    [[ "$logs" == *"database system is ready to accept connections"* ]] &&
    docker exec "$NAME" psql -X -Atq -U postgres -c "SELECT 1" 2>/dev/null | grep -qx 1;then
   ready=true;break
 fi
 sleep 0.5
done
[[ "$ready" == true ]] || { echo "FAIL:ISOLATED_POSTGRES_NOT_READY";exit 2; }
docker exec "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres \
 -c 'CREATE DATABASE gpt02_core_preparation_isolated' >/dev/null
SOURCE="$ROOT/scripts/dev/gpt02-core-task-preparation-isolated.sql"
POLICIES="$ROOT/scripts/dev/gpt02-core-preparer-rls-candidate.sql"
[[ -f "$SOURCE" && -f "$POLICIES" ]] || { echo "FAIL:MISSING_EXISTING_SQL_FIXTURE";exit 2; }
python3 - "$SOURCE" "$WORK/ttl.sql" <<'PY'
from pathlib import Path
import sys
s=Path(sys.argv[1]).read_text()
target="clock_timestamp()+interval '15 minutes'"
assert s.count(target)==1,'unexpected canonical TTL source'
assert "PREPARATION_CHANGED_OR_ALREADY_STARTED" in s
s=s.replace(target,"clock_timestamp()+interval '2 seconds'")
Path(sys.argv[2]).write_text(s)
PY
awk -v file="$POLICIES" '
 $0=="-- GPT02_PREPARER_RLS_POLICY_INJECTION_POINT" {
   while((getline line < file)>0) print line;
   close(file);next
 }
 {print}
' "$WORK/ttl.sql" |
 docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres \
 -d gpt02_core_preparation_isolated -q >"$WORK/setup.log" 2>&1 ||
 { tail -20 "$WORK/setup.log"; exit 2; }
sql() {
 docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U "$1" \
   -d gpt02_core_preparation_isolated -At -c "$2"
}
PREP="SELECT core_task_id,command_candidate_id,attempt_id,hub_execution_id,created,dispatch_permitted FROM gpt02_stage.prepare_core_task('default',137,'GPT02 DEV coding lifecycle','Travelintrips/Core-AI-Foundation','develop','PREPARE ONLY, never issue a command.');"
result="$(sql gpt02_core_prep_login "$PREP")"
[[ "$result" == *"|t|f" ]] || { echo "FAIL:FIRST_PREPARATION_NOT_NONDISPATCHING";exit 2; }
echo "PASS:SHORT_TTL_SYNTHETIC_PREPARATION_INITIAL_ATOMIC_PASS"
sleep 3
if sql gpt02_core_prep_login "$PREP" >"$WORK/replay.log" 2>&1;then
 echo "FAIL:EXPIRED_PREPARATION_REUSED";exit 2
fi
grep -Fq "PREPARATION_CHANGED_OR_ALREADY_STARTED" "$WORK/replay.log" ||
 { echo "FAIL:WRONG_EXPIRY_DENIAL";tail -7 "$WORK/replay.log";exit 2; }
echo "PASS:EXPIRED_PREPARATION_RETRY_DENIED"
counts="$(sql postgres "SELECT
 (SELECT count(*) FROM gpt02_stage.core_preparations WHERE hub_task_id=137)::text||':'||
 (SELECT count(*) FROM public.ai_execution_jobs WHERE task_id=137 AND status='prepared')::text||':'||
 (SELECT count(*) FROM ai_platform.ai_coding_tasks WHERE task_number LIKE 'GPT02DEV-137-%')::text||':'||
 (SELECT count(*) FROM ai_platform.ai_coding_bridge_commands)::text;")"
[[ "$counts" == "1:1:1:0" ]] || { echo "FAIL:AFTER_EXPIRY_ORPHANS_OR_REPLACEMENT:$counts";exit 2; }
echo "PASS:EXPIRED_PREPARATION_HAS_ONE_IMMUTABLE_PAIR_ZERO_COMMANDS"
if sql postgres "UPDATE gpt02_stage.core_preparations SET expires_at=clock_timestamp()+interval '15 minutes' WHERE hub_task_id=137" >"$WORK/modify.log" 2>&1;then
 echo "FAIL:IMMUTABLE_PREPARATION_EXPIRY_EXTENDED";exit 2
fi
grep -Fq "APPEND_ONLY_PREPARATION" "$WORK/modify.log" ||
 { echo "FAIL:UNEXPECTED_IMMUTABILITY_RESPONSE";tail -7 "$WORK/modify.log";exit 2; }
echo "PASS:EXPIRED_PREPARATION_CANNOT_BE_REFRESHED_BY_UPDATE"
echo "PASS:REAL_FUNCTION_EXPIRY_BEHAVIOR_SYNTHETIC_FIXTURE_NO_HOSTED_WRITES"
