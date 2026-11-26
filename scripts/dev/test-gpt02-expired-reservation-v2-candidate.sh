#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NAME="gpt02-recovery-isolated-$$"
SOCKET="gpt02-recovery-socket-$$"
cleanup(){ docker rm -f "$NAME" >/dev/null 2>&1 || true; docker volume rm "$SOCKET" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker volume create "$SOCKET" >/dev/null
docker run -d --name "$NAME" --network none  --mount "type=volume,src=$SOCKET,dst=/var/run/postgresql"  -e POSTGRES_PASSWORD=synthetic-only postgres:16-alpine  -c unix_socket_directories=/var/run/postgresql >/dev/null
for i in $(seq 1 50); do
 logs="$(docker logs "$NAME" 2>&1 || true)"
 if [[ "$logs" == *'PostgreSQL init process complete'* ]] &&
 [[ "${logs#*PostgreSQL init process complete}" == *'database system is ready to accept connections'* ]] &&
 docker exec "$NAME" psql -X -U postgres -Atqc 'SELECT 1' >/dev/null 2>&1;then break;fi
 sleep 1
done
pg(){ docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres -d gpt02_recovery_isolated "$@"; }
docker exec "$NAME" psql -X -U postgres -v ON_ERROR_STOP=1 -c 'CREATE DATABASE gpt02_recovery_isolated' >/dev/null
pg -q < "$ROOT/scripts/dev/gpt02-expired-reservation-v2-candidate.sql"
echo PASS:ISOLATED_SCHEMA_INSTALLED_NO_NETWORK
pg -q <<'SQL'
INSERT INTO gpt02_stage.core_preparations
(company_id,hub_task_id,attempt_id,core_task_id,hub_execution_id,expires_at)
VALUES ('default',183,'00000000-0000-4000-8000-000000000001',
 '00000000-0000-4000-8000-000000000002',
 '00000000-0000-4000-8000-000000000003',clock_timestamp()-interval '3 minutes');
SQL
row="company_id,hub_task_id,attempt_number,original_attempt_id,original_core_task_id,original_hub_execution_id,candidate_attempt_id,candidate_core_task_id,candidate_hub_execution_id,candidate_command_id,idempotency_key,source_external_id,created_at,expires_at"
base="'default',183,2,'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000013','00000000-0000-4000-8000-000000000014','gpt02-managed-preparation:default:183:attempt:2','ai-task:default:183:attempt:2'"
insert="INSERT INTO gpt02_stage.recovery_review_candidates_v2($row) VALUES ($base,clock_timestamp(),clock_timestamp()+interval '5 minutes')"
pg -q -c "$insert"
echo PASS:ONE_VERSIONED_REVIEW_ONLY_NO_JOB_OR_COMMAND
expectDenied(){
 local label="$1" sql="$2" err="$3" output
 if output="$(pg -Atqc "$sql" 2>&1)";then echo "FAIL:$label accepted";exit 4;fi
 if [[ "$output" != *"$err"* ]];then echo "FAIL:$label mismatch";echo "$output" | tail -3;exit 4;fi
 echo "PASS:$label"
}
dup="INSERT INTO gpt02_stage.recovery_review_candidates_v2($row) VALUES ('default',183,2,'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000032','00000000-0000-4000-8000-000000000033','00000000-0000-4000-8000-000000000034','gpt02-managed-preparation:default:183:attempt:2','ai-task:default:183:attempt:2',clock_timestamp(),clock_timestamp()+interval '5 minutes')"
expectDenied DUPLICATE_ATTEMPT_NUMBER "$dup" 'duplicate key value'
expectDenied IMMUTABLE_UPDATE "UPDATE gpt02_stage.recovery_review_candidates_v2 SET review_status='approved'" 'APPEND_ONLY_RECOVERY_REVIEW'
expectDenied IMMUTABLE_DELETE "DELETE FROM gpt02_stage.recovery_review_candidates_v2" 'APPEND_ONLY_RECOVERY_REVIEW'
expectDenied IMMUTABLE_TRUNCATE "TRUNCATE gpt02_stage.recovery_review_candidates_v2" 'APPEND_ONLY_RECOVERY_REVIEW'
expectDenied UNAUTHORIZED_OWNER_APPROVAL "INSERT INTO gpt02_stage.recovery_review_candidates_v2($row,owner_approval_granted) VALUES ($base,clock_timestamp(),clock_timestamp()+interval '5 minutes',true)" 'violates check constraint'
expectDenied DIRECT_DISPATCH_FLAG "UPDATE gpt02_stage.recovery_review_candidates_v2 SET dispatch_permitted=true" 'APPEND_ONLY_RECOVERY_REVIEW'
expectDenied NO_PUBLISHED_COMMAND "UPDATE gpt02_stage.recovery_review_candidates_v2 SET issued_command_id=gen_random_uuid()" 'APPEND_ONLY_RECOVERY_REVIEW'
expectDenied NO_OVERLAP_WINDOW "INSERT INTO gpt02_stage.recovery_review_candidates_v2($row) VALUES ('default',183,3,'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000023','00000000-0000-4000-8000-000000000024','gpt02-managed-preparation:default:183:attempt:3','ai-task:default:183:attempt:3',clock_timestamp(),clock_timestamp()+interval '5 minutes')" 'recovery_v2_window_nonoverlap'
expected="$(pg -Atqc 'SELECT count(*) FROM gpt02_stage.recovery_review_candidates_v2 WHERE review_status='"'"'awaiting_independent_owner_review'"'"' AND owner_approval_granted=false AND dispatch_permitted=false AND issued_command_id IS NULL')"
[[ "$expected" == 1 ]] || { echo BAD_FINAL_REVIEW;exit 4; }
echo PASS:ONE_INERT_REVIEW_UNCHANGED
# A recovery review must never be accepted while the original reservation
# remains live. This mutation affects ONLY the disposable synthetic fixture.
pg -q -c "UPDATE gpt02_stage.core_preparations SET expires_at=clock_timestamp()+interval '2 hours' WHERE hub_task_id=183"
unexpired="INSERT INTO gpt02_stage.recovery_review_candidates_v2($row) VALUES ('default',183,4,'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000042','00000000-0000-4000-8000-000000000043','00000000-0000-4000-8000-000000000044','gpt02-managed-preparation:default:183:attempt:4','ai-task:default:183:attempt:4',clock_timestamp()+interval '3 hours',clock_timestamp()+interval '3 hours 5 minutes')"
expectDenied STILL_ACTIVE_ORIGINAL_DENIED "$unexpired" 'RECOVERY_REVIEW_SOURCE_OR_SCOPE_INVALID'
pg -q -c "UPDATE gpt02_stage.core_preparations SET expires_at=clock_timestamp()-interval '3 minutes' WHERE hub_task_id=183"
# Inert candidate has no Data API/application role access.
pg -q -c "CREATE ROLE synthetic_app_reader LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB"
if result="$(docker exec "$NAME" psql -X -At -U synthetic_app_reader -d gpt02_recovery_isolated -c 'SELECT count(*) FROM gpt02_stage.recovery_review_candidates_v2' 2>&1)";then
 echo 'FAIL:UNPRIVILEGED_ROLE_HAS_READ';exit 4
fi
[[ "$result" == *'permission denied'* ]] || { echo 'FAIL:UNEXPECTED_UNPRIVILEGED_ERROR';exit 4; }
echo PASS:UNPRIVILEGED_APP_READER_DENIED
expectDenied FOREIGN_TASK_DENIED "INSERT INTO gpt02_stage.recovery_review_candidates_v2($row) VALUES ('default',184,5,'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000051','00000000-0000-4000-8000-000000000052','00000000-0000-4000-8000-000000000053','00000000-0000-4000-8000-000000000054','gpt02-managed-preparation:default:184:attempt:5','ai-task:default:184:attempt:5',clock_timestamp(),clock_timestamp()+interval '5 minutes')" 'RECOVERY_REVIEW_SOURCE_OR_SCOPE_INVALID'
echo PROD_AND_CST_DEV_UNCHANGED=TRUE
