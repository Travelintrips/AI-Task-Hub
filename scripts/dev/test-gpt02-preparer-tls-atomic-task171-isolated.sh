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
# Network-isolated second phase: validate real prepared Hub/Core evidence
# through two independent, scoped PostgreSQL TLS readers.
COREID=$(docker exec "$PG" psql -X -U postgres -d gpt02_core_preparation_isolated -Atc "SELECT core_task_id FROM gpt02_stage.core_preparations WHERE hub_task_id=171")
CMDID=$(docker exec "$PG" psql -X -U postgres -d gpt02_core_preparation_isolated -Atc "SELECT command_candidate_id FROM gpt02_stage.core_preparations WHERE hub_task_id=171")
ATTEMPTID=$(docker exec "$PG" psql -X -U postgres -d gpt02_core_preparation_isolated -Atc "SELECT attempt_id FROM gpt02_stage.core_preparations WHERE hub_task_id=171")
[[ "$COREID" =~ ^[a-f0-9-]{36}$ && "$CMDID" =~ ^[a-f0-9-]{36}$ && "$ATTEMPTID" =~ ^[a-f0-9-]{36}$ ]] || { echo INVALID_SYNTHETIC_IDS; exit 2; }
HUBPASS=$(openssl rand -hex 24)
COREPASS=$(openssl rand -hex 24)
docker exec -i "$PG" psql -X -v ON_ERROR_STOP=1 -U postgres -d gpt02_core_preparation_isolated >/dev/null <<SQL
ALTER TABLE public.users ADD COLUMN status text NOT NULL DEFAULT 'active';
ALTER TABLE ai_platform.internal_users ADD COLUMN email text NOT NULL DEFAULT 'admin@example.invalid';
CREATE ROLE gpt02_hub_evidence_reader LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS
 NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 1
 PASSWORD '$HUBPASS' VALID UNTIL '$EXPIRY';
CREATE ROLE gpt02_core_evidence_reader LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS
 NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 1
 PASSWORD '$COREPASS' VALID UNTIL '$EXPIRY';
ALTER ROLE gpt02_hub_evidence_reader SET default_transaction_read_only = on;
ALTER ROLE gpt02_core_evidence_reader SET default_transaction_read_only = on;
GRANT CONNECT ON DATABASE gpt02_core_preparation_isolated TO
 gpt02_hub_evidence_reader,gpt02_core_evidence_reader;
GRANT USAGE ON SCHEMA public,gpt02_stage TO gpt02_hub_evidence_reader;
GRANT USAGE ON SCHEMA ai_platform TO gpt02_core_evidence_reader;
GRANT SELECT (company_id,hub_task_id,member_id,member_audit_id,operator_subject,
  core_task_id,hub_execution_id,command_candidate_id,attempt_id,expires_at)
 ON gpt02_stage.core_preparations TO gpt02_hub_evidence_reader;
GRANT SELECT (id,company_id,assigned_to_id,assigned_to,status,title)
 ON public.ai_tasks TO gpt02_hub_evidence_reader;
GRANT SELECT (id,company_id,name,is_active) ON public.team_members TO gpt02_hub_evidence_reader;
GRANT SELECT (id,role,is_active,status,company_id,email) ON public.users TO gpt02_hub_evidence_reader;
GRANT SELECT (id,company_id,entity_id,action,after,user_email)
 ON public.audit_logs TO gpt02_hub_evidence_reader;
GRANT SELECT (id,company_id,task_id,status,command_id,worker_id,assigned_client_id,metadata)
 ON public.ai_execution_jobs TO gpt02_hub_evidence_reader;
GRANT SELECT (id,status) ON ai_platform.ai_coding_tasks TO gpt02_core_evidence_reader;
GRANT SELECT (task_id) ON ai_platform.ai_coding_runs TO gpt02_core_evidence_reader;
GRANT SELECT (task_id) ON ai_platform.ai_coding_bridge_commands TO gpt02_core_evidence_reader;
GRANT SELECT (id,email,role,status,must_change_password)
 ON ai_platform.internal_users TO gpt02_core_evidence_reader;
ALTER TABLE ai_platform.internal_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_test_171_prep ON gpt02_stage.core_preparations
 FOR SELECT TO gpt02_hub_evidence_reader USING (company_id='default' AND hub_task_id=171);
