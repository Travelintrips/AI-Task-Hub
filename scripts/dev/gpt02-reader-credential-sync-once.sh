#!/usr/bin/env bash
# CST-DEV only. Reconcile Hub/Core DSNs with PostgreSQL verifiers and start
# the isolated read-only sidecar. Secrets are generated and remain on-host.
set -euo pipefail
umask 077

APP_ENV_FILE="${GPT02_APP_ENV_FILE:-/etc/ai-task/development.env}"
CREDSTORE=/etc/credstore.encrypted
CA_FILE=/etc/gpt02-dev/supabase-root-ca-2021.crt
UNIT=gpt02-issue159-reader.service
POOLER=aws-1-ap-southeast-2.pooler.supabase.com
PROJECT=xssrfshdrtdfupgqwfdw
IMAGE="${GPT02_POSTGRES_IMAGE:-postgres:16-alpine}"

deny(){ echo "GPT02_READER_CREDENTIAL_SYNC_FAIL:$1" >&2; exit 2; }
[ "$(id -u)" -eq 0 ] || deny ROOT_REQUIRED
[ -f "$APP_ENV_FILE" ] || deny DEV_ENV_FILE_MISSING
[ -f "$CA_FILE" ] || deny PINNED_CA_MISSING
[ -d "$CREDSTORE" ] || deny CREDENTIAL_STORE_MISSING
command -v systemd-creds >/dev/null 2>&1 || deny SYSTEMD_CREDS_REQUIRED
command -v openssl >/dev/null 2>&1 || deny OPENSSL_REQUIRED
command -v docker >/dev/null 2>&1 || deny DOCKER_REQUIRED
systemctl cat "$UNIT" >/dev/null 2>&1 || deny READER_UNIT_MISSING

W=$(mktemp -d /run/gpt02-reader-sync.XXXXXX)
chmod 700 "$W"
BACKUP=0
DB_UPDATED=0
SUCCESS=0
lock_roles(){
  cat > "$W/lock.sql" <<'SQL'
BEGIN;
ALTER ROLE gpt02_hub_evidence_reader NOLOGIN CONNECTION LIMIT 0;
ALTER ROLE gpt02_core_evidence_reader NOLOGIN CONNECTION LIMIT 0;
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE usename IN ('gpt02_hub_evidence_reader','gpt02_core_evidence_reader')
  AND pid <> pg_backend_pid();
COMMIT;
SQL
  docker run --rm --network host --env-file "$APP_ENV_FILE" \
    -v "$W:/run/gpt02:ro" "$IMAGE" sh -lc \
    'psql "$SUPABASE_DATABASE_URL_DEV" -X -q -v ON_ERROR_STOP=1 -f /run/gpt02/lock.sql' >/dev/null
}
cleanup(){
  if [ "$SUCCESS" -ne 1 ]; then
    systemctl stop "$UNIT" >/dev/null 2>&1 || true
    if [ "$DB_UPDATED" -eq 1 ]; then
      lock_roles >/dev/null 2>&1 || true
    elif [ "$BACKUP" -eq 1 ]; then
      install -o root -g root -m 600 "$W/hub.old" "$CREDSTORE/gpt02-hub-evidence-reader-dsn"
      install -o root -g root -m 600 "$W/core.old" "$CREDSTORE/gpt02-core-evidence-reader-dsn"
    fi
  fi
  unset HUB_PASS CORE_PASS
  rm -rf "$W"
}
trap cleanup EXIT HUP INT TERM

# Stop the failed/old reader before rotating the two dedicated identities.
systemctl stop "$UNIT" >/dev/null 2>&1 || true

# Only proceed from the exact inert baseline. Do not alter grants or RLS.
cat > "$W/baseline.sql" <<'SQL'
SELECT string_agg(
 r.rolname||'|'||r.rolcanlogin||'|'||r.rolconnlimit||'|'||
 (SELECT count(*) FROM pg_auth_members m WHERE m.member=r.oid)||'|'||
 (SELECT count(*) FROM pg_stat_activity a WHERE a.usename=r.rolname),
 ';' ORDER BY r.rolname)
FROM pg_roles r
WHERE r.rolname IN ('gpt02_hub_evidence_reader','gpt02_core_evidence_reader');
SQL
BASELINE=$(docker run --rm --network host --env-file "$APP_ENV_FILE" \
 -v "$W:/run/gpt02:ro" "$IMAGE" sh -lc \
 'psql "$SUPABASE_DATABASE_URL_DEV" -X -qAt -v ON_ERROR_STOP=1 -f /run/gpt02/baseline.sql')
EXPECTED='gpt02_core_evidence_reader|false|0|0|0;gpt02_hub_evidence_reader|false|0|0|0'
[ "$BASELINE" = "$EXPECTED" ] || deny READER_BASELINE_NOT_INERT

cp "$CREDSTORE/gpt02-hub-evidence-reader-dsn" "$W/hub.old"
cp "$CREDSTORE/gpt02-core-evidence-reader-dsn" "$W/core.old"
chmod 600 "$W/hub.old" "$W/core.old"
BACKUP=1

HUB_PASS=$(openssl rand -hex 32)
CORE_PASS=$(openssl rand -hex 32)
printf 'postgresql://gpt02_hub_evidence_reader.%s:%s@%s:5432/postgres' "$PROJECT" "$HUB_PASS" "$POOLER" > "$W/hub.dsn"
printf 'postgresql://gpt02_core_evidence_reader.%s:%s@%s:5432/postgres' "$PROJECT" "$CORE_PASS" "$POOLER" > "$W/core.dsn"
chmod 600 "$W/hub.dsn" "$W/core.dsn"

