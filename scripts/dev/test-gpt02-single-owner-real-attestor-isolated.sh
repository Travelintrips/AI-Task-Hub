#!/usr/bin/env bash
# Disposable PostgreSQL: actual restricted attestor+issuer; no hosted Supabase or dispatch.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REF="$ROOT/pr196-verifier-reference"
test -s "$REF/scripts/dev/gpt02-issuer-store.fixture.sql"
test -s "$REF/scripts/dev/gpt02-operator-link.fixture.sql"
test -s "$REF/scripts/dev/gpt02-post-consumption-fence.fixture.sql"
test -s "$ROOT/artifacts/api-server/src/lib/gpt02-single-owner-approval-recorder.mjs"
test -s "$ROOT/artifacts/api-server/src/lib/gpt02-issuer-store.mjs"
test -d "$ROOT/artifacts/api-server/node_modules/pg"
WORK="$(mktemp -d)"; chmod 700 "$WORK"
NAME="gpt02-owner-attestor-$$"; SOCKET="gpt02-owner-socket-$$"
CID=''; CREATED=false
NODE_IMAGE="${GPT02_TEST_NODE_IMAGE:-node:24-bookworm-slim}"
cleanup(){
  if [[ -n "$CID" ]]; then docker rm -f "$CID" >/dev/null 2>&1 || true; fi
  if [[ "$CREATED" == true ]]; then docker volume rm "$SOCKET" >/dev/null 2>&1 || true; fi
  rm -rf "$WORK"
}
trap cleanup EXIT
node - "$WORK" <<'NODE'
const fs=require('node:fs'),{randomBytes}=require('node:crypto');
const dir=process.argv[2];
const roles=['postgres','dev_gpt02_attestor_evidence','dev_gpt02_issuer_evidence','gpt02_untrusted_app'];
const auth=Object.fromEntries(roles.map(k=>[k,randomBytes(32).toString('hex')]));
fs.writeFileSync(dir+'/auth.json',JSON.stringify(auth),{mode:0o600});
fs.writeFileSync(dir+'/pg.env',`POSTGRES_PASSWORD=${auth.postgres}\nPOSTGRES_DB=gpt02_issuer_isolated\nPOSTGRES_INITDB_ARGS=--auth-local=scram-sha-256 --auth-host=scram-sha-256\n`,{mode:0o600});
fs.writeFileSync(dir+'/passwords.sql',Object.entries(auth).filter(([k])=>k!=='postgres').map(([k,v])=>`ALTER ROLE ${k} PASSWORD '${v}';`).join('\n'),{mode:0o600});
NODE
docker volume create "$SOCKET" >/dev/null; CREATED=true
CID="$(docker run -d --name "$NAME" --network none --restart no \
  --env-file "$WORK/pg.env" \
  --mount "type=volume,src=$SOCKET,dst=/var/run/postgresql" \
  postgres:16-alpine -c unix_socket_directories=/var/run/postgresql -c listen_addresses='')"
ready=false
for _ in $(seq 1 60); do
  if [[ "$(docker inspect -f '{{.State.Status}}' "$CID")" == exited ]]; then echo POSTGRES_EXITED >&2; exit 2; fi
  if docker logs "$CID" 2>&1 | grep -F 'PostgreSQL init process complete' >/dev/null && \
    docker exec "$CID" sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -X -w -h /var/run/postgresql -U postgres -d gpt02_issuer_isolated -Atqc "SELECT 1"' 2>/dev/null | grep -qx 1; then ready=true; break; fi
  sleep 1
done
[[ "$ready" == true ]] || { echo POSTGRES_NOT_READY >&2; exit 2; }
{ cat "$REF/scripts/dev/gpt02-issuer-store.fixture.sql"
  cat "$REF/scripts/dev/gpt02-operator-link.fixture.sql"
  cat "$REF/scripts/dev/gpt02-post-consumption-fence.fixture.sql"
  cat "$WORK/passwords.sql"
} | docker exec -i "$CID" sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -X -w -h /var/run/postgresql -U postgres -d gpt02_issuer_isolated -v ON_ERROR_STOP=1 -q' >"$WORK/setup.log" 2>&1 || { echo ISOLATED_SCHEMA_SETUP_FAILED >&2; exit 2; }
test -z "$(docker port "$CID")"
docker run --rm --network none --user 0:0 --entrypoint node \
  --mount "type=volume,src=$SOCKET,dst=/var/run/postgresql" \
  --mount "type=bind,src=$ROOT,dst=/owner-workspace,readonly" \
  --mount "type=bind,src=$WORK/auth.json,dst=/run/fixture-auth.json,readonly" \
  -e GPT02_DISPOSABLE_PG_ONLY=1 \
  -e GPT02_TEST_PG_MODULE=/owner-workspace/artifacts/api-server/node_modules/pg \
  "$NODE_IMAGE" --test /owner-workspace/scripts/dev/gpt02-single-owner-real-attestor.integration.test.mjs
echo GPT02_REAL_ATTESTOR_OWNER_CANDIDATE_ISOLATED_PASS
echo LIVE_DEV_PROD_UNCHANGED_NO_NATIVE_DISPATCH
