#!/usr/bin/env bash
# DEV-only network-isolated positive TLS + one atomic Hub/Core preparation fixture.
# No hosted Supabase credentials, no public ports, no approval, no signer,
# no worker/DELL/WhatsApp dispatch, no PROD changes.
set -euo pipefail
umask 077
IMAGE="${GPT02_INTEGRATED_TEST_IMAGE:-ai-task-hub:dev-pr196-9c839deb-stage}"
SHA="9c839deb179620de8f3cd6946dfc9dfa9b361095"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
USE_CHECKOUT="${GPT02_INTEGRATED_USE_CHECKOUT:-false}"
SOURCE_MOUNT=()
if [[ "$USE_CHECKOUT" == true ]];then
  test -f "$ROOT/artifacts/api-server/src/lib/gpt02-core-task-preparation.mjs"
  test -f "$ROOT/artifacts/api-server/node_modules/pg/package.json"
  SOURCE_MOUNT=(--mount "type=bind,src=$ROOT,dst=/app,readonly")
fi
WORK=$(mktemp -d /tmp/gpt02-171-tls-atomic.XXXXXXXX)
NET="gpt02-171-atomic-net-$$"
PG="gpt02-171-atomic-pg-$$"
PGRANDOM=$(openssl rand -hex 25)
LOGINRANDOM=$(openssl rand -hex 25)
cleanup() {
  docker rm -f "$PG" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  rm -rf -- "$WORK"
}
trap cleanup EXIT
docker image inspect "$IMAGE" >/dev/null
mkdir -p "$WORK/certs" "$WORK/source"
chmod 755 "$WORK/certs"
fetch() {
 local name="$1"
 if [[ "$USE_CHECKOUT" == true ]];then
  cp -- "$ROOT/scripts/dev/$name" "$WORK/source/$name"
 else
  gh api "repos/Travelintrips/AI-Task-Hub/contents/scripts/dev/$name?ref=$SHA" --jq .content | base64 -d > "$WORK/source/$name"
 fi
 [[ -s "$WORK/source/$name" ]] || { echo "FIXTURE_SOURCE_MISSING:$name";exit 2; }
}
fetch gpt02-core-task-preparation-isolated.sql
fetch gpt02-core-preparer-rls-candidate.sql
fetch gpt02-preparer-instruction-bound-wrapper-candidate.sql
test "$(grep -Fc -- '-- GPT02_PREPARER_RLS_POLICY_INJECTION_POINT' "$WORK/source/gpt02-core-task-preparation-isolated.sql")" = 1
grep -Fq "PREPARATION_TASK_INSTRUCTION_NOT_BOUND" "$WORK/source/gpt02-preparer-instruction-bound-wrapper-candidate.sql"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -sha256 -subj '/CN=GPT02 Synthetic Internal CA' \
 -keyout "$WORK/ca.key" -out "$WORK/certs/ca.crt" >/dev/null 2>&1
openssl req -newkey rsa:2048 -nodes -sha256 -subj '/CN=pg' \
 -keyout "$WORK/certs/server.key" -out "$WORK/server.csr" >/dev/null 2>&1
printf 'subjectAltName=DNS:pg\nextendedKeyUsage=serverAuth\n' > "$WORK/server.ext"
openssl x509 -req -days 1 -sha256 -in "$WORK/server.csr" -CA "$WORK/certs/ca.crt" \
 -CAkey "$WORK/ca.key" -CAcreateserial -extfile "$WORK/server.ext" \
 -out "$WORK/certs/server.crt" >/dev/null 2>&1
chmod 600 "$WORK/certs/server.key"
chmod 644 "$WORK/certs/server.crt" "$WORK/certs/ca.crt"
docker network create --internal "$NET" >/dev/null
docker run -d --name "$PG" --network "$NET" --network-alias pg \
 --mount "type=bind,src=$WORK/certs,dst=/tls,readonly" \
 -e POSTGRES_USER=postgres -e POSTGRES_DB=postgres -e "POSTGRES_PASSWORD=$PGRANDOM" \
 -e POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256 \
 --entrypoint sh postgres:16-alpine -ec '
 cp /tls/server.key /tmp/gpt02-fixture-server.key
 cp /tls/server.crt /tmp/gpt02-fixture-server.crt
 chown postgres:postgres /tmp/gpt02-fixture-server.key
 chmod 600 /tmp/gpt02-fixture-server.key
 exec docker-entrypoint.sh postgres -c ssl=on \
   -c ssl_cert_file=/tmp/gpt02-fixture-server.crt \
   -c ssl_key_file=/tmp/gpt02-fixture-server.key \
   -c ssl_ca_file=/tls/ca.crt
 ' >/dev/null
