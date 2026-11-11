#!/usr/bin/env bash
set -euo pipefail
umask 077

APP_ENV_FILE="${GPT02_APP_ENV_FILE:-/etc/ai-task/development.env}"
WORKTREE="${GPT02_PROOF_WORKTREE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
CA_FILE="$WORKTREE/scripts/dev/fixtures/supabase-root-ca-2021.crt"
PROJECT_REF="xssrfshdrtdfupgqwfdw"
POOLER_HOST="aws-1-ap-southeast-2.pooler.supabase.com"
ROLE="gpt02_issuer_evidence_reader"
POSTGRES_IMAGE="${GPT02_POSTGRES_IMAGE:-postgres:16-alpine}"

deny(){ echo "GPT02_ISSUER_READER_PROOF_FAIL:$1" >&2; exit 2; }

[ "$(id -u)" -eq 0 ] || deny ROOT_REQUIRED
[ -f "$APP_ENV_FILE" ] || deny DEV_ENV_FILE_MISSING
[ -f "$CA_FILE" ] || deny PINNED_CA_FILE_MISSING
command -v docker >/dev/null 2>&1 || deny DOCKER_REQUIRED
command -v openssl >/dev/null 2>&1 || deny OPENSSL_REQUIRED

PASS="$(openssl rand -hex 32)"
SECRET_ENV="$(mktemp /run/gpt02-issuer-reader-proof.XXXXXX)"
chmod 600 "$SECRET_ENV"
printf 'ISSUER_PASS=%s\nPGPASSWORD=%s\n' "$PASS" "$PASS" >"$SECRET_ENV"

locked=1
lock_role(){
  if docker run --rm --network host --env-file "$APP_ENV_FILE" "$POSTGRES_IMAGE"     sh -lc 'psql "$SUPABASE_DATABASE_URL_DEV" -X -q -v ON_ERROR_STOP=1 <<SQL
ALTER ROLE gpt02_issuer_evidence_reader NOLOGIN CONNECTION LIMIT 0 PASSWORD NULL;
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE usename='"'"'gpt02_issuer_evidence_reader'"'"'
  AND pid <> pg_backend_pid();
SQL' >/dev/null 2>&1; then
    locked=1
    return 0
  fi
  return 1
}
cleanup(){
  if [ "$locked" -ne 1 ]; then lock_role; fi
  rm -f "$SECRET_ENV"
  unset PASS PGPASSWORD GPT02_ISSUER_READER_DATABASE_URL_DEV GPT02_READER_DEV_CA
}
trap cleanup EXIT HUP INT TERM

BASELINE="$(docker run -i --rm --network host --env-file "$APP_ENV_FILE" "$POSTGRES_IMAGE" \
  sh -lc 'exec psql "$SUPABASE_DATABASE_URL_DEV" -X -qAt -v ON_ERROR_STOP=1' <<'SQL'
SELECT concat_ws('|',rolcanlogin::text,rolconnlimit::text,
 (SELECT count(*) FROM pg_auth_members m WHERE m.member=r.oid)::text,
 (SELECT count(*) FROM pg_stat_activity a WHERE a.usename=r.rolname)::text,
 (SELECT rolpassword IS NULL FROM pg_authid WHERE rolname=r.rolname)::text)
FROM pg_roles r WHERE rolname='gpt02_issuer_evidence_reader';
SQL
)"
[ "$BASELINE" = "false|0|0|0|true" ] || deny READER_BASELINE_NOT_INERT

docker run -i --rm --network host --env-file "$APP_ENV_FILE" --env-file "$SECRET_ENV" "$POSTGRES_IMAGE" \
  sh -lc 'exec psql "$SUPABASE_DATABASE_URL_DEV" -X -q -v ON_ERROR_STOP=1 -v p="$ISSUER_PASS"' >/dev/null <<'SQL'
BEGIN;
ALTER ROLE gpt02_issuer_evidence_reader LOGIN CONNECTION LIMIT 1 PASSWORD :'p';
COMMIT;
SQL
locked=0
# Supavisor refreshes the SCRAM verifier asynchronously after ALTER ROLE.
sleep 30

