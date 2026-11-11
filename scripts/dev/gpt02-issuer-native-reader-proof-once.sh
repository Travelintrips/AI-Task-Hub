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
command -v node >/dev/null 2>&1 || deny NODE_REQUIRED

PASS="$(openssl rand -hex 32)"
SECRET_ENV="$(mktemp /run/gpt02-issuer-reader-proof.XXXXXX)"
chmod 600 "$SECRET_ENV"
printf 'ISSUER_PASS=%s\n' "$PASS" >"$SECRET_ENV"

locked=1
lock_role(){
  if docker run --rm --network host --env-file "$APP_ENV_FILE" "$POSTGRES_IMAGE"     sh -lc 'psql "$SUPABASE_DATABASE_URL_DEV" -X -q -v ON_ERROR_STOP=1 <<SQL
ALTER ROLE gpt02_issuer_evidence_reader NOLOGIN CONNECTION LIMIT 0;
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
  unset PASS GPT02_ISSUER_READER_DATABASE_URL_DEV GPT02_READER_DEV_CA
}
trap cleanup EXIT HUP INT TERM

BASELINE="$(docker run --rm --network host --env-file "$APP_ENV_FILE" "$POSTGRES_IMAGE"   sh -lc 'psql "$SUPABASE_DATABASE_URL_DEV" -X -qAt -v ON_ERROR_STOP=1 -c "
SELECT rolcanlogin||'''|'''||rolconnlimit||'''|'''||
 (SELECT count(*) FROM pg_auth_members m WHERE m.member=r.oid)||'''|'''||
 (SELECT count(*) FROM pg_stat_activity a WHERE a.usename=r.rolname)
FROM pg_roles r WHERE rolname='''gpt02_issuer_evidence_reader''';"' )"
[ "$BASELINE" = "false|0|0|0" ] || deny READER_BASELINE_NOT_INERT

docker run --rm --network host --env-file "$APP_ENV_FILE" --env-file "$SECRET_ENV" "$POSTGRES_IMAGE"   sh -lc 'psql "$SUPABASE_DATABASE_URL_DEV" -X -q -v ON_ERROR_STOP=1 -v p="$ISSUER_PASS" <<SQL
BEGIN;
ALTER ROLE gpt02_issuer_evidence_reader LOGIN CONNECTION LIMIT 1 PASSWORD :'''p''';
COMMIT;
SQL' >/dev/null
locked=0

export NODE_ENV=development
export APP_ENV=development
export GPT02_ISSUER_READER_DATABASE_URL_DEV="postgresql://${ROLE}.${PROJECT_REF}:${PASS}@${POOLER_HOST}:5432/postgres"
export GPT02_READER_DEV_CA="$(cat "$CA_FILE")"

