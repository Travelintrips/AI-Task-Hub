#!/usr/bin/env bash
# Disposable PostgreSQL 16 test ONLY. Never connects to CST-DEV or PROD.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
script="$root/scripts/dev/vps-identity-reader-prepare.sql"
name="pr186-inventory-reader-pg16-$$"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
if docker container inspect "$name" >/dev/null 2>&1; then
  echo "NAME_COLLISION" >&2; exit 11
fi
docker run --detach --name "$name" --network none --restart no \
  --read-only --user postgres:postgres --cap-drop ALL --security-opt no-new-privileges \
  --pids-limit 80 --memory 256m \
  --tmpfs /var/lib/postgresql/data:rw,nosuid,nodev,uid=70,gid=70,mode=0700,size=128m \
  --tmpfs /var/run/postgresql:rw,nosuid,nodev,uid=70,gid=70,size=8m \
  --tmpfs /tmp:rw,nosuid,nodev,size=8m \
  --env POSTGRES_PASSWORD=synthetic-not-for-real-use \
  postgres:16-alpine >/dev/null
ready=false
for attempt in 1 2 3 4 5 6 7 8; do
  if docker exec "$name" pg_isready -U postgres >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  echo "OFFLINE_POSTGRES_START_FAILED" >&2
  docker logs "$name" --tail 16 | head -16 >&2
  exit 13
fi
# postgres entrypoint briefly stops its temporary initialization server.
# Wait for the final post-init server rather than racing the shutdown.
sleep 2
for attempt in 1 2 3 4 5; do
  if docker exec "$name" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec -i "$name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
CREATE TABLE public.users (
  id text PRIMARY KEY, email text, company_id integer,
  role text NOT NULL, is_active boolean, status text NOT NULL,
  password_hash text
);
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
INSERT INTO public.users VALUES
('google_synthetic_admin_1','admin@example.invalid',NULL,'super_admin',true,'active','SENTINEL_HASH'),
('google_synthetic_admin_2','admin2@example.invalid',2,'super_admin',true,'active','SENTINEL_HASH'),
('google_synthetic_inactive','old@example.invalid',NULL,'super_admin',false,'active','SENTINEL_HASH'),
('google_synthetic_staff','staff@example.invalid',NULL,'staff',true,'active','SENTINEL_HASH');
SQL
docker exec -i "$name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres < "$script"
check="$(docker exec -i "$name" psql -At -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
SELECT (NOT rolcanlogin) AND (NOT rolbypassrls) AND (NOT rolsuper) AND
       (NOT rolcreaterole) AND (NOT rolcreatedb) AND rolconnlimit=1
FROM pg_roles WHERE rolname='ai_task_vps_identity_reader_dev';
SELECT has_column_privilege('ai_task_vps_identity_reader_dev','public.users','id','SELECT') AND
       has_column_privilege('ai_task_vps_identity_reader_dev','public.users','email','SELECT') AND
       NOT has_column_privilege('ai_task_vps_identity_reader_dev','public.users','password_hash','SELECT') AND
       NOT has_table_privilege('ai_task_vps_identity_reader_dev','public.users','INSERT') AND
       NOT has_table_privilege('ai_task_vps_identity_reader_dev','public.users','UPDATE') AND
       NOT has_table_privilege('ai_task_vps_identity_reader_dev','public.users','DELETE');
BEGIN READ ONLY;
SELECT set_config('ai_task_vps.identity_id','google_synthetic_admin_1',true);
SELECT set_config('ai_task_vps.identity_email','admin@example.invalid',true);
SELECT set_config('ai_task_vps.identity_company','@NULL@',true);
SET LOCAL ROLE ai_task_vps_identity_reader_dev;
SELECT count(*) = 1 FROM public.users WHERE id='google_synthetic_admin_1' AND role='super_admin' AND is_active;
RESET ROLE;
ROLLBACK;
BEGIN READ ONLY;
SET LOCAL ROLE ai_task_vps_identity_reader_dev;
SELECT count(*) = 0 FROM public.users;
RESET ROLE;
ROLLBACK;
BEGIN READ ONLY;
SELECT set_config('ai_task_vps.identity_id','google_synthetic_admin_1',true);
SELECT set_config('ai_task_vps.identity_email','wrong@example.invalid',true);
SELECT set_config('ai_task_vps.identity_company','@NULL@',true);
SET LOCAL ROLE ai_task_vps_identity_reader_dev;
SELECT count(*) = 0 FROM public.users;
RESET ROLE;
ROLLBACK;
BEGIN READ ONLY;
SELECT set_config('ai_task_vps.identity_id','google_synthetic_admin_2',true);
SELECT set_config('ai_task_vps.identity_email','admin2@example.invalid',true);
SELECT set_config('ai_task_vps.identity_company','@NULL@',true);
SET LOCAL ROLE ai_task_vps_identity_reader_dev;
SELECT count(*) = 0 FROM public.users;
RESET ROLE;
ROLLBACK;
BEGIN READ ONLY;
SELECT set_config('ai_task_vps.identity_id','google_synthetic_admin_2',true);
SELECT set_config('ai_task_vps.identity_email','admin2@example.invalid',true);
SELECT set_config('ai_task_vps.identity_company','2',true);
SET LOCAL ROLE ai_task_vps_identity_reader_dev;
SELECT count(*) = 1 FROM public.users;
RESET ROLE;
ROLLBACK;
BEGIN READ ONLY;
SELECT set_config('ai_task_vps.identity_id','google_synthetic_inactive',true);
SELECT set_config('ai_task_vps.identity_email','old@example.invalid',true);
SELECT set_config('ai_task_vps.identity_company','@NULL@',true);
SET LOCAL ROLE ai_task_vps_identity_reader_dev;
SELECT count(*) = 0 FROM public.users;
RESET ROLE;
ROLLBACK;
SQL
)"
bools="$(printf '%s\n' "$check" | grep -E '^(t|f)$' | tr '\n' ' ')"
[[ "$bools" = "t t t t t t t t " ]] || { echo "ROLE_RLS_ASSERTION_FAILED: $bools"; exit 21; }
if docker exec -i "$name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres >/dev/null 2>&1 <<'SQL'
SET ROLE ai_task_vps_identity_reader_dev;
SELECT password_hash FROM public.users LIMIT 1;
SQL
then echo "SECRET_COLUMN_READ_ALLOWED" >&2; exit 22; fi
if docker exec -i "$name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres >/dev/null 2>&1 <<'SQL'
SET ROLE ai_task_vps_identity_reader_dev;
UPDATE public.users SET status='inactive' WHERE id='google_synthetic_admin_1';
SQL
then echo "UPDATE_ALLOWED" >&2; exit 23; fi
echo "ISOLATED_POSTGRES16_ROLE_AND_RLS=PASS"
echo "NO_NETWORK_NO_REAL_DATABASE=PASS"
echo "NO_SECRETS_OR_CREDENTIALS_SAVED=PASS"