ready=false
for i in $(seq 1 70);do
 logs=$(docker logs "$PG" 2>&1 || true)
 if [[ "$logs" == *'PostgreSQL init process complete'* ]] &&
    docker exec "$PG" psql -X -U postgres -d postgres -Atqc 'SELECT 1' 2>/dev/null | grep -qx 1;then
   ready=true;break
 fi
 sleep 0.5
done
if [[ "$ready" != true ]];then echo "FIXTURE_PG_NOT_READY";docker logs --tail 15 "$PG";exit 2;fi
docker exec "$PG" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres \
 -c 'CREATE DATABASE gpt02_core_preparation_isolated' >/dev/null
awk -v policies="$WORK/source/gpt02-core-preparer-rls-candidate.sql" '
 $0=="-- GPT02_PREPARER_RLS_POLICY_INJECTION_POINT"{
   while((getline line < policies)>0)print line
   close(policies);next
 }
 {print}
' "$WORK/source/gpt02-core-task-preparation-isolated.sql" |
 docker exec -i "$PG" psql -X -v ON_ERROR_STOP=1 -U postgres \
 -d gpt02_core_preparation_isolated -q >"$WORK/init.log" 2>&1 || \
 { echo "FIXTURE_DDL_FAIL";tail -35 "$WORK/init.log";exit 2; }
# Build exactly the previously tested TASK171 wrapper and synthetic Hub PIC audit.
docker exec -i "$PG" psql -X -v ON_ERROR_STOP=1 -U postgres \
 -d gpt02_core_preparation_isolated >/dev/null <<'SQL'
ALTER TABLE public.ai_tasks ADD COLUMN description text, ADD COLUMN source text NOT NULL DEFAULT 'manual';
ALTER FUNCTION gpt02_stage.prepare_core_task(text,integer,text,text,text,text) RENAME TO prepare_core_task_v1_internal;
REVOKE EXECUTE ON FUNCTION gpt02_stage.prepare_core_task_v1_internal(text,integer,text,text,text,text) FROM gpt02_core_prep_login;
INSERT INTO public.ai_tasks (id,company_id,status,title,assigned_to_id,assigned_to,description,source)
 VALUES (171,'default','new_inquiry','GPT02 DEV fresh E2E Task #171',
 5,'Synthetic PIC','DEV E2E verification only for Task #171. Reply exactly GPT02_DEV_E2E_171_ACK. No external writes.','manual');
INSERT INTO public.audit_logs(id,company_id,entity_id,action,after,user_email)
 VALUES(2171,'default','171','gpt02_pic_assigned',
 jsonb_build_object('taskId',171,'companyId','default','memberId',5,'memberName','Synthetic PIC',
 'actorIdentity',jsonb_build_object('id','google_fixture_super_admin','version',1,
 'role','super_admin','email','admin@example.invalid'))::text,
 'admin@example.invalid');
SQL
{
 printf 'BEGIN;\nSET LOCAL ROLE gpt02_core_prep_owner;\n'
 cat "$WORK/source/gpt02-preparer-instruction-bound-wrapper-candidate.sql"
 printf '\nREVOKE ALL ON FUNCTION gpt02_stage.prepare_core_task(text,integer,text,text,text,text) FROM PUBLIC;\n'
 printf 'GRANT EXECUTE ON FUNCTION gpt02_stage.prepare_core_task(text,integer,text,text,text,text) TO gpt02_core_prep_login;\n'
 printf 'COMMIT;\n'
} | docker exec -i "$PG" psql -X -v ON_ERROR_STOP=1 -U postgres \
 -d gpt02_core_preparation_isolated -q >"$WORK/wrapper.log" 2>&1 || \
 { echo "FIXTURE_WRAPPER_FAIL";tail -25 "$WORK/wrapper.log";exit 2; }
EXPIRY=$(date -u -d '+8 minutes' '+%Y-%m-%d %H:%M:%S+00')
docker exec -i "$PG" psql -X -v ON_ERROR_STOP=1 -U postgres \
 -d gpt02_core_preparation_isolated >/dev/null <<SQL
SET password_encryption='scram-sha-256';
GRANT CONNECT ON DATABASE gpt02_core_preparation_isolated TO gpt02_core_prep_login;
ALTER ROLE gpt02_core_prep_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS
 NOCREATEROLE NOCREATEDB NOREPLICATION CONNECTION LIMIT 1
 PASSWORD '$LOGINRANDOM' VALID UNTIL '$EXPIRY';
