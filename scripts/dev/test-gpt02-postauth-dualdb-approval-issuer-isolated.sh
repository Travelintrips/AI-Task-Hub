#!/usr/bin/env bash
# Single entirely synthetic DB-driven chain, no live Hub/Core, signer or DELL.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REF="$ROOT/pr196-verifier-reference"
for f in "$REF/artifacts/api-server/src/lib/gpt02-presign-facts-readonly.mjs" \
 "$ROOT/artifacts/api-server/src/lib/gpt02-single-owner-approval-recorder.mjs" \
 "$ROOT/artifacts/api-server/src/lib/gpt02-single-owner-trusted-facts-adapter.mjs" \
 "$ROOT/scripts/dev/fixtures/gpt02-presign-real-two-tls-readers.sql" \
 "$ROOT/scripts/dev/gpt02-postauth-dualdb-approval-issuer.integration.test.mjs" \
 "$REF/scripts/dev/gpt02-issuer-store.fixture.sql" \
 "$REF/scripts/dev/gpt02-operator-link.fixture.sql" \
 "$REF/scripts/dev/gpt02-post-consumption-fence.fixture.sql";do test -s "$f";done
net="gpt02-full-chain-net-$$"
name="gpt02-full-chain-pg-$$"
work="$(mktemp -d)";chmod 700 "$work"
cid='';netCreated=false
cleanup(){
 if [[ -n "$cid" ]];then docker rm -f "$cid" >/dev/null 2>&1 || true;fi
 if [[ "$netCreated" == true ]];then docker network rm "$net" >/dev/null 2>&1 || true;fi
 rm -rf "$work"
}
trap cleanup EXIT
openssl req -newkey rsa:2048 -nodes -x509 -days 1 -sha256 \
 -keyout "$work/server.key" -out "$work/server.crt" \
 -subj "/CN=synthetic-pg" -addext "subjectAltName=DNS:synthetic-pg" >/dev/null 2>&1
chmod 600 "$work/server.key"
if ! chown 70:70 "$work/server.key" "$work/server.crt" 2>/dev/null;then
 docker run --rm --network none --entrypoint chown \
 --mount "type=bind,src=$work,dst=/work" postgres:16-alpine 70:70 \
 /work/server.key /work/server.crt >/dev/null
fi
node - "$work" <<'NODE'
const fs=require('node:fs'),{randomBytes}=require('node:crypto');
const root=process.argv[2];
const roleNames=['postgres','gpt02_hub_evidence_reader','gpt02_core_evidence_reader',
 'dev_gpt02_attestor_evidence','dev_gpt02_issuer_evidence','gpt02_untrusted_app'];
const auth=Object.fromEntries(roleNames.map(r=>[r,randomBytes(32).toString('hex')]));
fs.writeFileSync(root+'/auth.json',JSON.stringify(auth),{mode:0o600});
fs.writeFileSync(root+'/pg.env',
 `POSTGRES_PASSWORD=${auth.postgres}\nPOSTGRES_DB=postgres\nPOSTGRES_INITDB_ARGS=--auth-local=scram-sha-256 --auth-host=scram-sha-256\n`,
 {mode:0o600});
fs.writeFileSync(root+'/passwords.sql',
 roleNames.filter(r=>r!=='postgres').map(r=>`ALTER ROLE ${r} PASSWORD '${auth[r]}';`).join('\n'),
 {mode:0o600});
NODE
docker network create --internal "$net" >/dev/null;netCreated=true
cid="$(docker run -d --name "$name" --network "$net" --network-alias synthetic-pg \
 --restart no --env-file "$work/pg.env" \
 --mount "type=bind,src=$work/server.key,dst=/run/ssl/server.key,readonly" \
 --mount "type=bind,src=$work/server.crt,dst=/run/ssl/server.crt,readonly" \
 --mount "type=bind,src=$work/pr196-auth.cjs,dst=/run/fixture-auth/pr196-auth.cjs,readonly" \
 postgres:16-alpine -c ssl=on -c ssl_cert_file=/run/ssl/server.crt \
 -c ssl_key_file=/run/ssl/server.key)"
