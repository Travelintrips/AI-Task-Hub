#!/usr/bin/env bash
set -euo pipefail
umask 077

APP_ENV_FILE="${GPT02_APP_ENV_FILE:-/etc/ai-task/development.env}"
WORKTREE="${GPT02_PROOF_WORKTREE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
CA_FILE="$WORKTREE/scripts/dev/fixtures/supabase-root-ca-2021.crt"
PROJECT_REF="xssrfshdrtdfupgqwfdw"
POOLER_HOST="aws-1-ap-southeast-2.pooler.supabase.com"
HUB_ROLE="gpt02_hub_evidence_reader"
CORE_ROLE="gpt02_core_evidence_reader"
POSTGRES_IMAGE="${GPT02_POSTGRES_IMAGE:-postgres:16-alpine}"

deny(){ echo "GPT02_NATIVE_READER_PROOF_FAIL:$1" >&2; exit 2; }

[ "$(id -u)" -eq 0 ] || deny ROOT_REQUIRED
[ -f "$APP_ENV_FILE" ] || deny DEV_ENV_FILE_MISSING
[ -f "$CA_FILE" ] || deny PINNED_CA_FILE_MISSING
command -v docker >/dev/null 2>&1 || deny DOCKER_REQUIRED
command -v openssl >/dev/null 2>&1 || deny OPENSSL_REQUIRED
command -v node >/dev/null 2>&1 || deny NODE_REQUIRED

# Never print or persist these values. Hex is URL-safe and needs no escaping.
HUB_PASS="$(openssl rand -hex 32)"
CORE_PASS="$(openssl rand -hex 32)"
SECRET_ENV="$(mktemp /run/gpt02-native-reader-proof.XXXXXX)"
chmod 600 "$SECRET_ENV"
printf 'HUB_PASS=%s\nCORE_PASS=%s\n' "$HUB_PASS" "$CORE_PASS" >"$SECRET_ENV"

roles_locked=1
lock_roles(){
  if docker run --rm --network host --env-file "$APP_ENV_FILE" "$POSTGRES_IMAGE" \
    sh -lc 'psql "$SUPABASE_DATABASE_URL_DEV" -X -q -v ON_ERROR_STOP=1 <<SQL
ALTER ROLE gpt02_hub_evidence_reader NOLOGIN CONNECTION LIMIT 0;
ALTER ROLE gpt02_core_evidence_reader NOLOGIN CONNECTION LIMIT 0;
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE usename IN ('"'"'gpt02_hub_evidence_reader'"'"','"'"'gpt02_core_evidence_reader'"'"')
  AND pid <> pg_backend_pid();
SQL' >/dev/null 2>&1; then
    roles_locked=1
    return 0
  fi
  return 1
}
cleanup(){
  if [ "$roles_locked" -ne 1 ]; then lock_roles; fi
  rm -f "$SECRET_ENV"
  unset HUB_PASS CORE_PASS GPT02_HUB_READER_DATABASE_URL_DEV GPT02_CORE_READER_DATABASE_URL_DEV GPT02_READER_DEV_CA
}
trap cleanup EXIT HUP INT TERM

# Refuse to touch a non-inert baseline.
BASELINE="$(docker run --rm --network host --env-file "$APP_ENV_FILE" "$POSTGRES_IMAGE"   sh -lc 'psql "$SUPABASE_DATABASE_URL_DEV" -X -qAt -v ON_ERROR_STOP=1 -c "
SELECT string_agg(rolname||'\''|'\''||rolcanlogin||'\''|'\''||rolconnlimit||'\''|'\''||
 (SELECT count(*) FROM pg_auth_members m WHERE m.member=r.oid)||'\''|'\''||
 (SELECT count(*) FROM pg_stat_activity a WHERE a.usename=r.rolname),'\'';'\'' ORDER BY rolname)
FROM pg_roles r
WHERE rolname IN ('\''gpt02_hub_evidence_reader'\'','\''gpt02_core_evidence_reader'\'');"' )"
EXPECTED="gpt02_core_evidence_reader|false|0|0|0;gpt02_hub_evidence_reader|false|0|0|0"
[ "$BASELINE" = "$EXPECTED" ] || deny READER_BASELINE_NOT_INERT

# Activate only these two already-reviewed reader roles with distinct ephemeral secrets.
docker run --rm --network host --env-file "$APP_ENV_FILE" --env-file "$SECRET_ENV" "$POSTGRES_IMAGE"   sh -lc 'psql "$SUPABASE_DATABASE_URL_DEV" -X -q -v ON_ERROR_STOP=1     -v hub="$HUB_PASS" -v core="$CORE_PASS" <<SQL
BEGIN;
ALTER ROLE gpt02_hub_evidence_reader LOGIN CONNECTION LIMIT 1 PASSWORD :'\''hub'\'';
ALTER ROLE gpt02_core_evidence_reader LOGIN CONNECTION LIMIT 1 PASSWORD :'\''core'\'';
COMMIT;
SQL' >/dev/null
roles_locked=0

export NODE_ENV=development
export APP_ENV=development
export GPT02_HUB_READER_DATABASE_URL_DEV="postgresql://${HUB_ROLE}.${PROJECT_REF}:${HUB_PASS}@${POOLER_HOST}:5432/postgres"
export GPT02_CORE_READER_DATABASE_URL_DEV="postgresql://${CORE_ROLE}.${PROJECT_REF}:${CORE_PASS}@${POOLER_HOST}:5432/postgres"
export GPT02_READER_DEV_CA="$(cat "$CA_FILE")"

node --input-type=module - <<'NODE'
import {probe} from './scripts/dev/gpt02-two-reader-native-readonly.mjs';
const out=await probe(process.env);
console.log(JSON.stringify(out));
if(out.reason!=='TWO_NATIVE_READERS_PASS_NO_AUTHORITY' ||
   out.hubAuthenticated!==true || out.coreAuthenticated!==true ||
   out.twoSessionsVerified!==true || out.permissionsVerified!==true ||
   out.dispatchPermitted!==false || out.issuerLeaseGranted!==false ||
   out.taskCreated!==false || out.commandCreated!==false ||
   out.releaseDecision!=='NO_GO') process.exit(7);
NODE

# Re-lock immediately even after a passing proof.
lock_roles || deny READER_RELOCK_COMMAND_FAILED

AFTER=""
for _attempt in $(seq 1 20); do
  AFTER="$(docker run --rm --network host --env-file "$APP_ENV_FILE" "$POSTGRES_IMAGE" \
    sh -lc 'psql "$SUPABASE_DATABASE_URL_DEV" -X -qAt -v ON_ERROR_STOP=1 -c "
SELECT string_agg(rolname||'\''|'\''||rolcanlogin||'\''|'\''||rolconnlimit||'\''|'\''||
 (SELECT count(*) FROM pg_auth_members m WHERE m.member=r.oid)||'\''|'\''||
 (SELECT count(*) FROM pg_stat_activity a WHERE a.usename=r.rolname),'\'';'\'' ORDER BY rolname)
FROM pg_roles r
WHERE rolname IN ('\''gpt02_hub_evidence_reader'\'','\''gpt02_core_evidence_reader'\'');"' )"
  [ "$AFTER" = "$EXPECTED" ] && break
  sleep 0.5
done
[ "$AFTER" = "$EXPECTED" ] || deny READER_RELOCK_NOT_VERIFIED

echo 'GPT02_NATIVE_TWO_READER_PROOF=PASS_RELOCKED_NO_AUTHORITY'