CREATE POLICY p_test_171_task ON public.ai_tasks
 FOR SELECT TO gpt02_hub_evidence_reader USING (company_id='default' AND id=171);
CREATE POLICY p_test_171_team ON public.team_members
 FOR SELECT TO gpt02_hub_evidence_reader USING (company_id='default' AND id=5);
CREATE POLICY p_test_171_user ON public.users
 FOR SELECT TO gpt02_hub_evidence_reader USING (id='google_fixture_super_admin' AND company_id IS NULL);
CREATE POLICY p_test_171_audit ON public.audit_logs
 FOR SELECT TO gpt02_hub_evidence_reader USING (company_id='default' AND entity_id='171' AND id=2171);
CREATE POLICY p_test_171_job ON public.ai_execution_jobs
 FOR SELECT TO gpt02_hub_evidence_reader USING (company_id='default' AND task_id=171);
CREATE POLICY p_test_171_core ON ai_platform.ai_coding_tasks
 FOR SELECT TO gpt02_core_evidence_reader USING (id='$COREID'::uuid);
CREATE POLICY p_test_171_runs ON ai_platform.ai_coding_runs
 FOR SELECT TO gpt02_core_evidence_reader USING (task_id='$COREID'::uuid);
CREATE POLICY p_test_171_commands ON ai_platform.ai_coding_bridge_commands
 FOR SELECT TO gpt02_core_evidence_reader USING (task_id='$COREID'::uuid);
CREATE POLICY p_test_171_core_owner ON ai_platform.internal_users
 FOR SELECT TO gpt02_core_evidence_reader USING (id=77 AND email='admin@example.invalid');
SQL
docker exec "$PG" psql -X -U postgres -d template1 -v ON_ERROR_STOP=1 \
 -c 'ALTER DATABASE postgres RENAME TO gpt02_fixture_bootstrap' >/dev/null
docker exec "$PG" psql -X -U postgres -d template1 -v ON_ERROR_STOP=1 \
 -c 'ALTER DATABASE gpt02_core_preparation_isolated RENAME TO postgres' >/dev/null
cat > "$WORK/presign.mjs" <<'JS'
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createGpt02PreSignFactReader} from '/app/artifacts/api-server/src/lib/gpt02-presign-facts-readonly.mjs';
const require=createRequire('/app/artifacts/api-server/package.json');
const {Pool}=require('pg');
const ssl={ca:readFileSync('/tls/ca.crt','utf8'),rejectUnauthorized:true};
const opts=(user,password)=>({
 host:'pg',port:5432,database:'postgres',user,password,ssl,max:1,
 connectionTimeoutMillis:5000,options:'-c default_transaction_read_only=on'
});
const hubPool=new Pool(opts('gpt02_hub_evidence_reader',process.env.HUB_PASS));
const corePool=new Pool(opts('gpt02_core_evidence_reader',process.env.CORE_PASS));
try{
 const preSign=createGpt02PreSignFactReader({hubPool,corePool});
 const query={companyId:'default',hubTaskId:171,
  commandCandidateId:process.env.SYNTHETIC_CMD,
  attemptId:process.env.SYNTHETIC_ATTEMPT};
 const f=await preSign(query);
 assert.equal(f.prepared.hubTaskId,171);
 assert.equal(f.prepared.coreTaskId,process.env.SYNTHETIC_CORE);
 assert.equal(f.job.taskId,171);
 assert.equal(f.job.status,'prepared');
 assert.equal(f.core.status,'PENDING');
 assert.equal(f.core.commandCount,0);
 assert.equal(f.core.runCount,0);
 assert.equal(f.trustedReadProof.separateBackends,true);
 assert.equal(f.trustedReadProof.clientTlsVerified,true);
 assert.equal(f.trustedReadProof.readOnly,true);
 assert.equal(f.trustedReadProof.dispatchPermitted,false);
 console.log('PASS:REAL_PRESIGN_READER_TWO_INDEPENDENT_SCOPED_TLS_BACKENDS');
 await assert.rejects(preSign({...query,hubTaskId:172}),
   e=>e.code==='PRESIGN_HUB_PREPARATION_NOT_UNIQUE');
 console.log('PASS:OTHER_TASK_PRE_SIGN_DENIED');
 await assert.rejects(preSign({...query,commandCandidateId:'11111111-1111-4111-8111-111111111111'}),
   e=>e.code==='PRESIGN_HUB_PREPARATION_NOT_UNIQUE');
 console.log('PASS:WRONG_COMMAND_PRE_SIGN_DENIED');
 await assert.rejects(preSign({...query,companyId:'other'}),
   e=>e.code==='UNTRUSTED_TASK_IDENTITY');
 console.log('PASS:CROSS_COMPANY_PRE_SIGN_DENIED');
 console.log('SYNTHETIC_PRESIGN_FACTS_B64='+Buffer.from(JSON.stringify(f)).toString('base64'));
}finally{await Promise.all([hubPool.end(),corePool.end()]);}
JS
chmod 644 "$WORK/presign.mjs"
docker run --rm --network "$NET" --read-only --user 1000:1000 --cap-drop ALL \
 --security-opt no-new-privileges --entrypoint node \
 --mount "type=bind,src=$WORK/certs,dst=/tls,readonly" \
 --mount "type=bind,src=$WORK/presign.mjs,dst=/tmp/gpt02-synthetic-presign.mjs,readonly" \
 "${SOURCE_MOUNT[@]}" \
 -e "HUB_PASS=$HUBPASS" -e "CORE_PASS=$COREPASS" \
 -e "SYNTHETIC_CMD=$CMDID" -e "SYNTHETIC_ATTEMPT=$ATTEMPTID" -e "SYNTHETIC_CORE=$COREID" \
 "$IMAGE" /tmp/gpt02-synthetic-presign.mjs >"$WORK/presign.out"
