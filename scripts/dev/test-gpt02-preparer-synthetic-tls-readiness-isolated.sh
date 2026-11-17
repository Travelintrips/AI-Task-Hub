#!/usr/bin/env bash
# Isolated TLS transport and limited-role regression for the existing GPT02 preparer.
# Synthetic CA only: tests code path, NOT the production-pinned CA or real approval.
# No hosted database access, no public Docker ports, no native dispatch.
set -euo pipefail
umask 077
WORK=$(mktemp -d /tmp/aitask-gpt02-pinned-tls.XXXXXX)
NET="gpt02-tls-isolated-$$"
PG="gpt02-tls-pg-$$"
IMAGE="${GPT02_TEST_DEV_IMAGE:-ai-task-hub:dev-pr196-9c839deb-stage}"
ROOT_PASSWORD=$(openssl rand -hex 24)
LOGIN_PASSWORD=$(openssl rand -hex 24)
cleanup() {
  docker rm -f "$PG" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  rm -rf -- "$WORK"
}
trap cleanup EXIT
docker image inspect "$IMAGE" >/dev/null
mkdir -p "$WORK/certs"
chmod 755 "$WORK/certs"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -sha256 \
  -subj '/CN=GPT02 Synthetic Offline CA' \
  -keyout "$WORK/ca.key" -out "$WORK/certs/ca.crt" >/dev/null 2>&1
openssl req -newkey rsa:2048 -nodes -sha256 \
  -subj '/CN=pg' \
  -keyout "$WORK/certs/server.key" -out "$WORK/server.csr" >/dev/null 2>&1
printf 'subjectAltName=DNS:pg\nextendedKeyUsage=serverAuth\n' > "$WORK/server.ext"
openssl x509 -req -days 1 -sha256 -in "$WORK/server.csr" \
  -CA "$WORK/certs/ca.crt" -CAkey "$WORK/ca.key" -CAcreateserial \
  -extfile "$WORK/server.ext" -out "$WORK/certs/server.crt" >/dev/null 2>&1
chown 70:70 "$WORK/certs/server.key"
chmod 600 "$WORK/certs/server.key"
chmod 644 "$WORK/certs/server.crt" "$WORK/certs/ca.crt"
docker network create --internal "$NET" >/dev/null
docker run -d --name "$PG" --network "$NET" --network-alias pg \
  --mount "type=bind,src=$WORK/certs,dst=/tls,readonly" \
  -e POSTGRES_USER=fixture_root -e POSTGRES_DB=postgres \
  -e "POSTGRES_PASSWORD=$ROOT_PASSWORD" \
  -e POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256 \
  postgres:16-alpine \
  -c ssl=on -c ssl_cert_file=/tls/server.crt -c ssl_key_file=/tls/server.key \
  -c ssl_ca_file=/tls/ca.crt >/dev/null
ready=false
for i in $(seq 1 45); do
  logs=$(docker logs "$PG" 2>&1 || true)
  if [[ "$logs" == *'PostgreSQL init process complete'* ]] &&
     docker exec "$PG" pg_isready -U fixture_root -d postgres >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 0.5
done
[[ "$ready" == true ]] || { echo FAIL:PG_FIXTURE_NOT_READY; docker logs --tail 15 "$PG"; exit 1; }
EXPIRY=$(date -u -d '+8 minutes' '+%Y-%m-%d %H:%M:%S+00')
docker exec -i "$PG" psql -X -U fixture_root -d postgres \
  -v ON_ERROR_STOP=1 >/dev/null <<SQL
SET password_encryption='scram-sha-256';
REVOKE CONNECT,TEMP,CREATE ON DATABASE postgres FROM PUBLIC;
CREATE SCHEMA ai_platform;
CREATE TABLE ai_platform.ai_coding_bridge_commands (id uuid PRIMARY KEY);
CREATE TABLE ai_platform.ai_coding_tasks (id uuid PRIMARY KEY);
CREATE TABLE public.ai_execution_jobs (id uuid PRIMARY KEY);
CREATE ROLE gpt02_core_prep_login LOGIN NOINHERIT NOSUPERUSER NOCREATEDB
 NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 1
 PASSWORD '$LOGIN_PASSWORD' VALID UNTIL '$EXPIRY';