# Encrypt using the exact credential names referenced by the systemd unit.
systemd-creds --with-key=host --name=hub-reader-dsn encrypt "$W/hub.dsn" "$W/hub.enc"
systemd-creds --with-key=host --name=core-reader-dsn encrypt "$W/core.dsn" "$W/core.enc"
systemd-creds --with-key=host --name=hub-reader-dsn decrypt "$W/hub.enc" "$W/hub.roundtrip"
systemd-creds --with-key=host --name=core-reader-dsn decrypt "$W/core.enc" "$W/core.roundtrip"
cmp -s "$W/hub.dsn" "$W/hub.roundtrip" || deny HUB_CREDENTIAL_ROUNDTRIP_FAILED
cmp -s "$W/core.dsn" "$W/core.roundtrip" || deny CORE_CREDENTIAL_ROUNDTRIP_FAILED

# Atomic install; files are root-only and remain outside the repository.
install -o root -g root -m 600 "$W/hub.enc" "$W/hub.new"
install -o root -g root -m 600 "$W/core.enc" "$W/core.new"
mv -f "$W/hub.new" "$CREDSTORE/gpt02-hub-evidence-reader-dsn"
mv -f "$W/core.new" "$CREDSTORE/gpt02-core-evidence-reader-dsn"

# psql reads the generated values from a root-only SQL file; no secret is logged.
{
  printf '\\set hub_pw %s\n' "$HUB_PASS"
  printf '\\set core_pw %s\n' "$CORE_PASS"
  cat <<'SQL'
BEGIN;
ALTER ROLE gpt02_hub_evidence_reader LOGIN CONNECTION LIMIT 1 PASSWORD :'hub_pw';
ALTER ROLE gpt02_core_evidence_reader LOGIN CONNECTION LIMIT 1 PASSWORD :'core_pw';
COMMIT;
SQL
} > "$W/sync.sql"
chmod 600 "$W/sync.sql"
docker run --rm --network host --env-file "$APP_ENV_FILE" -v "$W:/run/gpt02:ro" "$IMAGE" sh -lc '
psql "$SUPABASE_DATABASE_URL_DEV" -X -q -v ON_ERROR_STOP=1 -f /run/gpt02/sync.sql'
DB_UPDATED=1

# systemd decrypts the encrypted DSNs into the fixed private credential mount.
systemctl reset-failed "$UNIT" >/dev/null 2>&1 || true
systemctl start "$UNIT"
for _attempt in $(seq 1 30); do
  [ -S /run/gpt02-reader/reader.sock ] && break
  sleep 0.5
done
systemctl is-active --quiet "$UNIT" || deny READER_UNIT_NOT_ACTIVE
[ -S /run/gpt02-reader/reader.sock ] || deny READER_SOCKET_NOT_READY
# Do not poll the health endpoint repeatedly: each health check opens two
# independent DB sessions and may take several seconds on a cold pooler.
HEALTH=$(curl --silent --show-error --fail --max-time 15 --unix-socket /run/gpt02-reader/reader.sock http://localhost/health) || deny READER_HEALTH_ENDPOINT_FAILED

# Health is only PASS when both independent pools authenticate and verify.
printf '%s\n' "$HEALTH" | grep -Fq '"readerReady":true' || deny READER_HEALTH_NOT_READY
printf '%s\n' "$HEALTH" | grep -Fq '"twoSessionsVerified":true' || deny READER_BACKENDS_NOT_INDEPENDENT
printf '%s\n' "$HEALTH" | grep -Fq '"signingPermitted":false' || deny SIGNING_FLAG_DRIFT
printf '%s\n' "$HEALTH" | grep -Fq '"dispatchPermitted":false' || deny DISPATCH_FLAG_DRIFT

# Independent catalog read-back of the exact bounded login state and live sessions.
cat > "$W/after.sql" <<'SQL'
SELECT string_agg(
 r.rolname||'|'||r.rolcanlogin||'|'||r.rolconnlimit||'|'||
 (SELECT count(*) FROM pg_auth_members m WHERE m.member=r.oid)||'|'||
 (SELECT count(*) FROM pg_stat_activity a WHERE a.usename=r.rolname),
 ';' ORDER BY r.rolname)
FROM pg_roles r
WHERE r.rolname IN ('gpt02_hub_evidence_reader','gpt02_core_evidence_reader');
SQL
AFTER=$(docker run --rm --network host --env-file "$APP_ENV_FILE" \
 -v "$W:/run/gpt02:ro" "$IMAGE" sh -lc \
 'psql "$SUPABASE_DATABASE_URL_DEV" -X -qAt -v ON_ERROR_STOP=1 -f /run/gpt02/after.sql')
EXPECTED_AFTER='gpt02_core_evidence_reader|true|1|0|1;gpt02_hub_evidence_reader|true|1|0|1'
[ "$AFTER" = "$EXPECTED_AFTER" ] || deny READER_ROLE_READBACK_MISMATCH

SUCCESS=1
echo GPT02_READER_CREDENTIAL_SYNC=PASS
echo GPT02_READER_RUNTIME=ACTIVE
echo GPT02_READER_HEALTH=PASS
echo SIGNING=OFF
echo DISPATCH=OFF
