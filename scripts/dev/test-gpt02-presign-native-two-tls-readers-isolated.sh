#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REF="$ROOT/pr196-verifier-reference"
test -s "$REF/artifacts/api-server/src/lib/gpt02-presign-facts-readonly.mjs"
test -s "$ROOT/artifacts/api-server/src/lib/gpt02-single-owner-trusted-facts-adapter.mjs"
test -s "$ROOT/scripts/dev/fixtures/gpt02-presign-real-two-tls-readers.sql"
test -s "$ROOT/scripts/dev/gpt02-presign-native-two-tls-readers.integration.test.mjs"
name="gpt02-presign-tls-$$"
net="gpt02-presign-net-$$"
work="$(mktemp -d)"
chmod 700 "$work"
cid=''
createdNet=false
cleanup(){
 if [[ -n "$cid" ]]; then docker rm -f "$cid" >/dev/null 2>&1 || true;fi
 if [[ "$createdNet" == true ]]; then docker network rm "$net" >/dev/null 2>&1 || true;fi
 rm -rf "$work"
}
trap cleanup EXIT
# Self-signed certificate and new SCRAM credentials are disposable test assets.
openssl req -newkey rsa:2048 -nodes -x509 -days 1 -sha256 \
 -keyout "$work/server.key" -out "$work/server.crt" \
 -subj "/CN=synthetic-pg" -addext "subjectAltName=DNS:synthetic-pg" \
 >/dev/null 2>&1
chmod 600 "$work/server.key"
# Ordinary GitHub runners cannot chown to the PostgreSQL container UID;
# do the ownership adjustment only in a disposable root-owned Docker helper.
if ! chown 70:70 "$work/server.key" "$work/server.crt" 2>/dev/null; then
 docker run --rm --network none --entrypoint chown \
  --mount "type=bind,src=$work,dst=/work" \
  postgres:16-alpine 70:70 /work/server.key /work/server.crt >/dev/null
fi
node - "$work" <<'NODE'
const fs=require('node:fs'),{randomBytes}=require('node:crypto');
const dir=process.argv[2],roles=['postgres','gpt02_hub_evidence_reader','gpt02_core_evidence_reader'];
const pass=Object.fromEntries(roles.map(x=>[x,randomBytes(32).toString('hex')]));
fs.writeFileSync(dir+'/auth.json',JSON.stringify(pass),{mode:0o600});
fs.writeFileSync(dir+'/pg.env',`POSTGRES_PASSWORD=${pass.postgres}\nPOSTGRES_DB=postgres\nPOSTGRES_INITDB_ARGS=--auth-local=trust --auth-host=scram-sha-256\n`,{mode:0o600});
fs.writeFileSync(dir+'/passwords.sql',roles.slice(1).map(r=>`ALTER ROLE ${r} PASSWORD '${pass[r]}';`).join('\n'),{mode:0o600});
NODE
docker network create --internal "$net" >/dev/null;createdNet=true
cid="$(docker run -d --name "$name" --network "$net" --network-alias synthetic-pg \
 --restart no --env-file "$work/pg.env" \
 --mount "type=bind,src=$work/server.key,dst=/run/ssl/server.key,readonly" \
 --mount "type=bind,src=$work/server.crt,dst=/run/ssl/server.crt,readonly" \
 postgres:16-alpine -c ssl=on -c ssl_cert_file=/run/ssl/server.crt \
 -c ssl_key_file=/run/ssl/server.key)"
for _ in $(seq 1 60);do
 if docker exec "$cid" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1;then break;fi
 test "$(docker inspect -f '{{.State.Status}}' "$cid")" != exited
 sleep 1
done
docker exec "$cid" pg_isready -h 127.0.0.1 -U postgres >/dev/null
{ cat "$ROOT/scripts/dev/fixtures/gpt02-presign-real-two-tls-readers.sql"; cat "$work/passwords.sql"; } |
 docker exec -i "$cid" psql -X -U postgres -d postgres -q -v ON_ERROR_STOP=1 >/dev/null
test -z "$(docker port "$cid")"
docker run --rm --network "$net" --read-only --tmpfs /tmp:rw,nosuid,nodev,size=32m \
 --mount "type=bind,src=$ROOT,dst=/workspace,readonly" \
 --mount "type=bind,src=$work/auth.json,dst=/run/fixture-auth.json,readonly" \
 --mount "type=bind,src=$work/server.crt,dst=/run/ssl/server.crt,readonly" \
 -e GPT02_TWO_TLS_READERS_DISPOSABLE_ONLY=1 \
 -e GPT02_TEST_PG_MODULE=/workspace/artifacts/api-server/node_modules/pg \
 node:22-alpine node --test /workspace/scripts/dev/gpt02-presign-native-two-tls-readers.integration.test.mjs
echo GPT02_REAL_TWO_SCRAM_TLS_READERS_AND_PRESIGN_ADAPTER_PASS