GRANT CONNECT ON DATABASE postgres TO gpt02_core_prep_login;
SQL
cat > "$WORK/verify.mjs" <<'JS'
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {Gpt02CoreTaskPreparer} from '/app/artifacts/api-server/src/lib/gpt02-core-task-preparation.mjs';
const require=createRequire('/app/artifacts/api-server/package.json');
const {Pool}=require('pg');
const mode=process.argv[2];
const options={
  host:'pg',port:5432,database:'postgres',user:'gpt02_core_prep_login',
  password:process.env.FIXTURE_PASSWORD,max:1,connectionTimeoutMillis:5000,
  ssl:mode==='plain'?false:mode==='no-trust'?{rejectUnauthorized:true}:
    {ca:readFileSync('/tls/ca.crt','utf8'),rejectUnauthorized:true}
};
const pool=new Pool(options);
try{
  const p=new Gpt02CoreTaskPreparer({pool});
  if(mode==='positive'){
    const result=await p.verifyReadiness();
    assert.equal(result.verified,true);
    assert.equal(result.readOnly,true);
    assert.equal(result.dispatchPermitted,false);
    assert.equal(result.operatorApprovalGranted,false);
    assert.equal(result.issuerGrantReady,false);
    console.log('PASS:ACTUAL_MODULE_AUTHENTICATED_TLS_READ_ONLY_NO_DISPATCH');
  }else if(mode==='plain'){
    await assert.rejects(p.verifyReadiness(),e=>e.code==='PINNED_TLS_PREPARER_SESSION_REQUIRED');
    console.log('PASS:NON_TLS_CONNECTION_DENIED_BY_MODULE');
  }else if(mode==='no-trust'){
    await assert.rejects(p.verifyReadiness(),e=>e.code==='PREPARER_READ_ONLY_CONNECTION_UNAVAILABLE');
    console.log('PASS:UNTRUSTED_TLS_CERTIFICATE_DENIED');
  }else if(mode==='overgrant'){
    await assert.rejects(p.verifyReadiness(),e=>e.code==='DIRECT_LEDGER_WRITE_OR_COMMAND_AUTHORITY_FORBIDDEN');
    console.log('PASS:EXCESS_DATABASE_PRIVILEGE_DENIED');
  }else{throw new Error('UNKNOWN_SYNTHETIC_CASE');}
}finally{await pool.end();}
JS
chmod 644 "$WORK/verify.mjs"
run_node(){
  local case_name="$1"
  docker run --rm --network "$NET" --user 1000:1000 --read-only --cap-drop ALL \
    --security-opt no-new-privileges --entrypoint node \
    --mount "type=bind,src=$WORK/certs,dst=/tls,readonly" \
    --mount "type=bind,src=$WORK/verify.mjs,dst=/tmp/gpt02-tls-smoke.mjs,readonly" \
    -e "FIXTURE_PASSWORD=$LOGIN_PASSWORD" \
    "$IMAGE" /tmp/gpt02-tls-smoke.mjs "$case_name"
}
# All test traffic is confined to the internal Docker network, no public ports.
run_node positive
run_node plain
run_node no-trust
docker exec "$PG" psql -X -U fixture_root -d postgres -v ON_ERROR_STOP=1 \
  -c 'GRANT SELECT ON ai_platform.ai_coding_tasks TO gpt02_core_prep_login' >/dev/null
run_node overgrant
docker exec "$PG" psql -X -U fixture_root -d postgres -v ON_ERROR_STOP=1 \
  -c 'REVOKE SELECT ON ai_platform.ai_coding_tasks FROM gpt02_core_prep_login' >/dev/null
count=$(docker exec "$PG" psql -X -At -U fixture_root -d postgres \
  -c 'SELECT (SELECT count(*) FROM ai_platform.ai_coding_tasks)::text||chr(58)||(SELECT count(*) FROM public.ai_execution_jobs)::text||chr(58)||(SELECT count(*) FROM ai_platform.ai_coding_bridge_commands)::text')
[[ "$count" == "0:0:0" ]] || { echo FAIL:TEST_CREATED_LEDGER_ROWS; exit 1; }
echo PASS:ZERO_CORE_HUB_COMMAND_ROWS
echo GPT02_SYNTHETIC_TLS_SCOPED_READINESS_5_ASSERTIONS_PASS
echo NO_HOSTED_DB_NO_PRODUCTION_CERT_NO_DISPATCH
