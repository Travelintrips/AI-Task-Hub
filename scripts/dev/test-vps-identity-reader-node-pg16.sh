#!/usr/bin/env bash
# Portable CI harness: synthetic Postgres and TLS only; internal Docker network.
# Never consumes real Supabase credentials or connects to CST-DEV/PROD.
set -euo pipefail
script_dir="$(cd "$(dirname "$0")" && pwd)"
if [[ -v PR188_TEST_SOURCE_ROOT ]];then src="$PR188_TEST_SOURCE_ROOT";else src="$(cd "$script_dir/../.." && pwd)";fi
work="$(mktemp -d /tmp/ai-task-vps-reader-node-pg16.XXXXXXXX)"
net="ai-task-vps-rdr-$$-net"
db="ai-task-vps-rdr-$$-db"
host=aws-1-ap-southeast-2.pooler.supabase.com
have_net=false
have_db=false
cleanup(){
 rc=$?
 set +e
 if [[ "$have_db" == true ]];then docker rm -f "$db" >/dev/null 2>&1;fi
 if [[ "$have_net" == true ]];then docker network rm "$net" >/dev/null 2>&1;fi
 rm -rf "$work"
 echo SYNTHETIC_POSTGRES_AND_PRIVATE_NETWORK_REMOVED=true
 exit "$rc"
}
trap cleanup EXIT
test -f "$src/artifacts/api-server/src/lib/vps-storage-readonly-db.ts"
test -f "$src/scripts/dev/vps-identity-reader-prepare.sql"
test -f "$script_dir/vps-identity-reader-node-pg16.mjs"
for img in postgres:16-alpine node:24-bookworm-slim;do
 if ! docker image inspect "$img" >/dev/null 2>&1;then docker pull "$img" >/dev/null;fi
done
echo '=== LOCKFILE-BASED RUNTIME PACKAGE; NO FULL APP REBUILD ==='
(cd "$src" && pnpm --filter @workspace/api-server deploy --legacy --prod "$work/app") >/dev/null
test -f "$work/app/src/lib/vps-storage-readonly-db.ts"
test -e "$work/app/node_modules/pg"
echo PORTABLE_RUNTIME_PACKAGE_READY=PASS
if docker network inspect "$net" >/dev/null 2>&1;then echo NETWORK_COLLISION_ABORT;exit 6;fi
if docker inspect "$db" >/dev/null 2>&1;then echo PG_COLLISION_ABORT;exit 6;fi
chmod 0644 "$script_dir/vps-identity-reader-node-pg16.mjs"
echo '=== OFFLINE TEST CERTIFICATE; NOT SUPABASE PUBLIC CA ==='
openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 1 \
 -subj "/CN=$host" -addext "subjectAltName=DNS:$host" \
 -addext "basicConstraints=critical,CA:TRUE" \
 -keyout "$work/key.pem" -out "$work/cert.pem" >/dev/null 2>&1
chmod 0644 "$work/cert.pem"
chmod 0600 "$work/key.pem"
docker run --rm --network none --read-only --user root:root \
 --cap-drop ALL --cap-add CHOWN \
 --mount "type=bind,src=$work/key.pem,dst=/tmp/offline-db.key" \
 --entrypoint chown postgres:16-alpine postgres:postgres /tmp/offline-db.key