SQL
cat > "$WORK/smoke.mjs" <<'JS'
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {Gpt02CoreTaskPreparer} from '/app/artifacts/api-server/src/lib/gpt02-core-task-preparation.mjs';
const require=createRequire('/app/artifacts/api-server/package.json');
const {Pool}=require('pg');
const pool=new Pool({host:'pg',port:5432,database:'gpt02_core_preparation_isolated',
 user:'gpt02_core_prep_login',password:process.env.SYNTHETIC_PASSWORD,
 ssl:{ca:readFileSync('/tls/ca.crt','utf8'),rejectUnauthorized:true},
 max:1,connectionTimeoutMillis:5000,statement_timeout:5000});
try{
 const preparer=new Gpt02CoreTaskPreparer({pool});
 const ready=await preparer.verifyReadiness();
 assert.equal(ready.verified,true);
 assert.equal(ready.readOnly,true);
 assert.equal(ready.dispatchPermitted,false);
 console.log('PASS:SCOPED_PREPARER_REAL_TLS_READONLY_READINESS');
 const input={companyId:'default',hubTaskId:171,
 projectName:'GPT02 DEV coding lifecycle',
 repository:'Travelintrips/Core-AI-Foundation',branch:'develop',
 instruction:'DEV E2E verification only for Task #171. Reply exactly GPT02_DEV_E2E_171_ACK. No external writes.'};
 const first=await preparer.prepare(input);
 assert.equal(first.preparedNew,true);
 assert.equal(first.commandIssued,false);
 assert.equal(first.operatorApprovalRecorded,false);
 assert.equal(first.dispatchPermitted,false);
 assert.equal(first.hubExecutionStatus,'prepared');
 console.log('PASS:TASK171_SYNTHETIC_ATOMIC_CORE_HUB_PREPARED_NO_COMMAND');
 const again=await preparer.prepare(input);
 assert.equal(again.preparedNew,false);
 for(const key of ['coreTaskId','commandCandidateId','attemptId','hubExecutionId'])
  assert.equal(first[key],again[key]);
 console.log('PASS:TASK171_IDEMPOTENT_SAME_IDENTITIES');
 await assert.rejects(preparer.prepare({...input,instruction:'MALICIOUS CHANGED INSTRUCTION'}),
   e=>e.code==='CORE_PREPARATION_TRANSACTION_FAILED');
 console.log('PASS:TASK171_INSTRUCTION_TAMPER_REJECTED');
 await assert.rejects(preparer.prepare({...input,hubTaskId:136}),
   e=>e.code==='OUT_OF_SCOPE_PREPARATION');
 console.log('PASS:LEGACY_TASK136_NOT_ADMITTED');
}finally{await pool.end();}
JS
chmod 644 "$WORK/smoke.mjs"
docker run --rm --network "$NET" --read-only --user 1000:1000 --cap-drop ALL \
 --security-opt no-new-privileges --entrypoint node \
 --mount "type=bind,src=$WORK/certs,dst=/tls,readonly" \
 --mount "type=bind,src=$WORK/smoke.mjs,dst=/tmp/gpt02-synthetic-prep.mjs,readonly" \
 "${SOURCE_MOUNT[@]}" \
 -e "SYNTHETIC_PASSWORD=$LOGINRANDOM" \
 "$IMAGE" /tmp/gpt02-synthetic-prep.mjs
COUNTS=$(docker exec "$PG" psql -X -U postgres -d gpt02_core_preparation_isolated -Atc "
SELECT (SELECT count(*) FROM gpt02_stage.core_preparations WHERE hub_task_id=171)::text||':'||
 (SELECT count(*) FROM public.ai_execution_jobs WHERE task_id=171 AND status='prepared'
   AND command_id IS NULL AND worker_id IS NULL AND callback_verified=false
   AND attestation_verified=false AND final_ack_verified=false)::text||':'||
 (SELECT count(*) FROM ai_platform.ai_coding_tasks)::text||':'||
 (SELECT count(*) FROM ai_platform.ai_coding_bridge_commands)::text||':'||
 (SELECT count(*) FROM ai_platform.ai_coding_runs)::text;")
[[ "$COUNTS" == '1:1:1:0:0' ]] || { echo "FAIL:LEDGER_COUNTS_UNEXPECTED_$COUNTS";exit 2; }
echo 'PASS:ONE_CORE_ONE_HUB_ZERO_COMMAND_ZERO_RUN_ZERO_FINAL_ACK'
echo 'ISOLATED_REAL_MODULE_TLS_ATOMIC_TASK171_TEST_PASS_NO_HOSTED_EFFECTS'
