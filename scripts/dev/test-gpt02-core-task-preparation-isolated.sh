#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NAME="gpt02-core-preparation-$PPID-$$"
WORK="$(mktemp -d)"
SOCKET="gpt02-core-prep-socket-$PPID-$$"
cleanup(){ docker rm -f "$NAME" >/dev/null 2>&1 || true; docker volume rm "$SOCKET" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
# Isolated PostgreSQL, no published ports, no network, no CST credential.
docker volume create "$SOCKET" >/dev/null
docker run -d --name "$NAME" --network none --mount "type=volume,src=$SOCKET,dst=/var/run/postgresql" -e POSTGRES_PASSWORD=synthetic-only postgres:16-alpine -c unix_socket_directories=/var/run/postgresql >/dev/null
ready=false
for i in $(seq 1 60); do
 # PostgreSQL's temporary init server also answers SELECT 1, then exits and
 # drops its socket. Require a ready-to-accept message AFTER the init phase.
 logs="$(docker logs "$NAME" 2>&1 || true)"
 if [[ "$logs" == *'PostgreSQL init process complete'* ]] &&
    [[ "${logs#*PostgreSQL init process complete}" == *'database system is ready to accept connections'* ]] &&
    docker exec "$NAME" psql -X -U postgres -Atqc 'SELECT 1' >/dev/null 2>&1; then
   ready=true;break
 fi
 sleep 1
done
[[ "$ready" == true ]] || { echo ISOLATED_PG_NOT_READY >&2; exit 3; }
docker exec "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres -c 'CREATE DATABASE gpt02_core_preparation_isolated' >/dev/null
docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres -d gpt02_core_preparation_isolated -q < "$ROOT/scripts/dev/gpt02-core-task-preparation-isolated.sql" >"$WORK/init.log" 2>&1 || { tail -18 "$WORK/init.log"; exit 3; }
psqlAs(){ local user="$1"; shift; docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -At -U "$user" -d gpt02_core_preparation_isolated "$@"; }
project='GPT02 DEV coding lifecycle';repo='Travelintrips/Core-AI-Foundation';branch='develop';instruction='PREPARE ONLY, never issue a command.'
q(){ local task="$1"; shift; printf "SELECT core_task_id::text,command_candidate_id::text,attempt_id::text,hub_execution_id::text,created,dispatch_permitted FROM gpt02_stage.prepare_core_task('default',%s,'%s','%s','%s','%s');\n" "$task" "$project" "$repo" "$branch" "${1:-$instruction}"; }
expectDenied(){ local tag="$1" who="$2" sql="$3" expected="$4"; local out
 if printf '%s\n' "$sql" | psqlAs "$who" >"$WORK/result.log" 2>&1; then echo "FAIL:$tag:unexpected_success" >&2; exit 1;fi
 grep -Fq "$expected" "$WORK/result.log" || { echo "FAIL:$tag:unexpected_error" >&2; tail -6 "$WORK/result.log";exit 1; }
 echo "PASS:$tag"
}
# Verify that the session authenticates as a dedicated role; never SET ROLE.
identity="$(psqlAs gpt02_core_prep_login -c "SELECT current_user||':'||session_user||':'||(SELECT rolbypassrls::text FROM pg_roles WHERE rolname=current_user)")"
[[ "$identity" == gpt02_core_prep_login:gpt02_core_prep_login:false ]] || { echo WRONG_TEST_LOGIN >&2;exit 1; }
echo PASS:DEDICATED_NONPRIVILEGED_LOGIN
expectDenied DIRECT_WRITE_FORBIDDEN gpt02_core_prep_login 'INSERT INTO gpt02_stage.core_preparations DEFAULT VALUES' 'permission denied'
expectDenied HUB_EXECUTION_DIRECT_READ_FORBIDDEN gpt02_core_prep_login 'SELECT id FROM public.ai_execution_jobs LIMIT 1' 'permission denied'
expectDenied HUB_EXECUTION_DIRECT_WRITE_FORBIDDEN gpt02_core_prep_login 'INSERT INTO public.ai_execution_jobs DEFAULT VALUES' 'permission denied'
expectDenied CORE_TASK_DIRECT_ACCESS_FORBIDDEN gpt02_core_prep_login 'SELECT id FROM ai_platform.ai_coding_tasks LIMIT 1' 'permission denied'
expectDenied ROLE_SWITCH_FORBIDDEN gpt02_core_prep_login 'SET ROLE postgres' 'permission denied'
expectDenied TASK135_FORBIDDEN gpt02_core_prep_login "$(q 135)" PREPARATION_SCOPE_DENIED
expectDenied OLD_SUCCESSFUL_TASK136_FORBIDDEN gpt02_core_prep_login "$(q 136)" PREPARATION_SCOPE_DENIED
expectDenied FOREIGN_TENANT_FORBIDDEN gpt02_core_prep_login "SELECT * FROM gpt02_stage.prepare_core_task('other',138,'$project','$repo','$branch','$instruction')" PREPARATION_SCOPE_DENIED
expectDenied WRONG_REPOSITORY_FORBIDDEN gpt02_core_prep_login "SELECT * FROM gpt02_stage.prepare_core_task('default',137,'$project','Travelintrips/OtherRepo','$branch','$instruction')" PREPARATION_SCOPE_DENIED
expectDenied ROLE_IMPERSONATION_FORBIDDEN postgres "SET SESSION AUTHORIZATION postgres; $(q 137)" PREPARATION_SCOPE_DENIED
# Hosted Supabase puts pgcrypto.digest in extensions, not public. A preparer
# must use the explicit qualified function and have scoped USAGE, not PUBLIC fallback.
[[ "$(psqlAs postgres -c "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='extensions' AND p.proname='digest'")" == 2 ]] || { echo PGCRYPTO_HOSTED_SCHEMA_MISMATCH >&2; exit 1; }
psqlAs postgres -c 'REVOKE USAGE ON SCHEMA extensions FROM gpt02_core_prep_owner' >/dev/null
expectDenied EXTENSION_SCHEMA_GRANT_REQUIRED gpt02_core_prep_login "$(q 137)" 'permission denied for schema extensions'
psqlAs postgres -c 'GRANT USAGE ON SCHEMA extensions TO gpt02_core_prep_owner' >/dev/null
# Two concurrently authenticated sessions prepare the SAME future task.
for n in 1 2; do (q 137 | psqlAs gpt02_core_prep_login >"$WORK/race$n") & done
wait
first="$(cat "$WORK/race1")";second="$(cat "$WORK/race2")"
[[ -n "$first" && -n "$second" ]] || { echo EMPTY_RACE_RESULT >&2;exit 1; }
IFS='|' read -r a_core a_cmd a_attempt a_hub a_created a_dispatch <<< "$first"
IFS='|' read -r b_core b_cmd b_attempt b_hub b_created b_dispatch <<< "$second"
[[ "$a_core" == "$b_core" && "$a_cmd" == "$b_cmd" && "$a_attempt" == "$b_attempt" && "$a_hub" == "$b_hub" ]] || { echo RACE_DIFFERENT_IDENTITIES >&2;exit 1; }
[[ "$a_created$b_created" == tf || "$a_created$b_created" == ft ]] || { echo RACE_NOT_ONE_CREATION >&2;exit 1; }
[[ "$a_dispatch$b_dispatch" == ff ]] || { echo RACE_GRANTED_DISPATCH >&2;exit 1; }
echo PASS:ATOMIC_TWO_PREPARERS_ONE_CORE_TASK_NO_DISPATCH
# Real Hub-shaped row is reserved concurrently with the Core task; no worker,
# command, lease, approval, callback or auto-continuation is produced.
job="$(psqlAs postgres -c "SELECT id::text||'|'||status||'|'||source||'|'||external_id||'|'||idempotency_key||'|'||coalesce(command_id::text,'NULL')||'|'||coalesce(worker_id,'NULL')||'|'||coalesce(assigned_client_id,'NULL')||'|'||callback_verified::text||'|'||attestation_verified::text||'|'||final_ack_verified::text||'|'||(metadata->>'coreTaskId')||'|'||(metadata->>'commandCandidateId')||'|'||(metadata->>'attemptId')||'|'||(metadata->>'autoContinue')||'|'||(metadata->>'dispatchStarted') FROM public.ai_execution_jobs WHERE task_id=137")"
[[ "$job" == "$a_hub|prepared|AI_TASK|ai-task:default:137|gpt02-managed-preparation:default:137|NULL|NULL|NULL|false|false|false|$a_core|$a_cmd|$a_attempt|false|false" ]] || { echo "INVALID_PREPARED_HUB_ROW" >&2;exit 1; }
echo PASS:EXACT_ATOMIC_HUB_CORE_ROW_NO_WORKER_COMMAND_OR_CALLBACK

replay="$(q 137 | psqlAs gpt02_core_prep_login)"
IFS='|' read -r c_core c_cmd c_attempt c_hub c_created c_dispatch <<< "$replay"
[[ "$c_core" == "$a_core" && "$c_cmd" == "$a_cmd" && "$c_attempt" == "$a_attempt" && "$c_hub" == "$a_hub" && "$c_created" == f && "$c_dispatch" == f ]] || { echo REPLAY_NOT_IDEMPOTENT >&2;exit 1; }
echo PASS:SAME_REQUEST_IDEMPOTENT_NO_NEW_ATTEMPT
# The same pre-dispatch identity MUST refuse reused job state after an unrelated
# actor changes its execution status, rather than marking a prior send approved.
psqlAs postgres -c "UPDATE public.ai_execution_jobs SET status='running' WHERE id='$a_hub'" >/dev/null
expectDenied PREPARED_HUB_STATUS_DRIFT_DENIED gpt02_core_prep_login "$(q 137)" PREPARATION_CHANGED_OR_ALREADY_STARTED
psqlAs postgres -c "UPDATE public.ai_execution_jobs SET status='prepared' WHERE id='$a_hub'" >/dev/null
[[ "$(q 137 | psqlAs gpt02_core_prep_login)" == "$replay" ]] || { echo HUB_STATUS_REPLAY_NOT_STABLE >&2;exit 1; }
echo PASS:PREPARED_HUB_STATE_RESTORED_IDEMPOTENT

expectDenied MUTATED_INSTRUCTION_DENIED gpt02_core_prep_login "$(q 137 'different instruction')" PREPARATION_CHANGED_OR_ALREADY_STARTED
# New audited task 139 can be prepared; a linked Core RUN later blocks reuse.
q 139 | psqlAs gpt02_core_prep_login >"$WORK/new139"
core139="$(cut -d'|' -f1 "$WORK/new139")"
psqlAs postgres -c "INSERT INTO ai_platform.ai_coding_runs(id,task_id,status) VALUES(gen_random_uuid(),'$core139','PENDING')" >/dev/null
expectDenied STARTED_CORE_TASK_REUSE_DENIED gpt02_core_prep_login "$(q 139)" PREPARATION_CHANGED_OR_ALREADY_STARTED
# Transaction error after Core task insertion must rollback that task too.
psqlAs postgres -c "CREATE FUNCTION gpt02_stage.synthetic_fail() RETURNS trigger LANGUAGE plpgsql AS \$\$ BEGIN RAISE EXCEPTION 'synthetic failure'; END \$\$; CREATE TRIGGER synthetic_fail BEFORE INSERT ON gpt02_stage.core_preparations FOR EACH ROW EXECUTE FUNCTION gpt02_stage.synthetic_fail()" >/dev/null
expectDenied ATOMIC_ROLLBACK_ON_INSERT_FAILURE gpt02_core_prep_login "$(q 141)" 'synthetic failure'
psqlAs postgres -c 'DROP TRIGGER synthetic_fail ON gpt02_stage.core_preparations; DROP FUNCTION gpt02_stage.synthetic_fail()' >/dev/null
n="$(psqlAs postgres -c "SELECT count(*) FROM ai_platform.ai_coding_tasks WHERE task_number LIKE 'GPT02DEV-141-%'")"
[[ "$n" == 0 ]] || { echo CORE_TASK_LEFT_AFTER_ROLLBACK >&2;exit 1; }
[[ "$(psqlAs postgres -c "SELECT count(*) FROM public.ai_execution_jobs WHERE task_id=141")" == 0 ]] || { echo ORPHAN_HUB_EXECUTION_ON_PREP_FAILURE >&2; exit 1; }
[[ "$(psqlAs postgres -c "SELECT count(*) FROM gpt02_stage.core_preparations WHERE hub_task_id=141")" == 0 ]] || { echo ORPHAN_PREPARATION_ON_FAILURE >&2; exit 1; }
echo PASS:NO_ORPHAN_CODING_TASK_AFTER_ROLLBACK
# Simulate a Hub execution insertion error *after* Core PENDING insertion.
# Both ledgers must roll back in the very same transaction.
psqlAs postgres -c "CREATE FUNCTION public.synthetic_hub_failure() RETURNS trigger LANGUAGE plpgsql AS \$\$ BEGIN RAISE EXCEPTION 'synthetic Hub write failure'; END \$\$; CREATE TRIGGER hub_failure BEFORE INSERT ON public.ai_execution_jobs FOR EACH ROW WHEN (NEW.task_id=143) EXECUTE FUNCTION public.synthetic_hub_failure()" >/dev/null
expectDenied HUB_INSERT_ROLLS_BACK_CORE_TASK gpt02_core_prep_login "$(q 143)" 'synthetic Hub write failure'
psqlAs postgres -c 'DROP TRIGGER hub_failure ON public.ai_execution_jobs; DROP FUNCTION public.synthetic_hub_failure()' >/dev/null
[[ "$(psqlAs postgres -c "SELECT count(*) FROM ai_platform.ai_coding_tasks WHERE task_number LIKE 'GPT02DEV-143-%'")" == 0 ]] || { echo CORE_ORPHAN_AFTER_HUB_FAILURE >&2;exit 1; }
[[ "$(psqlAs postgres -c "SELECT count(*) FROM gpt02_stage.core_preparations WHERE hub_task_id=143")" == 0 ]] || { echo PREP_ORPHAN_AFTER_HUB_FAILURE >&2;exit 1; }
[[ "$(psqlAs postgres -c "SELECT count(*) FROM public.ai_execution_jobs WHERE task_id=143")" == 0 ]] || { echo HUB_ORPHAN_AFTER_HUB_FAILURE >&2;exit 1; }
echo PASS:HUB_INSERT_FAILURE_ATOMIC_ROLLBACK_ALL_LEDGERS
q 141 | psqlAs gpt02_core_prep_login >"$WORK/new141"
[[ "$(cut -d'|' -f5-6 "$WORK/new141")" == t\|f ]] || { echo WRONG_PREPARE_RESULT >&2;exit 1; }
# Mutate an audit as a fixture admin: it must never reuse a stale preparation.
psqlAs postgres -c "UPDATE public.audit_logs SET after=jsonb_set(after::jsonb,'{actorIdentity,id}','\"google_fixture_staff\"')::text WHERE entity_id='140'" >/dev/null
expectDenied ALTERED_OPERATOR_AUDIT_DENIED gpt02_core_prep_login "$(q 140)" ACTIVE_OPERATOR_IDENTITY_REQUIRED
# Hosted public.users.company_id is INTEGER NULLABLE, whereas ai_tasks.company_id is TEXT.
# A numeric company assignment may not be coerced into the tenant slug "default".
expectDenied NUMERIC_COMPANY_ID_NOT_TENANT_AUTHORITY gpt02_core_prep_login "$(q 142)" ACTIVE_OPERATOR_IDENTITY_REQUIRED
# All generated Core coding tasks are PENDING, no Core commands or runs except the injected fixture.
counts="$(psqlAs postgres -c "SELECT (SELECT count(*) FROM gpt02_stage.core_preparations)||':'||(SELECT count(*) FROM ai_platform.ai_coding_tasks)||':'||(SELECT count(*) FROM public.ai_execution_jobs WHERE status='prepared')||':'||(SELECT count(*) FROM ai_platform.ai_coding_bridge_commands)||':'||(SELECT count(*) FROM ai_platform.ai_coding_runs)")"
[[ "$counts" == 3:3:3:0:1 ]] || { echo "WRONG_CORE_COUNTS:$counts" >&2; exit 1; }
echo PASS:EXACT_THREE_ATOMIC_HUB_CORE_PREPARATIONS_ZERO_COMMANDS
# Prepared rows cannot be updated, deleted or truncated even by fixture DB admin.
expectDenied IMMUTABLE_PREPARED_LEDGER postgres 'UPDATE gpt02_stage.core_preparations SET member_id=6' APPEND_ONLY_PREPARATION
# A locally available DEV runtime image permits a real Node + PostgreSQL-socket
# integration probe. GitHub CI runs SQL integration plus Node unit tests; its
# hosted runner does not contain the private DEV image and must not fetch it.
NODE_IMAGE="${GPT02_CORE_LOCAL_NODE_IMAGE:-ai-task-hub:dev-lifecycle-held-20261109}"
if docker image inspect "$NODE_IMAGE" >/dev/null 2>&1; then
 docker run --rm --network none --entrypoint node \
  --mount "type=volume,src=$SOCKET,dst=/var/run/postgresql" \
  --mount "type=bind,src=$ROOT/artifacts/api-server/src/lib/gpt02-core-task-preparation.mjs,dst=/tmp/gpt02-core-task-preparation.mjs,readonly" \
  --mount "type=bind,src=$ROOT/scripts/dev/gpt02-core-preparation-module-smoke.mjs,dst=/tmp/gpt02-core-preparation-module-smoke.mjs,readonly" \
  -e GPT02_CORE_FIXTURE_ONLY=1 "$NODE_IMAGE" /tmp/gpt02-core-preparation-module-smoke.mjs
 # Real isolated committed Hub/Core rows can now be matched to separately
 # signed approval, Hub operator and Core operator evidence, still with no grant.
 docker run --rm --network none --entrypoint node \
  --mount "type=volume,src=$SOCKET,dst=/var/run/postgresql" \
  --mount "type=bind,src=$ROOT/artifacts/api-server/src/lib/gpt02-prepared-link.mjs,dst=/tmp/gpt02-prepared-link.mjs,readonly" \
  --mount "type=bind,src=$ROOT/artifacts/api-server/src/lib/gpt02-issuer-store.mjs,dst=/tmp/gpt02-issuer-store.mjs,readonly" \
  --mount "type=bind,src=$ROOT/artifacts/api-server/src/lib/gpt02-operator-link.mjs,dst=/tmp/gpt02-operator-link.mjs,readonly" \
  --mount "type=bind,src=$ROOT/scripts/dev/gpt02-hub-core-prepared-link-smoke.mjs,dst=/tmp/gpt02-hub-core-prepared-link-smoke.mjs,readonly" \
  -e GPT02_CORE_FIXTURE_ONLY=1 "$NODE_IMAGE" /tmp/gpt02-hub-core-prepared-link-smoke.mjs
else
 echo 'OPTIONAL_NODE_DATABASE_SOCKET_SMOKE_SKIPPED_NO_LOCAL_IMAGE; SQL_AND_NODE_UNIT_TESTS_REQUIRED'
fi
# No operational issuer/dispatch API nor grant gets created by this stage.
echo 'GPT02_HUB_CORE_ATOMIC_PREPARATION_ISOLATED_PASS: THREE_MATCHED_PAIRS, ZERO_COMMANDS, NO_LIVE_CHANGES'
