#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NAME="gpt02-bound-preparer-$PPID-$$"
SOCKET="gpt02-bound-sock-$PPID-$$"
WORK="$(mktemp -d)"
cleanup(){
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker volume rm "$SOCKET" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
# NO HOSTED DB / NO TCP / NO EXTERNAL NETWORK / NO SIGNER / NO DISPATCH
docker volume create "$SOCKET" >/dev/null
docker run -d --name "$NAME" --network none \
  --mount "type=volume,src=$SOCKET,dst=/var/run/postgresql" \
  -e POSTGRES_PASSWORD=synthetic-only postgres:16-alpine \
  -c unix_socket_directories=/var/run/postgresql >/dev/null
ready=false
for i in $(seq 1 60); do
  logs="$(docker logs "$NAME" 2>&1 || true)"
  if [[ "$logs" == *'PostgreSQL init process complete'* ]] &&
    [[ "${logs#*PostgreSQL init process complete}" == *'database system is ready to accept connections'* ]] &&
    docker exec "$NAME" psql -X -U postgres -Atqc 'SELECT 1' >/dev/null 2>&1; then
    ready=true;break
  fi
  sleep 1
done
[[ "$ready" == true ]] || { echo ISOLATED_POSTGRES_NOT_READY >&2; exit 3; }
docker exec "$NAME" psql -X -U postgres -v ON_ERROR_STOP=1 \
  -c 'CREATE DATABASE gpt02_core_preparation_isolated' >/dev/null
# Reuse existing tested Core/Hub atomic fixture, but DO NOT alter its source.
awk -v policies="$ROOT/scripts/dev/gpt02-core-preparer-rls-candidate.sql" '
  $0=="-- GPT02_PREPARER_RLS_POLICY_INJECTION_POINT" {
    while((getline line < policies)>0) print line
    close(policies);next
  }
  {print}
' "$ROOT/scripts/dev/gpt02-core-task-preparation-isolated.sql" |
  docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres \
    -d gpt02_core_preparation_isolated -q >"$WORK/init.log" 2>&1 ||
    { tail -40 "$WORK/init.log";exit 3; }

psqlAs(){
  local user="$1";shift
  docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -At \
    -U "$user" -d gpt02_core_preparation_isolated "$@"
}
# Hosted source's internal function has a different name and NO preparer EXECUTE.
psqlAs postgres -c "ALTER TABLE public.ai_tasks
  ADD COLUMN description text,
  ADD COLUMN source text NOT NULL DEFAULT 'manual';
  ALTER FUNCTION gpt02_stage.prepare_core_task(text,integer,text,text,text,text)
  RENAME TO prepare_core_task_v1_internal;
  REVOKE EXECUTE ON FUNCTION gpt02_stage.prepare_core_task_v1_internal(text,integer,text,text,text,text)
  FROM gpt02_core_prep_login;" >/dev/null
instruction='DEV E2E verification only for Task #171. Reply exactly GPT02_DEV_E2E_171_ACK. No external writes.'
psqlAs postgres -c "INSERT INTO public.ai_tasks
  (id,company_id,status,title,assigned_to_id,assigned_to,description,source)
  VALUES(171,'default','new_inquiry','AI Core bridge command 057d9f3d',
  5,'Synthetic PIC','AI Core bridge command 057d9f3d','manual');
  INSERT INTO public.audit_logs(id,company_id,entity_id,action,after,user_email)
  VALUES(2171,'default','171','gpt02_pic_assigned',
  jsonb_build_object('taskId',171,'companyId','default','memberId',5,
    'memberName','Synthetic PIC','actorIdentity',jsonb_build_object(
    'id','google_fixture_super_admin','version',1,
    'role','super_admin','email','admin@example.invalid'))::text,
    'admin@example.invalid');" >/dev/null
# Run exactly the candidate DDL as its existing function owner.
# The SQL file contains no credential, GRANT, role alteration or dispatch.
{
  printf 'BEGIN;\nSET LOCAL ROLE gpt02_core_prep_owner;\n'
  cat "$ROOT/scripts/dev/gpt02-preparer-instruction-bound-wrapper-candidate.sql"
  printf '\nREVOKE ALL ON FUNCTION gpt02_stage.prepare_core_task(text,integer,text,text,text,text) FROM PUBLIC;\n'
  printf 'GRANT EXECUTE ON FUNCTION gpt02_stage.prepare_core_task(text,integer,text,text,text,text) TO gpt02_core_prep_login;\n'
  printf 'COMMIT;\n'
} | docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres \
  -d gpt02_core_preparation_isolated >"$WORK/ddl.log" 2>&1 ||
  { tail -35 "$WORK/ddl.log";exit 3; }

identity="$(psqlAs postgres -c "
 SELECT pg_get_userbyid(p.proowner)||'|'||p.prosecdef::text||'|'||
 has_function_privilege('gpt02_core_prep_login',p.oid,'EXECUTE')::text
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='gpt02_stage' AND p.proname='prepare_core_task'")"
[[ "$identity" == 'gpt02_core_prep_owner|true|true' ]] ||
  { echo WRAPPER_OWNER_OR_ACL_CHANGED >&2;exit 1; }
internal="$(psqlAs postgres -c "
 SELECT has_function_privilege('gpt02_core_prep_login',p.oid,'EXECUTE')::text
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='gpt02_stage' AND p.proname='prepare_core_task_v1_internal'")"
[[ "$internal" == false ]] || { echo INTERNAL_ENTRYPOINT_EXPOSED >&2;exit 1; }
echo PASS:WRAPPER_ONLY_EXECUTE_AND_OWNER_PRESERVED
# Postgres 16 CREATE OR REPLACE on an existing non-postgres-owned function must
# retain the original owner and the exact EXECUTE ACL (hosted rollout semantics).
before_acl="$(psqlAs postgres -c "
 SELECT pg_get_userbyid(p.proowner)||'|'||p.proacl::text
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='gpt02_stage' AND p.proname='prepare_core_task'")"
docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres \
  -d gpt02_core_preparation_isolated -q \
  < "$ROOT/scripts/dev/gpt02-preparer-instruction-bound-wrapper-candidate.sql" \
  >"$WORK/replacement.log" 2>&1 ||
  { tail -20 "$WORK/replacement.log";exit 3; }
after_acl="$(psqlAs postgres -c "
 SELECT pg_get_userbyid(p.proowner)||'|'||p.proacl::text
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='gpt02_stage' AND p.proname='prepare_core_task'")"
[[ "$after_acl" == "$before_acl" ]] ||
  { echo FAIL:OWNER_OR_PRIVILEGE_CHANGED_ON_REPLACEMENT >&2;exit 1; }
echo PASS:POSTGRES_CREATE_OR_REPLACE_PRESERVES_EXISTING_OWNER_AND_ACL

project='GPT02 DEV coding lifecycle'
repo='Travelintrips/Core-AI-Foundation'
branch='develop'
q(){
  local task="$1" value="${2:-$instruction}"
  printf "SELECT core_task_id::text,command_candidate_id::text,attempt_id::text,hub_execution_id::text,created,dispatch_permitted FROM gpt02_stage.prepare_core_task('default',%s,'%s','%s','%s','%s');\n" \
    "$task" "$project" "$repo" "$branch" "$value"
}
expectDenied(){
  local label="$1" who="$2" query="$3" code="$4"
  if printf '%s\n' "$query" | psqlAs "$who" >"$WORK/error.log" 2>&1; then
    echo "FAIL:${label}:unexpected_success" >&2;exit 1
  fi
  grep -Fq "$code" "$WORK/error.log" ||
    { echo "FAIL:${label}:wrong_denial" >&2;tail -7 "$WORK/error.log";exit 1; }
  echo "PASS:$label"
}
expectEmpty(){
  local n
  n="$(psqlAs postgres -c "SELECT
    (SELECT count(*) FROM public.ai_execution_jobs WHERE task_id=171)::text||'|'||
    (SELECT count(*) FROM gpt02_stage.core_preparations WHERE hub_task_id=171)::text||'|'||
    (SELECT count(*) FROM ai_platform.ai_coding_tasks WHERE task_number LIKE 'GPT02DEV-171-%')::text;")"
  [[ "$n" == '0|0|0' ]] || { echo "FAIL:ORPHAN_PREPARATION:${n}" >&2;exit 1; }
}
expectDenied STALE_BRIDGE_PLACEHOLDER_DENIED gpt02_core_prep_login \
  "$(q 171 'AI Core bridge command 057d9f3d')" PREPARATION_TASK_INSTRUCTION_NOT_BOUND
expectEmpty
psqlAs postgres -c "UPDATE public.ai_tasks SET
  title='GPT02 DEV fresh E2E Task #171',
  description='$instruction' WHERE id=171;" >/dev/null
expectDenied DIFFERENT_INSTRUCTION_DENIED gpt02_core_prep_login \
  "$(q 171 'DEV E2E wrong command not in task')" PREPARATION_TASK_INSTRUCTION_NOT_BOUND
expectEmpty
psqlAs postgres -c "UPDATE public.ai_tasks SET status='assigned' WHERE id=171;" >/dev/null
expectDenied NON_NEW_INQUIRY_DENIED gpt02_core_prep_login "$(q 171)" PREPARATION_TASK_INSTRUCTION_NOT_BOUND
expectEmpty
psqlAs postgres -c "UPDATE public.ai_tasks SET status='new_inquiry',source='whatsapp' WHERE id=171;" >/dev/null
expectDenied NON_MANUAL_SOURCE_DENIED gpt02_core_prep_login "$(q 171)" PREPARATION_TASK_INSTRUCTION_NOT_BOUND
expectEmpty
psqlAs postgres -c "UPDATE public.ai_tasks SET source='manual',title='AI Core bridge command 057d9f3d' WHERE id=171;" >/dev/null
expectDenied OLD_TITLE_NEW_BODY_DENIED gpt02_core_prep_login "$(q 171)" PREPARATION_TASK_INSTRUCTION_NOT_BOUND
expectEmpty
psqlAs postgres -c "UPDATE public.ai_tasks SET title='GPT02 DEV fresh E2E Task #171' WHERE id=171;" >/dev/null
expectDenied OLD_TASK_137_STILL_DENIED gpt02_core_prep_login "$(q 137)" PREPARATION_SCOPE_DENIED
expectEmpty
expectDenied SESSION_IMPERSONATION_DENIED postgres "$(q 171)" PREPARATION_SCOPE_DENIED
expectEmpty
expectDenied INTERNAL_FUNCTION_DIRECT_DENIED gpt02_core_prep_login \
  "SELECT * FROM gpt02_stage.prepare_core_task_v1_internal('default',171,'$project','$repo','$branch','$instruction');" \
  'permission denied'
expectEmpty

# The only allowed transition remains prepared / PENDING / NO dispatch.
first="$(q 171 | psqlAs gpt02_core_prep_login)"
IFS='|' read -r core cmd attempt hub created dispatch <<<"$first"
[[ "$created" == t && "$dispatch" == f && "$core" != "$cmd" && "$hub" != "$core" ]] ||
  { echo VALID_PREPARATION_DID_NOT_RETURN_NO_DISPATCH >&2;exit 1; }
echo PASS:ONE_ATOMIC_CORE_HUB_PREPARATION_ZERO_DISPATCH
job="$(psqlAs postgres -c "SELECT status||'|'||coalesce(command_id::text,'NULL')||'|'||
 callback_verified::text||'|'||attestation_verified::text||'|'||final_ack_verified::text
 FROM public.ai_execution_jobs WHERE task_id=171;")"
[[ "$job" == 'prepared|NULL|false|false|false' ]] ||
  { echo UNEXPECTED_ACTIVE_WORKER_OR_COMMAND >&2;exit 1; }
replay="$(q 171 | psqlAs gpt02_core_prep_login)"
[[ "$replay" == "${first%|t|f}|f|f" ]] ||
  { echo REPLAY_NOT_IDEMPOTENT >&2;exit 1; }
echo PASS:IDEMPOTENT_NO_SECOND_ATTEMPT
psqlAs postgres -c "UPDATE public.ai_tasks SET description='DEV E2E changed after preparation' WHERE id=171;" >/dev/null
expectDenied CHANGED_PERSISTED_INSTRUCTION_DENIED gpt02_core_prep_login "$(q 171)" PREPARATION_TASK_INSTRUCTION_NOT_BOUND
[[ "$(psqlAs postgres -c "SELECT count(*) FROM ai_platform.ai_coding_bridge_commands")" == 0 ]] ||
  { echo COMMAND_UNEXPECTEDLY_CREATED >&2;exit 1; }
echo GPT02_PREPARER_TASK_SOURCE_BOUND_ISOLATED_PASS:NO_LIVE_DB_NO_DISPATCH