CONN="host=$POOLER_HOST port=5432 dbname=postgres user=${ROLE}.${PROJECT_REF} sslmode=verify-full sslrootcert=/tmp/supabase-ca.crt"

docker run -i --rm --network host --env-file "$SECRET_ENV" \
  -e CONN="$CONN" -v "$CA_FILE:/tmp/supabase-ca.crt:ro" "$POSTGRES_IMAGE" \
  sh -lc 'exec psql "$CONN" -X -qAt -v ON_ERROR_STOP=1' <<'SQL'
BEGIN READ ONLY;
SET LOCAL statement_timeout='5s';
DO $proof$
DECLARE r record;
BEGIN
  SELECT current_database() AS db,current_user AS login,session_user AS session,
    current_setting('transaction_read_only') AS read_only,
    current_setting('default_transaction_read_only')='on' AS default_readonly,
    current_setting('search_path')='pg_catalog' AS search_path_locked,
    current_setting('statement_timeout')='5s' AS statement_timeout_locked,
    current_setting('lock_timeout')='1s' AS lock_timeout_locked,
    current_setting('idle_in_transaction_session_timeout')='10s' AS idle_tx_timeout_locked,
    pr.rolcanlogin,pr.rolconnlimit,
    NOT (pr.rolsuper OR pr.rolcreaterole OR pr.rolcreatedb OR pr.rolbypassrls OR pr.rolreplication OR pr.rolinherit) restricted,
    NOT EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=pr.oid) no_memberships,
    NOT pg_has_role(current_user,'pg_read_all_data','USAGE') no_global_read,
    NOT pg_has_role(current_user,'pg_write_all_data','USAGE') no_global_write,
    NOT has_database_privilege(current_user,current_database(),'CREATE') no_db_create,
    has_schema_privilege(current_user,'gpt02_private','USAGE') private_usage,
    NOT has_schema_privilege(current_user,'gpt02_private','CREATE') private_no_create,
    (SELECT count(*) FROM pg_class x JOIN pg_namespace n ON n.oid=x.relnamespace
      JOIN pg_attribute a ON a.attrelid=x.oid AND a.attnum>0 AND NOT a.attisdropped
      WHERE n.nspname='gpt02_private'
        AND x.relname IN ('approvals','operator_links','receipts','core_identity_receipts','post_consumption_fences')
        AND has_column_privilege(current_user,x.oid,a.attnum,'SELECT'))::int select_columns,
    (SELECT count(*) FROM pg_policy p JOIN pg_class x ON x.oid=p.polrelid
      JOIN pg_namespace n ON n.oid=x.relnamespace
      WHERE n.nspname='gpt02_private'
        AND x.relname IN ('receipts','core_identity_receipts','post_consumption_fences')
        AND p.polroles @> ARRAY[pr.oid])::int policy_count,
    (SELECT count(*) FROM pg_policies p
      WHERE p.schemaname='gpt02_private'
        AND p.tablename IN ('approvals','operator_links','receipts','core_identity_receipts','post_consumption_fences')
        AND p.policyname='issuer_evidence_reader_select'
        AND p.permissive='PERMISSIVE' AND p.cmd='SELECT' AND p.with_check IS NULL
        AND p.roles=ARRAY[pr.rolname]::name[]
        AND (
          (p.tablename IN ('receipts','core_identity_receipts','post_consumption_fences') AND p.qual='true')
          OR (p.tablename='approvals' AND p.qual='((company_id = ''default''::text) AND (task_id > 136) AND ((claims ->> ''environment''::text) = ''DEV''::text))')
          OR (p.tablename='operator_links' AND p.qual='((company_id = ''default''::text) AND (hub_task_id > 136) AND (attempt_number = 1) AND ((claims ->> ''environment''::text) = ''DEV''::text))')
        ))::int exact_policy_count,
    (SELECT count(*) FROM pg_policies p
      WHERE p.schemaname='gpt02_private'
        AND p.tablename IN ('approvals','operator_links','receipts','core_identity_receipts','post_consumption_fences')
        AND 'public'=ANY(p.roles))::int public_policy_count,
    (SELECT count(*) FROM information_schema.table_privileges tp
      WHERE tp.grantee=pr.rolname AND tp.table_schema='gpt02_private'
        AND tp.table_name IN ('approvals','operator_links','receipts','core_identity_receipts','post_consumption_fences'))::int table_level_grants
  INTO r FROM pg_roles pr WHERE pr.rolname=current_user;
  IF r.db<>'postgres' OR r.login<>'gpt02_issuer_evidence_reader'
    OR r.session<>'gpt02_issuer_evidence_reader' OR r.read_only<>'on'
    OR NOT r.default_readonly OR NOT r.search_path_locked
    OR NOT r.statement_timeout_locked OR NOT r.lock_timeout_locked
    OR NOT r.idle_tx_timeout_locked OR NOT r.rolcanlogin OR r.rolconnlimit<>1
    OR NOT r.restricted OR NOT r.no_memberships OR NOT r.no_global_read
    OR NOT r.no_global_write OR NOT r.no_db_create OR NOT r.private_usage
    OR NOT r.private_no_create OR r.select_columns<>51 OR r.policy_count<>5
    OR r.exact_policy_count<>5 OR r.public_policy_count<>0 OR r.table_level_grants<>0 THEN
    RAISE EXCEPTION 'ISSUER_READER_IDENTITY_OR_PRIVILEGE_MISMATCH';
  END IF;