openssl verify -CAfile "$work/cert.pem" "$work/cert.pem" >/dev/null
echo SYNTHETIC_CA_CERT_GENERATED=PASS
docker network create --internal --driver bridge "$net" >/dev/null
have_net=true
test "$(docker network inspect "$net" --format '{{.Internal}}')" = true
echo PRIVATE_ISOLATED_DOCKER_NETWORK_CREATED=PASS
docker run -d --name "$db" --network "$net" --restart no \
 --read-only --user postgres:postgres --cap-drop ALL --security-opt no-new-privileges \
 --pids-limit 80 --memory 280m \
 --tmpfs /var/lib/postgresql/data:rw,nosuid,nodev,uid=70,gid=70,mode=0700,size=128m \
 --tmpfs /var/run/postgresql:rw,nosuid,nodev,uid=70,gid=70,size=8m \
 --tmpfs /tmp:rw,nosuid,nodev,size=8m \
 --mount "type=bind,src=$work/cert.pem,dst=/tmp/test-pg.crt,readonly" \
 --mount "type=bind,src=$work/key.pem,dst=/tmp/test-pg.key,readonly" \
 --env POSTGRES_PASSWORD=synthetic_postgres_password_not_real \
 postgres:16-alpine -c listen_addresses='*' -c ssl=on \
 -c ssl_cert_file=/tmp/test-pg.crt -c ssl_key_file=/tmp/test-pg.key >/dev/null
have_db=true
ready=false
for n in 1 2 3 4 5 6 7 8;do if docker exec "$db" pg_isready -U postgres >/dev/null 2>&1;then ready=true;break;fi;sleep 1;done
test "$ready" = true || { echo PG16_FAILED;docker logs "$db" --tail 12;exit 8; }
sleep 2
for n in 1 2 3 4 5;do if docker exec "$db" pg_isready -U postgres >/dev/null 2>&1;then break;fi;sleep 1;done
echo '=== CREATE SYNTHETIC USERS AND RUN UNMODIFIED PR186 POLICY ==='
docker exec -i "$db" psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
CREATE TABLE public.users(id text PRIMARY KEY,email text,company_id integer,role text NOT NULL,is_active boolean,status text NOT NULL,password_hash text);
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
INSERT INTO public.users VALUES
('google_synthetic_admin_1','admin@example.invalid',NULL,'super_admin',true,'active','TEST_ONLY'),
('google_synthetic_admin_2','admin2@example.invalid',2,'super_admin',true,'active','TEST_ONLY'),
('google_synthetic_inactive','old@example.invalid',NULL,'super_admin',false,'active','TEST_ONLY'),
('google_synthetic_staff','staff@example.invalid',NULL,'staff',true,'active','TEST_ONLY');
SQL
docker exec -i "$db" psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres < "$src/scripts/dev/vps-identity-reader-prepare.sql"
docker exec -i "$db" psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
CREATE ROLE "ai_task_vps_identity_reader_dev.xssrfshdrtdfupgqwfdw" WITH
 LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
 CONNECTION LIMIT 1 PASSWORD 'synthetic_only_reader_pass_2026_11_14_very_long';
GRANT ai_task_vps_identity_reader_dev TO "ai_task_vps_identity_reader_dev.xssrfshdrtdfupgqwfdw";
SQL
ip=$(docker inspect "$db" --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')
case "$ip" in 172.*|192.168.*|10.*) echo SYNTHETIC_DB_PRIVATE_IP_PASS=true;; *) echo PG_IP_REFUSED;exit 10;;esac
test -z "$(docker port "$db")"
echo '=== PACKAGE TEST CLIENT AND PUBLIC SYNTHETIC CA BEFORE READONLY MOUNT ==='
install -m 0644 "$script_dir/vps-identity-reader-node-pg16.mjs" "$work/app/offline-e2e.mjs"
install -m 0644 "$work/cert.pem" "$work/app/offline-ca.pem"
echo '=== CALL EXACT PR186 TYPESCRIPT READER WITH REAL SYNTHETIC PG16 LOGIN AND TLS ==='
docker run --pull never --rm --network "$net" --add-host "$host:$ip" \
 --read-only --user node:node --cap-drop ALL --security-opt no-new-privileges \
 --pids-limit 56 --memory 384m --cpus 1 \
 --mount "type=bind,src=$work/app,dst=/app,readonly" \
 --env "SYNTHETIC_PG_IP=$ip" --entrypoint node node:24-bookworm-slim \
 --experimental-strip-types /app/offline-e2e.mjs
echo ISOLATED_FULL_SOURCE_READER_E2E_FINISHED=PASS