node --input-type=module - <<'NODE'
import pg from 'pg';
const {Pool}=pg;
const pool=new Pool({
 connectionString:process.env.GPT02_ISSUER_READER_DATABASE_URL_DEV,
 ssl:{rejectUnauthorized:true,ca:process.env.GPT02_READER_DEV_CA},
 max:1,connectionTimeoutMillis:5000,idleTimeoutMillis:5000,
 application_name:'gpt02-issuer-reader-proof-once',
 options:'-c default_transaction_read_only=on -c search_path=pg_catalog -c statement_timeout=5000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=10000'
});
let c;
try{
 c=await pool.connect();
 const s=c.connection?.stream;
 if(!(s?.encrypted===true&&s?.authorized===true&&!s?.authorizationError))
   throw Error('TLS_NOT_VERIFIED');
 await c.query('BEGIN READ ONLY');
 const q=await c.query(`
SELECT current_database() db,current_user login,session_user session,
 current_setting('transaction_read_only') read_only,
 current_setting('default_transaction_read_only')='on' default_readonly,
 current_setting('search_path')='pg_catalog' search_path_locked,
 current_setting('statement_timeout')='5s' statement_timeout_locked,
 current_setting('lock_timeout')='1s' lock_timeout_locked,
 current_setting('idle_in_transaction_session_timeout')='10s' idle_tx_timeout_locked,
 r.rolcanlogin,r.rolconnlimit,
 NOT (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolbypassrls OR r.rolreplication OR r.rolinherit) restricted,
 NOT EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid) no_memberships,
 NOT pg_has_role(current_user,'pg_read_all_data','USAGE') no_global_read,
 NOT pg_has_role(current_user,'pg_write_all_data','USAGE') no_global_write,
 NOT has_database_privilege(current_user,current_database(),'CREATE') no_db_create,
 has_schema_privilege(current_user,'gpt02_private','USAGE') private_usage,
 NOT has_schema_privilege(current_user,'gpt02_private','CREATE') private_no_create,
 (SELECT count(*) FROM pg_class x JOIN pg_namespace n ON n.oid=x.relnamespace
  JOIN pg_attribute a ON a.attrelid=x.oid AND a.attnum>0 AND NOT a.attisdropped
  WHERE n.nspname='gpt02_private'
    AND x.relname IN ('receipts','core_identity_receipts','post_consumption_fences')
    AND has_column_privilege(current_user,x.oid,a.attnum,'SELECT'))::int select_columns,
 (SELECT count(*) FROM pg_policy p JOIN pg_class x ON x.oid=p.polrelid
  JOIN pg_namespace n ON n.oid=x.relnamespace
  WHERE n.nspname='gpt02_private'
    AND x.relname IN ('receipts','core_identity_receipts','post_consumption_fences')
    AND p.polroles @> ARRAY[r.oid])::int policy_count
FROM pg_roles r WHERE r.rolname=current_user`);
 const x=q.rows?.[0];
 const ok=x?.db==='postgres'&&x.login==='gpt02_issuer_evidence_reader'&&
  x.session==='gpt02_issuer_evidence_reader'&&x.read_only==='on'&&
  x.default_readonly===true&&x.search_path_locked===true&&
  x.statement_timeout_locked===true&&x.lock_timeout_locked===true&&
  x.idle_tx_timeout_locked===true&&x.rolcanlogin===true&&x.rolconnlimit===1&&
  x.restricted===true&&x.no_memberships===true&&x.no_global_read===true&&
  x.no_global_write===true&&x.no_db_create===true&&x.private_usage===true&&
  x.private_no_create===true&&x.select_columns===32&&x.policy_count===3;
 if(!ok)throw Error('ISSUER_READER_IDENTITY_OR_PRIVILEGE_MISMATCH');
 await c.query('SELECT id,command_id,nonce,digest,consumed_at FROM gpt02_private.receipts LIMIT 0');
 await c.query('SELECT receipt_id,command_id,link_id,operator_user_id,recorded_by,hub_operator_id,link_digest,binding_verified,may_dispatch_worker,may_close_job,may_issue_grant,core_ledger_written,created_at FROM gpt02_private.core_identity_receipts LIMIT 0');
 await c.query('SELECT fence_id,receipt_id,command_id,link_id,hub_execution_id,core_task_id,attempt_id,worker_id,lease_epoch,lease_started_at,lease_expires_at,dispatch_allowed,core_ledger_written,created_at FROM gpt02_private.post_consumption_fences LIMIT 0');
 await c.query('ROLLBACK');
 console.log(JSON.stringify({
  reason:'ISSUER_NATIVE_READER_PASS_NO_AUTHORITY',
  authenticated:true,tlsVerified:true,permissionsVerified:true,
  evidenceSurfaceQueryable:true,signingPermitted:false,
  authorizationGranted:false,dispatchPermitted:false,releaseDecision:'NO_GO'
 }));
}finally{
 if(c)try{c.release(true)}catch{}
 await pool.end();
}
NODE

lock_role || deny READER_RELOCK_COMMAND_FAILED

AFTER=""
for _attempt in $(seq 1 20); do
 AFTER="$(docker run --rm --network host --env-file "$APP_ENV_FILE" "$POSTGRES_IMAGE"    sh -lc 'psql "$SUPABASE_DATABASE_URL_DEV" -X -qAt -v ON_ERROR_STOP=1 -c "
SELECT rolcanlogin||'''|'''||rolconnlimit||'''|'''||
 (SELECT count(*) FROM pg_auth_members m WHERE m.member=r.oid)||'''|'''||
 (SELECT count(*) FROM pg_stat_activity a WHERE a.usename=r.rolname)
FROM pg_roles r WHERE rolname='''gpt02_issuer_evidence_reader''';"' )"
 [ "$AFTER" = "false|0|0|0" ] && break
 sleep 0.5
done
[ "$AFTER" = "false|0|0|0" ] || deny READER_RELOCK_NOT_VERIFIED

echo 'GPT02_ISSUER_NATIVE_READER_PROOF=PASS_RELOCKED_NO_AUTHORITY'
