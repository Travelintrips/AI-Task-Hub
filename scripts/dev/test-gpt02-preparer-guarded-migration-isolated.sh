#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NAME="gpt02-guarded-migration-$PPID-$$"
SOCKET="gpt02-guarded-sock-$PPID-$$"
WORK="$(mktemp -d)"
cleanup(){
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker volume rm "$SOCKET" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
docker volume create "$SOCKET" >/dev/null
docker run -d --name "$NAME" --network none \
  --mount "type=volume,src=$SOCKET,dst=/var/run/postgresql" \
  -e POSTGRES_PASSWORD=synthetic-only postgres:16-alpine \
  -c unix_socket_directories=/var/run/postgresql >/dev/null
ready=false
for i in $(seq 1 60); do
  logs="$(docker logs "$NAME" 2>&1 || true)"
  if [[ "$logs" == *'PostgreSQL init process complete'* ]] &&
     [[ "$logs" == *'database system is ready to accept connections'* ]] &&
     docker exec "$NAME" psql -X -U postgres -Atqc 'SELECT 1' >/dev/null 2>&1; then
    ready=true;break
  fi
  sleep 1
done
[[ "$ready" == true ]] || { echo ISOLATED_DB_NOT_READY >&2;exit 3; }
docker exec "$NAME" psql -X -U postgres -v ON_ERROR_STOP=1 \
 -c 'CREATE DATABASE gpt02_core_preparation_isolated' >/dev/null
psqlAs(){
  local user="$1";shift
  docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -At \
    -U "$user" -d gpt02_core_preparation_isolated "$@"
}
awk -v policies="$ROOT/scripts/dev/gpt02-core-preparer-rls-candidate.sql" '
 $0=="-- GPT02_PREPARER_RLS_POLICY_INJECTION_POINT" {
   while((getline line < policies)>0) print line
   close(policies);next
 }
 {print}
' "$ROOT/scripts/dev/gpt02-core-task-preparation-isolated.sql" |
  psqlAs postgres -q >"$WORK/fixture.log" 2>&1 ||
  { tail -30 "$WORK/fixture.log";exit 3; }
psqlAs postgres -c "
 ALTER TABLE public.ai_tasks ADD COLUMN description text, ADD COLUMN source text NOT NULL DEFAULT 'manual';
 ALTER FUNCTION gpt02_stage.prepare_core_task(text,integer,text,text,text,text) RENAME TO prepare_core_task_v1_internal;
 REVOKE EXECUTE ON FUNCTION gpt02_stage.prepare_core_task_v1_internal(text,integer,text,text,text,text) FROM gpt02_core_prep_login;
 GRANT gpt02_core_prep_owner TO postgres WITH SET FALSE, INHERIT FALSE;
 INSERT INTO public.ai_tasks(id,company_id,status,title,assigned_to_id,assigned_to,description,source)
 VALUES (171,'default','new_inquiry','AI Core bridge command 057d9f3d',5,'Synthetic PIC','AI Core bridge command 057d9f3d','manual');" >"$WORK/extra.log" 2>&1 ||
 { tail -20 "$WORK/extra.log";exit 3; }
cat >"$WORK/original.sql" <<'SQL'
SET ROLE gpt02_core_prep_owner;
CREATE OR REPLACE FUNCTION gpt02_stage.prepare_core_task(
 p_company text,p_task integer,p_project text,p_repo text,p_branch text,p_instruction text
)
RETURNS TABLE(core_task_id uuid,command_candidate_id uuid,attempt_id uuid,
 hub_execution_id uuid,created boolean,dispatch_permitted boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $function$
BEGIN
 IF session_user<>'gpt02_core_prep_login' OR p_task<=139 THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='FRESH_TASK_AFTER_139_REQUIRED';
 END IF;
 RETURN QUERY SELECT * FROM gpt02_stage.prepare_core_task_v1_internal(
  p_company,p_task,p_project,p_repo,p_branch,p_instruction);
END
$function$;
REVOKE ALL ON FUNCTION gpt02_stage.prepare_core_task(text,integer,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION gpt02_stage.prepare_core_task(text,integer,text,text,text,text) TO gpt02_core_prep_login;
RESET ROLE;
ALTER ROLE gpt02_core_prep_login NOLOGIN CONNECTION LIMIT 0 VALID UNTIL '2000-01-01';
SQL
psqlAs postgres < "$WORK/original.sql" >"$WORK/wrapper.log" 2>&1 ||
  { tail -30 "$WORK/wrapper.log";exit 3; }
sha="$(psqlAs postgres -c "SELECT encode(extensions.digest(convert_to(pg_get_functiondef(p.oid),'UTF8'),'sha256'),'hex')
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='gpt02_stage' AND p.proname='prepare_core_task';")"
[[ "$sha" =~ ^[0-9a-f]{64}$ ]] || { echo WRONG_FIXTURE_SHA >&2;exit 1; }
baseline='b5cf331682d291f61a012853671cd40c1dc3068fc7e1c57f81354c755f7d47c7'
sed "s/$baseline/$sha/g" \
 "$ROOT/scripts/dev/gpt02-preparer-wrapper-guarded-atomic-dev.sql" >"$WORK/migration.sql"
sed -i "s/current_database()<>'postgres'/current_database()<>'gpt02_core_preparation_isolated'/g" "$WORK/migration.sql"
sed -i "s/current_user<>'postgres'/current_user<>'cst_migrator'/g;s/session_user<>'postgres'/session_user<>'cst_migrator'/g;s/pg_has_role('postgres'/pg_has_role('cst_migrator'/g" "$WORK/migration.sql"
sed -i "s/member='postgres'::regrole/member='cst_migrator'::regrole/g;s/g.rolname='postgres'/g.rolname='cst_migrator'/g;s/TO postgres WITH /TO cst_migrator WITH /g;s/GRANTED BY postgres/GRANTED BY cst_migrator/g" "$WORK/migration.sql"
aclBefore="$(psqlAs postgres -c "SELECT pg_get_userbyid(p.proowner)||'|'||p.proacl::text
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='gpt02_stage' AND p.proname='prepare_core_task';")"
echo "ACL_BEFORE=$aclBefore"
psqlAs postgres -c "
 CREATE ROLE cst_migrator LOGIN NOSUPERUSER CREATEROLE CREATEDB NOREPLICATION BYPASSRLS;
 CREATE ROLE supabase_admin NOLOGIN;
 GRANT gpt02_core_prep_owner TO supabase_admin WITH ADMIN TRUE, SET FALSE, INHERIT FALSE;
 GRANT gpt02_core_prep_owner TO cst_migrator WITH ADMIN TRUE, SET FALSE, INHERIT FALSE GRANTED BY supabase_admin;
 GRANT USAGE,CREATE ON SCHEMA gpt02_stage TO cst_migrator;
 GRANT USAGE ON SCHEMA extensions TO cst_migrator;
 GRANT EXECUTE ON FUNCTION extensions.digest(bytea,text) TO cst_migrator;
 GRANT SELECT ON public.ai_tasks,public.ai_execution_jobs TO cst_migrator;
 GRANT SELECT ON gpt02_stage.core_preparations TO cst_migrator;" >/dev/null
# The actual hosted role has a second self-grant with SET=FALSE, INHERIT=TRUE.
psqlAs cst_migrator -c "GRANT gpt02_core_prep_owner TO cst_migrator WITH ADMIN FALSE, SET FALSE, INHERIT TRUE GRANTED BY cst_migrator;" >/dev/null
permission="$(psqlAs cst_migrator -c "SELECT r.rolsuper::text||'|'||r.rolcreaterole::text||'|'||r.rolbypassrls::text||'|'||
 pg_has_role(current_user,'gpt02_core_prep_owner','MEMBER')::text||'|'||
 pg_has_role(current_user,'gpt02_core_prep_owner','SET')::text||'|'||
 has_schema_privilege(current_user,'gpt02_stage','CREATE')::text
 FROM pg_roles r WHERE r.rolname=current_user;")"
[[ "$permission" == 'false|true|true|true|false|true' ]] ||
 { echo "NONSUPER_MIGRATOR_MISMATCH:$permission" >&2;exit 1; }
echo PASS:NONSUPER_MIGRATOR_MATCHES_HOSTED_ROLE_BOUNDARY

sed "s/$sha/$(printf '%064d' 0)/g" "$WORK/migration.sql" >"$WORK/wrong.sql"
if psqlAs cst_migrator < "$WORK/wrong.sql" >"$WORK/wrong.log" 2>&1; then
  echo BAD_FINGERPRINT_ACCEPTED >&2;exit 1
fi
grep -q 'GPT02_BASELINE_WRAPPER_SIGNATURE_OWNER_OR_PRIVILEGE_DRIFT' "$WORK/wrong.log" ||
 { echo WRONG_FAILURE;tail -18 "$WORK/wrong.log";exit 1; }
afterBad="$(psqlAs postgres -c "SELECT encode(extensions.digest(convert_to(pg_get_functiondef(p.oid),'UTF8'),'sha256'),'hex')
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='gpt02_stage' AND p.proname='prepare_core_task';")"
[[ "$afterBad" == "$sha" ]] || { echo ROLLBACK_NOT_ATOMIC >&2;exit 1; }
echo PASS:WRONG_BASELINE_DENIED_AND_ROLLED_BACK
# Fail AFTER temporary self-granted SET ROLE but BEFORE CREATE FUNCTION.
# All role changes must roll back, and the old function must stay untouched.
stateBefore="$(psqlAs postgres -c "SELECT count(*)::text||'|'||
 count(*) FILTER(WHERE set_option)::text
 FROM pg_auth_members WHERE member='cst_migrator'::regrole
 AND roleid='gpt02_core_prep_owner'::regrole;")"
[[ "$stateBefore" == '2|0' ]] || { echo UNEXPECTED_INITIAL_MEMBERSHIP >&2;exit 1; }
awk '
 /^CREATE OR REPLACE FUNCTION gpt02_stage.prepare_core_task/ {
  print "DO $fault$ BEGIN RAISE EXCEPTION \047SYNTHETIC_AFTER_TEMPORARY_ROLE_SET\047; END $fault$;"
 }
 {print}
' "$WORK/migration.sql" >"$WORK/fault.sql"
if psqlAs cst_migrator < "$WORK/fault.sql" >"$WORK/fault.log" 2>&1; then
  echo ERROR_AFTER_TEMP_ROLE_SET_UNEXPECTEDLY_ACCEPTED >&2;exit 1
fi
grep -q SYNTHETIC_AFTER_TEMPORARY_ROLE_SET "$WORK/fault.log" ||
 { echo WRONG_FAILPOINT_ERROR;tail -18 "$WORK/fault.log";exit 1; }
stateAfter="$(psqlAs postgres -c "SELECT count(*)::text||'|'||
 count(*) FILTER(WHERE set_option)::text
 FROM pg_auth_members WHERE member='cst_migrator'::regrole
 AND roleid='gpt02_core_prep_owner'::regrole;")"
[[ "$stateAfter" == "$stateBefore" ]] ||
 { echo TEMPORARY_OWNER_SET_LEAKED_AFTER_ROLLBACK >&2;exit 1; }
echo PASS:FAIL_AFTER_TEMPORARY_ROLE_SET_ROLLS_BACK_ALL_GRANTS

psqlAs cst_migrator < "$WORK/migration.sql" >"$WORK/apply.log" 2>&1 ||
 { echo GUARDED_SQL_FAILED;tail -30 "$WORK/apply.log";exit 1; }
aclAfter="$(psqlAs postgres -c "SELECT pg_get_userbyid(p.proowner)||'|'||p.proacl::text
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='gpt02_stage' AND p.proname='prepare_core_task';")"
[[ "$aclAfter" == "$aclBefore" ]] || { echo OWNER_OR_ACL_CHANGED >&2;exit 1; }
echo PASS:ATOMIC_WRAPPER_REPLACEMENT_PRESERVES_OWNER_AND_ACL
stateAfterCommit="$(psqlAs postgres -c "SELECT count(*)::text||'|'||
 count(*) FILTER(WHERE set_option)::text
 FROM pg_auth_members WHERE member='cst_migrator'::regrole
 AND roleid='gpt02_core_prep_owner'::regrole;")"
[[ "$stateAfterCommit" == "$stateBefore" ]] ||
 { echo TEMPORARY_SET_NOT_RESTORED_BEFORE_COMMIT >&2;exit 1; }
echo PASS:TEMPORARY_SET_ROLE_RESTORED_BEFORE_COMMIT
newSha="$(psqlAs postgres -c "SELECT encode(extensions.digest(convert_to(pg_get_functiondef(p.oid),'UTF8'),'sha256'),'hex')
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='gpt02_stage' AND p.proname='prepare_core_task';")"
[[ "$newSha" != "$sha" && "$newSha" =~ ^[a-f0-9]{64}$ ]] ||
 { echo WRAPPER_NOT_UPDATED >&2;exit 1; }
if psqlAs cst_migrator < "$WORK/migration.sql" >"$WORK/reapply.log" 2>&1; then
  echo REAPPLY_UNEXPECTEDLY_ACCEPTED >&2;exit 1
fi
grep -q 'GPT02_BASELINE_WRAPPER_SIGNATURE_OWNER_OR_PRIVILEGE_DRIFT' "$WORK/reapply.log" ||
 { echo WRONG_REAPPLY_FAILURE;tail -15 "$WORK/reapply.log";exit 1; }
echo PASS:REAPPLY_DENIED_NO_SILENT_DRIFT
counts="$(psqlAs postgres -c "SELECT
 (SELECT count(*) FROM ai_platform.ai_coding_bridge_commands)||'|'||
 (SELECT count(*) FROM gpt02_stage.core_preparations WHERE hub_task_id=171)||'|'||
 (SELECT rolcanlogin::text FROM pg_roles WHERE rolname='gpt02_core_prep_login');")"
[[ "$counts" == '0|0|false' ]] || { echo UNEXPECTED_COMMAND_OR_LOGIN >&2;exit 1; }
echo GPT02_GUARDED_WRAPPER_ISOLATED_PASS_NO_HOSTED_DB_NO_DISPATCH
