#!/usr/bin/env bash
set -euo pipefail
IMAGE="${GPT02_TEST_IMAGE:-ai-task-hub:dev-pr155-pic-audit-20261109}"
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
docker exec -i -w /app/artifacts/api-server "$API" node <<'JS'
const jwt=require('jsonwebtoken');
const base='http://127.0.0.1:8080/api/ai-tasks/';
const tok=jwt.sign({id:9001,email:'synthetic@example.invalid',role:'super_admin',companyId:'default',name:'Synthetic Administrator'},process.env.SESSION_SECRET,{expiresIn:'10m'});
const headers={Authorization:'Bearer '+tok,'Content-Type':'application/json'};
async function request(task,body={},h=headers){const r=await fetch(base+task+'/execution?companyId=default',{method:'POST',headers:h,body:JSON.stringify(body)});return {code:r.status,body:await r.json()};}
const assert=require('node:assert/strict');
(async()=>{
 let r=await request(1001,{mode:'chatgpt',accountAlias:'GPT02',lifecycleStart:true}, {'Content-Type':'application/json'});
 assert.equal(r.code,401,'unauthenticated start must be blocked');
 const payload={mode:'chatgpt',accountAlias:'GPT02',lifecycleStart:true};
 r=await request(1001,payload);
 assert.equal(r.code,409);assert.equal(r.body.error,'GPT02_LIFECYCLE_PRE_DISPATCH_PROOF_REQUIRED');
 assert.equal(r.body.dispatchNotStarted,true);assert.equal(r.body.continuationScheduled,false);assert.equal(r.body.blockers.length,5);
 r=await request(1001,{...payload,operatorApprovalGranted:true,nonceVerified:true,issuerPermitted:true,coreTaskId:'caller-fabricated',bindingVerified:true,leaseValid:true});
 assert.equal(r.code,409);assert.equal(r.body.error,'GPT02_LIFECYCLE_PRE_DISPATCH_PROOF_REQUIRED');
 r=await request(1001,{mode:'worker',accountAlias:'GPT02',lifecycleStart:true});
 assert.equal(r.code,409);assert.equal(r.body.error,'LIFECYCLE_ASSIGNMENT_OR_MODE_NOT_READY');
 r=await request(1002,payload);
 assert.equal(r.code,404,'cross-company tasks should not be admitted');
 const pic=await fetch(base+'1001/gpt02-assign-pic?companyId=default',{method:'POST',headers,body:JSON.stringify({memberId:201})});
 const body=await pic.json();assert.equal(pic.status,200);assert.equal(body.memberId,201);
 r=await request(1001,payload);assert.equal(r.code,409);
 assert.equal(r.body.error,'GPT02_LIFECYCLE_PRE_DISPATCH_PROOF_REQUIRED');
 console.log('ISOLATED_GPT02_LIFECYCLE_SERVER_DENIAL_PASS_6_CHECKS');
})().catch(e=>{console.error('ISOLATED_LIFECYCLE_DENIAL_FAIL',e.message);process.exitCode=1});
JS
docker exec -i "$PG" psql -X -U test -d testdb -v ON_ERROR_STOP=1 -At <<'SQL'
SELECT 'UNAUTHORIZED_EXECUTIONS='||COUNT(*) FROM ai_execution_jobs WHERE task_id=1001;
SELECT 'UNAUTHORIZED_EXECUTIONS_OTHER_TENANT='||COUNT(*) FROM ai_execution_jobs WHERE task_id=1002;
SELECT 'AUDITED_SYNTHETIC_PIC='||COUNT(*) FROM audit_logs WHERE entity_id='1001' AND action='gpt02_pic_assigned';
SQL
