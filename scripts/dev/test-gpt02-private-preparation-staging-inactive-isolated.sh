#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NAME="gpt02-inactive-schema-$$";WORK="$(mktemp -d)"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1||true;rm -rf "$WORK";}
trap cleanup EXIT
docker run -d --name "$NAME" --network none -e POSTGRES_PASSWORD=fixture-only postgres:16-alpine >/dev/null
ready=false
for i in $(seq 1 45);do
 if ! docker logs "$NAME" 2>&1 | grep -q 'PostgreSQL init process complete';then sleep 1;continue;fi
 if docker exec "$NAME" psql -X -U postgres -d postgres -Atqc 'SELECT 1' >/dev/null 2>&1;then ready=true;break;fi
 sleep 1
done
[[ "$ready" == true ]] || { echo ISOLATED_POSTGRES_NOT_READY >&2; exit 2; }
docker exec -i "$NAME" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -q < "$ROOT/scripts/dev/gpt02-core-preparer-role-dormant.sql" > "$WORK/role.log" 2>&1
# Exact minimum UUID relation shape. No user/production rows or network.
docker exec -i "$NAME" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE SCHEMA ai_platform;
CREATE TABLE public.ai_execution_jobs(id uuid PRIMARY KEY);
CREATE TABLE ai_platform.ai_coding_tasks(id uuid PRIMARY KEY);
SQL
{ printf 'BEGIN;\n';cat "$ROOT/scripts/dev/gpt02-private-preparation-staging-inactive.sql";printf '\nCOMMIT;\n'; } | docker exec -i "$NAME" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -q > "$WORK/create.log" 2>&1 || { tail -30 "$WORK/create.log";exit 2; }
status="$(docker exec "$NAME" psql -X -U postgres -d postgres -Atqc "SELECT count(*)::int||':'||bool_and(c.relrowsecurity AND c.relforcerowsecurity)||':'||(SELECT count(*)::int FROM gpt02_stage.core_preparations)||':'||(SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='gpt02_stage' AND p.prosecdef)||':'||(SELECT rolcanlogin::text FROM pg_roles WHERE rolname='gpt02_core_prep_login') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='gpt02_stage' AND c.relkind='r'")"
[[ "$status" == '1:true:0:0:false' ]]|| { echo  "UNSAFE_SCHEMA_STATE:$status" >&2; exit 1; }
echo PASS:ONE_PRIVATE_FORCE_RLS_EMPTY_TABLE_NO_DEFINER_NO_LOGIN
access="$(docker exec "$NAME" psql -X -U postgres -d postgres -Atqc "SELECT has_schema_privilege('gpt02_core_prep_login','gpt02_stage','USAGE')||':'||has_table_privilege('gpt02_core_prep_login','gpt02_stage.core_preparations','SELECT,INSERT,UPDATE,DELETE')||':'||has_function_privilege('gpt02_core_prep_login','gpt02_stage.preparation_contract_version()','EXECUTE')||':'||has_function_privilege('public','gpt02_stage.preparation_contract_version()','EXECUTE')")"
[[ "$access" == 'false:false:false:false' ]] || { echo "INACTIVE_ROLE_HAS_PRIVILEGES:$access" >&2; exit 1; }
echo PASS:NO_PUBLIC_OR_PREPARER_GRANTS
owner_members="$(docker exec "$NAME" psql -X -U postgres -d postgres -Atqc "SELECT count(*)::int FROM pg_auth_members WHERE roleid=(SELECT oid FROM pg_roles WHERE rolname='gpt02_core_prep_owner') AND (member IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname='postgres') OR set_option OR inherit_option OR NOT admin_option)")"
[[ "$owner_members" == 0 ]] || { echo "OWNER_MEMBERSHIP_NOT_REVOKED:$owner_members" >&2;exit 1; }
echo PASS:TEMPORARY_SET_INHERIT_MEMBERSHIP_REVOKED
owner_acl="$(docker exec "$NAME" psql -X -U postgres -d postgres -Atqc "SELECT has_database_privilege('gpt02_core_prep_owner',current_database(),'CREATE')||':'||has_table_privilege('gpt02_core_prep_owner','public.ai_execution_jobs','SELECT,INSERT,UPDATE,DELETE,REFERENCES')||':'||has_table_privilege('gpt02_core_prep_owner','ai_platform.ai_coding_tasks','SELECT,INSERT,UPDATE,DELETE,REFERENCES')")"
[[ "$owner_acl" == 'false:false:false' ]] || { echo "OWNER_TEMPORARY_GRANTS_LEAKED:$owner_acl" >&2;exit 1; }
echo PASS:ALL_OWNER_TEMPORARY_GRANTS_REVOKED
if { printf 'BEGIN;\n';cat "$ROOT/scripts/dev/gpt02-private-preparation-staging-inactive.sql";printf '\nCOMMIT;\n'; } | docker exec -i "$NAME" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -q > "$WORK/duplicate.log" 2>&1;then echo FAIL:DUPLICATE_NOT_REJECTED >&2;exit 1;fi
grep -Eq GPT02_STAGE_ALREADY_EXISTS_REQUIRE_MANUAL_REVIEW\|GPT02_OWNER_ALREADY_EXISTS_REQUIRE_REVIEW "$WORK/duplicate.log" || { tail -8 "$WORK/duplicate.log"; exit 1; }
echo PASS:DUPLICATE_SCHEMA_REQUIRES_REVIEW
if docker exec "$NAME" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -q -c "INSERT INTO gpt02_stage.core_preparations(company_id,hub_task_id,member_id,member_audit_id,operator_subject,core_task_id,hub_execution_id,command_candidate_id,attempt_id,config_sha256,expires_at) VALUES('default',136,1,1,'fixture',gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),repeat('a',64),now()+interval '1 hour')" > "$WORK/old.log" 2>&1;then echo FAIL:TASK136_NOT_REJECTED >&2;exit 1;fi
echo PASS:OLD_TASK_BOUNDARY_ENFORCED
if docker exec "$NAME" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -q -c 'TRUNCATE gpt02_stage.core_preparations' > "$WORK/truncate.log" 2>&1;then echo FAIL:TRUNCATE_NOT_REJECTED >&2;exit 1;fi
grep -Fq APPEND_ONLY_PREPARATION "$WORK/truncate.log" || { tail -8 "$WORK/truncate.log"; exit 1; }
echo PASS:IMMUTABLE_LEDGER
# Read-only schema metadata should not expose operational command functions.
count="$(docker exec "$NAME" psql -X -U postgres -d postgres -Atqc "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='gpt02_stage' AND p.proname='prepare_core_task'")"
[[ "$count" == 0 ]] ||  { echo  FAIL:LIVE_RESERVATION_FUNCTION_INSTALLED >&2; exit 1; }
echo GPT02_PRIVATE_SCHEMA_STAGED_ISOLATED_PASS_NO_DISPATCH