pgexec(){
 docker exec -i "$cid" sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -X -w -h /var/run/postgresql -U postgres -d "$1" -v ON_ERROR_STOP=1 -q' -- "$1"
}
ready=false
for _ in $(seq 1 60);do
 if [[ "$(docker inspect -f '{{.State.Status}}' "$cid")" == exited ]];then echo PG_EXITED >&2;exit 2;fi
 if docker logs "$cid" 2>&1 | grep -F 'PostgreSQL init process complete' >/dev/null && \
 docker exec "$cid" sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -X -w -h /var/run/postgresql -U postgres -d postgres -Atqc "SELECT 1"' 2>/dev/null | grep -Fx 1 >/dev/null;then ready=true;break;fi
 sleep 1
done
[[ "$ready" == true ]] || { echo POSTGRES_NOT_READY >&2;exit 2; }
cat "$ROOT/scripts/dev/fixtures/gpt02-presign-real-two-tls-readers.sql" |
 docker exec -i "$cid" sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -X -w -h /var/run/postgresql -U postgres -d postgres -v ON_ERROR_STOP=1 -q' >"$work/presign.log" 2>&1 ||
 { echo PRE_SIGN_FIXTURE_SETUP_FAILED >&2;exit 2; }
docker exec "$cid" sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -X -w -h /var/run/postgresql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE gpt02_issuer_isolated"' >"$work/db.log" 2>&1 ||
 { echo ISOLATED_EVIDENCE_DB_CREATION_FAILED >&2;exit 2;}
{ cat "$REF/scripts/dev/gpt02-issuer-store.fixture.sql"
  cat "$REF/scripts/dev/gpt02-operator-link.fixture.sql"
  cat "$REF/scripts/dev/gpt02-post-consumption-fence.fixture.sql"
  cat "$work/passwords.sql"
} | docker exec -i "$cid" sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -X -w -h /var/run/postgresql -U postgres -d gpt02_issuer_isolated -v ON_ERROR_STOP=1 -q' >"$work/evidence.log" 2>&1 ||
 { echo ISOLATED_EVIDENCE_SCHEMA_SETUP_FAILED >&2;exit 2;}
# Bundle only the ORIGINAL pinned PR196 JWT middleware for this disposable
# one-process E2E. The real signer does not load, and no auth session is read.
node - "$ROOT" "$REF" "$work/pr196-auth.cjs" <<'NODE'
const {createRequire}=require('node:module');
const [root,ref,output]=process.argv.slice(2);
const esbuild=createRequire(root+'/artifacts/api-server/package.json')('esbuild');
(async()=>{
 await esbuild.build({entryPoints:[ref+'/artifacts/api-server/src/middleware/auth.ts'],
  bundle:true,platform:'node',format:'cjs',target:'node22',outfile:output,
  nodePaths:[root+'/artifacts/api-server/node_modules',
    ref+'/artifacts/api-server/node_modules'],logLevel:'silent'});
})().catch(e=>{process.stderr.write('ISOLATED_AUTH_BUNDLE_FAILED\n');process.exitCode=1});
NODE
test -z "$(docker port "$cid")"
docker run --rm --network "$net" --read-only --tmpfs /tmp:rw,nosuid,nodev,size=64m \
 --mount "type=bind,src=$ROOT,dst=/workspace,readonly" \
 --mount "type=bind,src=$work/auth.json,dst=/run/fixture-auth.json,readonly" \
 --mount "type=bind,src=$work/server.crt,dst=/run/ssl/server.crt,readonly" \
 -e GPT02_POSTAUTH_FULL_CHAIN_DISPOSABLE_ONLY=1 \
 -e GPT02_PR196_AUTH_BUNDLE_PATH=/run/fixture-auth/pr196-auth.cjs \
 -e NODE_ENV=development -e APP_ENV=development \
 -e SESSION_SECRET=fixture_only_long_session_secret_unused_by_real_prod \
 node:22-alpine node --test /workspace/scripts/dev/gpt02-postauth-dualdb-approval-issuer.integration.test.mjs
echo GPT02_POSTAUTH_HUB_CORE_TLS_TO_SIGNED_APPROVAL_AND_ISSUER_INTEGRATION_PASS
echo LIVE_DEV_PROD_UNCHANGED_NO_NATIVE_DISPATCH