END
$proof$;
SELECT command_id,attempt_id,nonce,task_id,company_id,approver_id,claims,digest
FROM gpt02_private.approvals LIMIT 0;
SELECT link_id,command_id,hub_execution_id,core_task_id,hub_task_id,attempt_id,
       company_id,hub_operator_id,approval_digest,link_digest,claims
FROM gpt02_private.operator_links LIMIT 0;
SELECT id,command_id,nonce,digest,consumed_at
FROM gpt02_private.receipts LIMIT 0;
SELECT receipt_id,command_id,link_id,operator_user_id,recorded_by,hub_operator_id,
       link_digest,binding_verified,may_dispatch_worker,may_close_job,may_issue_grant,
       core_ledger_written,created_at
FROM gpt02_private.core_identity_receipts LIMIT 0;
SELECT fence_id,receipt_id,command_id,link_id,hub_execution_id,core_task_id,attempt_id,
       worker_id,lease_epoch,lease_started_at,lease_expires_at,dispatch_allowed,
       core_ledger_written,created_at
FROM gpt02_private.post_consumption_fences LIMIT 0;
ROLLBACK;
SQL

echo '{"reason":"ISSUER_NATIVE_READER_PASS_NO_AUTHORITY","authenticated":true,"tlsVerified":true,"permissionsVerified":true,"evidenceSurfaceQueryable":true,"signingPermitted":false,"authorizationGranted":false,"dispatchPermitted":false,"releaseDecision":"NO_GO"}'

lock_role || deny READER_RELOCK_COMMAND_FAILED

AFTER=""
for _attempt in $(seq 1 20); do
 AFTER="$(docker run -i --rm --network host --env-file "$APP_ENV_FILE" "$POSTGRES_IMAGE" \
   sh -lc 'exec psql "$SUPABASE_DATABASE_URL_DEV" -X -qAt -v ON_ERROR_STOP=1' <<'SQL'
SELECT concat_ws('|',rolcanlogin::text,rolconnlimit::text,
 (SELECT count(*) FROM pg_auth_members m WHERE m.member=r.oid)::text,
 (SELECT count(*) FROM pg_stat_activity a WHERE a.usename=r.rolname)::text,
 (SELECT rolpassword IS NULL FROM pg_authid WHERE rolname=r.rolname)::text)
FROM pg_roles r WHERE rolname='gpt02_issuer_evidence_reader';
SQL
)"
 [ "$AFTER" = "false|0|0|0|true" ] && break
 sleep 0.5
done
[ "$AFTER" = "false|0|0|0|true" ] || deny READER_RELOCK_NOT_VERIFIED

echo 'GPT02_ISSUER_NATIVE_READER_PROOF=PASS_RELOCKED_NO_AUTHORITY'