grep '^PASS:' "$WORK/presign.out"
python3 - "$WORK/presign.out" "$WORK/presign-facts.json" <<'PY'
import sys,base64,json
from pathlib import Path
lines=Path(sys.argv[1]).read_text().splitlines()
values=[l.split('=',1)[1] for l in lines if l.startswith('SYNTHETIC_PRESIGN_FACTS_B64=')]
if len(values)!=1:raise RuntimeError('ONE_NATIVE_PRESIGN_PACKET_REQUIRED')
f=json.loads(base64.b64decode(values[0],validate=True))
assert f['trustedReadProof']['dispatchPermitted'] is False
Path(sys.argv[2]).write_text(json.dumps(f,separators=(',',':')))
PY
# Validate native presign facts against the installed approval Python validator
# when running on the authorized VPS. GitHub CI runs the Node/PG checks above.
if [[ -f /opt/ai-coding-standalone-dev/gpt02_issue159_approval_request_refresh.py ]];then
 PYTHONPATH=/opt/ai-coding-standalone-dev python3 - "$WORK/presign-facts.json" "$CMDID" "$ATTEMPTID" <<'PY'
import json,sys,copy,time
from gpt02_issue159_approval_request_refresh import _verify_pre_sign_facts,RefreshDenied
from pathlib import Path
f=json.loads(Path(sys.argv[1]).read_text())
now=f['observedAt']
assert abs(int(time.time()*1000)-now)<12000
claims={'companyId':'default','taskId':171,'commandId':sys.argv[2],
 'attemptId':sys.argv[3],'superAdminId':'google_fixture_super_admin',
 'expiresAt':now+240000}
expiry=_verify_pre_sign_facts(f,claims,now)
assert expiry>claims['expiresAt']+1000
print('PASS:ACTUAL_APPROVAL_PYTHON_VERIFIER_ACCEPTS_NATIVE_PRESIGN_FACTS')
other=copy.deepcopy(f)
other['hubAssignment']['actorId']='wrong-super-admin'
try:_verify_pre_sign_facts(other,claims,now)
except RefreshDenied as e:
 assert e.code=='ISSUE159_PRESIGN_LINEAGE_MISMATCH',e.code
 print('PASS:APPROVAL_PYTHON_DENIES_CHANGED_SUPER_ADMIN_AUDIT')
else:raise RuntimeError('FORGED_HUB_ADMIN_ACCEPTED')
PY
else
 echo SKIP:CORE_AI_APPROVAL_PYTHON_MODULE_NOT_IN_THIS_TEST_RUNNER
fi
echo PASS:SYNTHETIC_PRESIGN_FLOW_ENDED_WITH_NO_SIGNER_OR_DISPATCH
if [[ -f /opt/ai-coding-standalone-dev/prepare_gpt02_issue159_approval_request.py ]] && [[ "$(id -u)" == 0 ]];then
 PYTHONPATH=/opt/ai-coding-standalone-dev python3 - "$WORK" "$WORK/presign-facts.json" "$CMDID" "$ATTEMPTID" <<'PY'
