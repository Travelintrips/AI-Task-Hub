#!/usr/bin/env bash
set -euo pipefail
IMAGE="${GPT02_TEST_IMAGE:-ai-task-hub:dev-prepared-reservation-hold-test-20261110}"
SUFFIX="$$"
NET="gpt02-pic-e2e-net-$SUFFIX"
PG="gpt02-pic-e2e-pg-$SUFFIX"
API="gpt02-pic-e2e-api-$SUFFIX"
cleanup() { local code=$?; if [ "$code" -ne 0 ]; then sleep 2; echo "API_ERROR_LOG"; docker logs --tail 65 "$API" 2>&1 | tail -n 50 || true; echo "PG_ERROR_LOG"; docker logs --tail 30 "$PG" 2>&1 | tail -n 20 || true; fi; docker rm -f "$API" "$PG" >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker image inspect "$IMAGE" >/dev/null
docker network create --internal "$NET" >/dev/null
docker run -d --network "$NET" --name "$PG" --network-alias pg -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=testdb postgres:16-alpine >/dev/null
for n in $(seq 1 25); do
 if docker exec "$PG" pg_isready -U test -d testdb >/dev/null 2>&1; then break; fi
 sleep .5
done
for n in $(seq 1 15); do
 if docker exec -i "$PG" psql -U test -d testdb -v ON_ERROR_STOP=1 -c "SELECT 1" >/dev/null 2>&1; then break; fi
 sleep .4
done
docker exec -i "$PG" psql -U test -d testdb -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
CREATE TABLE ai_tasks(
 id integer PRIMARY KEY, company_id text NOT NULL, status text NOT NULL DEFAULT 'new_inquiry',
 assigned_to_id integer, assigned_to text, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE team_members(
 id integer PRIMARY KEY,company_id text NOT NULL,name text NOT NULL,is_active boolean NOT NULL DEFAULT true
);
CREATE TABLE ai_execution_jobs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id integer,company_id text NOT NULL
);
CREATE TABLE audit_logs(
 id serial PRIMARY KEY,company_id text DEFAULT 'default',
 user_id integer,user_email text,user_name text,action text NOT NULL,
 module text,entity_type text,entity_id text,
 before text,after text,ip_address text,user_agent text,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ai_tasks ADD COLUMN task_number text;
ALTER TABLE ai_tasks ADD COLUMN source text;
ALTER TABLE ai_tasks ADD COLUMN customer_id integer;
ALTER TABLE ai_tasks ADD COLUMN customer_name text;
ALTER TABLE ai_tasks ADD COLUMN customer_phone text;
ALTER TABLE ai_tasks ADD COLUMN title text;
ALTER TABLE ai_tasks ADD COLUMN description text;
ALTER TABLE ai_tasks ADD COLUMN category text;
ALTER TABLE ai_tasks ADD COLUMN division text;
ALTER TABLE ai_tasks ADD COLUMN priority text;
ALTER TABLE ai_tasks ADD COLUMN assigned_role text;
ALTER TABLE ai_tasks ADD COLUMN assigned_division text;
ALTER TABLE ai_tasks ADD COLUMN assigned_vendor text;
ALTER TABLE ai_tasks ADD COLUMN driver_name text;
ALTER TABLE ai_tasks ADD COLUMN driver_phone text;
ALTER TABLE ai_tasks ADD COLUMN plate_number text;
ALTER TABLE ai_tasks ADD COLUMN quotation_amount text;
ALTER TABLE ai_tasks ADD COLUMN quotation_notes text;
ALTER TABLE ai_tasks ADD COLUMN due_date timestamptz;
ALTER TABLE ai_tasks ADD COLUMN sla_hours integer;
ALTER TABLE ai_tasks ADD COLUMN overdue_at timestamptz;
ALTER TABLE ai_tasks ADD COLUMN completed_at timestamptz;
ALTER TABLE ai_tasks ADD COLUMN sla_status text;
ALTER TABLE ai_tasks ADD COLUMN last_customer_reply_at timestamptz;
ALTER TABLE ai_tasks ADD COLUMN follow_up_count integer;
ALTER TABLE ai_tasks ADD COLUMN ai_summary text;
ALTER TABLE ai_tasks ADD COLUMN ai_intent text;
ALTER TABLE ai_tasks ADD COLUMN missing_data text;
ALTER TABLE ai_tasks ADD COLUMN required_action text;
ALTER TABLE ai_tasks ADD COLUMN admin_notes text;
ALTER TABLE ai_tasks ADD COLUMN ai_confidence_score text;
ALTER TABLE ai_tasks ADD COLUMN customer_sentiment text;
ALTER TABLE ai_tasks ADD COLUMN created_at timestamptz;
ALTER TABLE ai_execution_jobs ADD COLUMN source text;
ALTER TABLE ai_execution_jobs ADD COLUMN external_id text;
ALTER TABLE ai_execution_jobs ADD COLUMN idempotency_key text;
ALTER TABLE ai_execution_jobs ADD COLUMN title text;
ALTER TABLE ai_execution_jobs ADD COLUMN instruction text;
ALTER TABLE ai_execution_jobs ADD COLUMN session_id text;
ALTER TABLE ai_execution_jobs ADD COLUMN correlation_id uuid;
ALTER TABLE ai_execution_jobs ADD COLUMN command_id uuid;
ALTER TABLE ai_execution_jobs ADD COLUMN assigned_client_id text;
ALTER TABLE ai_execution_jobs ADD COLUMN worker_id text;
ALTER TABLE ai_execution_jobs ADD COLUMN worker_type text;
ALTER TABLE ai_execution_jobs ADD COLUMN status text;
ALTER TABLE ai_execution_jobs ADD COLUMN progress integer;
ALTER TABLE ai_execution_jobs ADD COLUMN result_summary text;
ALTER TABLE ai_execution_jobs ADD COLUMN error_message text;
ALTER TABLE ai_execution_jobs ADD COLUMN callback_verified boolean;
ALTER TABLE ai_execution_jobs ADD COLUMN attestation_verified boolean;
ALTER TABLE ai_execution_jobs ADD COLUMN final_ack_verified boolean;
ALTER TABLE ai_execution_jobs ADD COLUMN metadata jsonb;
ALTER TABLE ai_execution_jobs ADD COLUMN started_at timestamptz;
ALTER TABLE ai_execution_jobs ADD COLUMN completed_at timestamptz;
ALTER TABLE ai_execution_jobs ADD COLUMN created_at timestamptz;
ALTER TABLE ai_execution_jobs ADD COLUMN updated_at timestamptz;
-- The detail-page GET always loads event records: model the hosted read table.
CREATE TABLE ai_execution_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),execution_id uuid NOT NULL,
 task_id integer,company_id text NOT NULL DEFAULT 'default',event_id text NOT NULL,
 event_type text NOT NULL,phase text,status text,message text,worker_id text,
 signature_verified boolean NOT NULL DEFAULT false,payload jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE SCHEMA ai_platform;
CREATE TABLE ai_platform.ai_coding_bridge_commands (id uuid PRIMARY KEY, task_id text, status text);
INSERT INTO ai_platform.ai_coding_bridge_commands VALUES ('83db99f5-cbda-4e60-be71-3090fb411bbb',NULL,'FAILED');
INSERT INTO team_members VALUES
(201,'default','Synthetic Active PIC',true),
(202,'default','Synthetic Inactive PIC',false),
(203,'other','Other Tenant PIC',true);
INSERT INTO ai_tasks VALUES
(1001,'default','new_inquiry',null,null),
(1002,'other','new_inquiry',null,null),
(1003,'default','new_inquiry',null,null),
(1004,'default','completed',null,null),
(1005,'default','new_inquiry',201,'Synthetic Active PIC'),
(1006,'default','new_inquiry',null,null),
(1007,'default','new_inquiry',201,'Synthetic Active PIC'),
(1008,'default','new_inquiry',null,null);
ALTER TABLE audit_logs ADD CONSTRAINT reject_test_1006 CHECK (entity_id IS DISTINCT FROM '1006');
INSERT INTO ai_tasks(id,company_id,status,category,task_number,title)
 VALUES(1010,'default','new_inquiry','ai_chat','DEV-SYNTH-1010','Synthetic one-shot category check');
INSERT INTO ai_execution_jobs(task_id,company_id) VALUES(1003,'default');
INSERT INTO ai_execution_jobs(task_id,company_id,source,external_id,status,metadata)
 VALUES(1007,'default','AI_TASK','ai-task:default:1007','failed','{"accountAlias":"GPT02"}'::jsonb);
INSERT INTO ai_execution_jobs(task_id,company_id,source,command_id,status)
 VALUES(1008,'default','AI_TASK','83db99f5-cbda-4e60-be71-3090fb411bbb','failed');
SQL
docker run -d --network "$NET" --name "$API" \
 -e NODE_ENV=development -e APP_ENV=development -e PORT=8080 \
 -e RUN_STARTUP_MIGRATIONS=false -e DB_SSL=false \
 -e SESSION_SECRET=synthetic-jwt-secret-only-for-isolated-runtime-test \
 -e AI_TASK_BRIDGE_TOKEN=synthetic-bridge-token-for-isolated-tests-only-abcdef \
 -e SUPABASE_DATABASE_URL_DEV=postgresql://test:test@pg:5432/testdb \
 "$IMAGE" >/dev/null
for n in $(seq 1 25); do
 if docker exec "$API" node -e "fetch('http://127.0.0.1:8080/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then break; fi
 sleep .4
done
docker exec -i "$PG" psql -X -U test -d testdb -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO ai_execution_jobs(task_id,company_id,source,external_id,idempotency_key,title,
 instruction,status,command_id,worker_id,metadata)
VALUES(1005,'default','AI_TASK','ai-task:default:1005','ai-task:default:1005:prepared-v1',
 'Synthetic GPT02 pending reservation','PREPARE ONLY, DO NOT SEND','prepared',NULL,NULL,
 '{"accountAlias":"GPT02","dispatchState":"prepared_no_authority","autoContinue":false}');
SQL

docker exec -i -w /app/artifacts/api-server "$API" node <<'JS'
const jwt=require('jsonwebtoken');const assert=require('node:assert/strict');
const token=jwt.sign({id:9001,email:'synthetic-admin@example.invalid',name:'Synthetic Super Admin',role:'super_admin',companyId:'default'},process.env.SESSION_SECRET,{expiresIn:'10m'});
const auth={Authorization:'Bearer '+token,'Content-Type':'application/json'};
const base='http://127.0.0.1:8080/api/ai-tasks/';
async function post(id,body,h=auth,company='default'){
 const r=await fetch(base+id+'/execution?companyId='+company,{method:'POST',headers:h,body:JSON.stringify(body),signal:AbortSignal.timeout(6000)});
 return {http:r.status,result:await r.json().catch(()=>({}))};
}
async function get(id,h=auth,company='default'){
 const r=await fetch(base+id+'/execution?companyId='+company,{method:'GET',headers:h,signal:AbortSignal.timeout(6000)});
 return {http:r.status,result:await r.json().catch(()=>({}))};
}
const g={instruction:'SHOULD NOT SEND',mode:'chatgpt',accountAlias:'GPT02',lifecycleStart:false};
(async()=>{
 let r=await post(1005,g,{'Content-Type':'application/json'});
 assert.equal(r.http,401);
 r=await post(1005,g);assert.equal(r.http,409);
 assert.equal(r.result.error,'GPT02_PREPARED_HUB_CORE_REQUIRES_AUTHORIZED_ISSUER');
 assert.equal(r.result.dispatchNotStarted,true);assert.equal(r.result.continuationScheduled,false);
 r=await post(1005,{...g,mode:'worker'});assert.equal(r.http,409);
 assert.equal(r.result.error,'GPT02_PREPARED_HUB_CORE_REQUIRES_AUTHORIZED_ISSUER');
 r=await post(1005,{...g,accountAlias:'GPT01'});assert.equal(r.http,409);
 assert.equal(r.result.error,'GPT02_PREPARED_HUB_CORE_REQUIRES_AUTHORIZED_ISSUER');
 r=await post(1005,{...g,accountAlias:'GPT02',lifecycleStart:true});assert.equal(r.http,409);
 assert.equal(r.result.error,'GPT02_LIFECYCLE_PRE_DISPATCH_PROOF_REQUIRED');
 r=await post(1005,{...g,dispatchPermitted:true,nonceConsumed:true,issuerPermitted:true});
 assert.equal(r.http,409);assert.equal(r.result.error,'GPT02_PREPARED_HUB_CORE_REQUIRES_AUTHORIZED_ISSUER');
 r=await post(1002,g,auth,'default');assert.equal(r.http,404);
 // Repeated dashboard reads must not start an in-flight execution sync or
 // change a dormant, unauthorized Hub/Core pre-dispatch reservation.
 for(let i=0;i<3;i++){
  r=await get(1005);assert.equal(r.http,200);
  assert.equal(r.result.execution?.status,'prepared');
  assert.equal(r.result.execution?.commandId,null);
  assert.equal(r.result.execution?.workerId,null);
  assert.equal(r.result.execution?.metadata?.autoContinue,false);
 }
 r=await get(1002,auth,'default');assert.equal(r.http,200);
 assert.equal(r.result.execution,null);
 console.log('ISOLATED_REAL_PREPARED_HUB_CORE_API_DENIAL_PASS 7 POST + 4 READ, NO DISPATCH');
})().catch(e=>{console.error('ISOLATED_PREPARED_HOLD_FAILED',e.message);process.exitCode=1});
JS

# A prepared row must remain unchanged even after the previous GET's
# asynchronous 1-second tracking window; no Core request should be scheduled.
sleep 2
docker exec -i "$PG" psql -X -U test -d testdb -v ON_ERROR_STOP=1 -At <<'SQL'
SELECT 'UNTOUCHED_PREPARED='||count(*) FROM ai_execution_jobs WHERE task_id=1005 AND status='prepared' AND command_id IS NULL AND worker_id IS NULL AND metadata->>'dispatchState'='prepared_no_authority';
SELECT 'SINGLE_RESERVATION='||count(*) FROM ai_execution_jobs WHERE task_id=1005;
SELECT 'ZERO_EVENTS='||count(*) FROM ai_execution_events WHERE task_id=1005;
SELECT 'NO_COMMAND_OR_WORKER='||count(*) FROM ai_execution_jobs WHERE task_id=1005 AND command_id IS NULL AND worker_id IS NULL AND status='prepared';
SQL