import json,sys,sqlite3,os
from pathlib import Path
from unittest.mock import patch
import prepare_gpt02_issue159_approval_request as p
import gpt02_issue159_approval_request_refresh as r
root=Path(sys.argv[1])
facts=json.loads(Path(sys.argv[2]).read_text())
command,attempt=sys.argv[3],sys.argv[4]
db=root/'synthetic-approval.sqlite'
out=root/'synthetic-pending.json'
con=sqlite3.connect(str(db))
con.executescript("""
 CREATE TABLE admin_identities(user_id TEXT PRIMARY KEY,role TEXT NOT NULL,enabled INTEGER NOT NULL);
 CREATE TABLE gpt02_issue159_admin_operator_links(
  auth_user_id TEXT PRIMARY KEY,hub_operator_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,enabled INTEGER NOT NULL);
 CREATE TABLE gpt02_issue159_approval_intents(
  task_id INTEGER,command_id TEXT,attempt_id TEXT);
 INSERT INTO admin_identities VALUES('synthetic-auth-user','super_admin',1);
 INSERT INTO gpt02_issue159_admin_operator_links VALUES(
  'synthetic-auth-user','google_fixture_super_admin','admin@example.invalid',1);
""")
con.commit();con.close()
os.chmod(db,0o600)
def native_facts(query):
 assert query=={'companyId':'default','hubTaskId':171,
   'commandCandidateId':command,'attemptId':attempt}
 return facts
with patch.object(p,'LIVE_DB',str(db)), \
     patch.object(p,'LIVE_OUTPUT',str(out)), \
     patch.object(r,'_socket_fact_reader',native_facts):
 result=p.prepare(str(db),str(out),171,command,attempt,
   now_ms=facts['observedAt'],operational=True)
 assert result['pendingRequestCreated'] is True
 assert result['signingPermitted'] is False
 assert result['authorizationGranted'] is False
 assert result['dispatchPermitted'] is False
 assert out.is_file() and (out.stat().st_mode&0o777)==0o600
 claims=json.loads(out.read_text())['claims']
 assert claims['taskId']==171 and claims['commandId']==command
 assert claims['attemptId']==attempt
 assert claims['superAdminId']=='google_fixture_super_admin'
 print('PASS:EXISTING_APPROVAL_CREATOR_PUBLISHES_ONE_SYNTHETIC_PENDING_PACKET')
 try:
  p.prepare(str(db),str(out),171,command,attempt,
    now_ms=facts['observedAt'],operational=True)
 except RuntimeError as e:
  assert str(e)=='ISSUE159_PENDING_REQUEST_ALREADY_EXISTS',str(e)
  print('PASS:APPROVAL_CREATOR_REJECTS_DUPLICATE_PENDING_PACKET')
 else:raise RuntimeError('DUPLICATE_PENDING_PUBLISHED')
 out.unlink()
 changed=json.loads(json.dumps(facts))
 changed['core']['commandCount']=1
 with patch.object(r,'_socket_fact_reader',lambda _:changed):
  try:
   p.prepare(str(db),str(out),171,command,attempt,
    now_ms=facts['observedAt'],operational=True)
  except RuntimeError as e:
   assert str(e)=='ISSUE159_FRESH_TRUSTED_PRESIGN_REQUIRED',str(e)
   print('PASS:APPROVAL_CREATOR_DENIES_UNTRUSTED_CORE_COMMAND_DRIFT')
  else:raise RuntimeError('CHANGED_CORE_PROOF_CREATED_PACKET')
 assert not out.exists()
 with sqlite3.connect('file:'+str(db)+'?mode=ro',uri=True) as c:
  assert c.execute('select count(*) from gpt02_issue159_approval_intents').fetchone()[0]==0
 print('PASS:DISPOSABLE_APPROVAL_LEDGER_REMAINS_EMPTY')
PY
else
 echo SKIP:PYTHON_APPROVAL_CREATOR_NOT_AVAILABLE_OR_NOT_ROOT
fi

echo 'ISOLATED_REAL_MODULE_TLS_ATOMIC_TASK171_TEST_PASS_NO_HOSTED_EFFECTS'
