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
(1007,'default','new_inquiry',201,'Synthetic Active PIC');
ALTER TABLE audit_logs ADD CONSTRAINT reject_test_1006 CHECK (entity_id IS DISTINCT FROM '1006');
INSERT INTO ai_execution_jobs(task_id,company_id) VALUES(1003,'default');
INSERT INTO ai_execution_jobs(task_id,company_id,source,external_id,status,metadata)
 VALUES(1007,'default','AI_TASK','ai-task:default:1007','failed','{"accountAlias":"GPT02"}'::jsonb);
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
const jwt = require("jsonwebtoken");
const secret=process.env.SESSION_SECRET;
const createToken=(role,companyId="default")=>jwt.sign(
 {id:9001,email:"synthetic-admin@example.invalid",name:"Synthetic Tester",role,companyId},secret,{expiresIn:"10m"});
const auth={Authorization:"Bearer "+createToken("super_admin"),"Content-Type":"application/json"};
const staff={Authorization:"Bearer "+createToken("staff"),"Content-Type":"application/json"};
const base="http://127.0.0.1:8080/api/ai-tasks/";
async function req(method,task,route,headers,body,company="default"){
 const res=await fetch(base+task+"/"+route+"?companyId="+company,{method,headers,body:body?JSON.stringify(body):undefined});
 let data={};try{data=await res.json()}catch{};return {status:res.status,data};
}
function assert(x,msg){if(!x)throw Error(msg);}
(async()=>{
 let r=await req("GET",1001,"gpt02-pic-options",{});assert(r.status===401,"missing authentication");
 r=await req("GET",1001,"gpt02-pic-options",staff);assert(r.status===403,"staff cannot view picker");
 r=await req("POST",1001,"gpt02-assign-pic",auth,{memberId:203});assert(r.status===409,"cross tenant member");
 r=await req("POST",1001,"gpt02-assign-pic",auth,{memberId:202});assert(r.status===409,"inactive PIC");
 r=await req("GET",1001,"gpt02-pic-options",auth);assert(r.status===200&&r.data.members.some(m=>m.id===201)&&!r.data.members.some(m=>m.id===203),"scoped options");
 r=await req("POST",1001,"gpt02-assign-pic",auth,{memberId:201});console.log("ASSIGN_HTTP",r.status,JSON.stringify(r.data).slice(0,400));assert(r.status===200 && r.data.memberId===201 && r.data.commandDispatched===false,"actual assignment + audit insert");
 r=await req("GET",1001,"gpt02-pic-audit",auth);assert(r.status===200&&r.data.auditPresent===true&&r.data.auditMatchesCurrent===true&&r.data.actorId===9001&&r.data.nativeAckVerified===false,"actual audit readback");
 r=await req("GET",1001,"gpt02-pic-options",auth);assert(r.status===200&&r.data.assignmentReady===true&&r.data.selectedMemberId===201,"actual task readback");
 r=await req("GET",1001,"gpt02-pic-audit",auth,null,"other");assert(r.status===404,"cross tenant task audit");
 r=await req("POST",1003,"gpt02-assign-pic",auth,{memberId:201});assert(r.status===409,"existing execution blocks assignment");
 r=await req("POST",1004,"gpt02-assign-pic",auth,{memberId:201});assert(r.status===409,"completed task blocked");
 r=await req("POST",1006,"gpt02-assign-pic",auth,{memberId:201});assert(r.status===503,"failing audit must reject assignment");
 r=await req("GET",1006,"gpt02-pic-options",auth);assert(r.status===200&&r.data.assignmentReady===false,"audit error rolls back task update");
 r=await req("POST",1005,"execution",auth,{mode:"chatgpt",accountAlias:"GPT02",instruction:"Synthetic test only - must never dispatch"});assert(r.status===409&&r.data.error==="GPT02_PIC_AUDIT_NOT_VERIFIED"&&r.data.dispatchNotStarted===true,"audit gate blocks unverified GPT02 before ledger");
 r=await req("POST",1007,"execution",auth,{mode:"chatgpt",accountAlias:"GPT02",instruction:"Synthetic test should never dispatch"});
 assert(r.status===409&&r.data.error==="GPT02_EXISTING_ATTEMPT_REQUIRES_AUTHORIZED_RECOVERY"&&r.data.dispatchNotStarted===true,"direct GPT02 retry denied");
 r=await req("POST",1007,"execution",auth,{mode:"chatgpt",accountAlias:"GPT01",instruction:"Synthetic test should never dispatch"});
 assert(r.status===409&&r.data.error==="GPT02_EXISTING_ATTEMPT_REQUIRES_AUTHORIZED_RECOVERY","persisted GPT02 alias cannot be bypassed");
 console.log("ISOLATED_REAL_API_16_OF_16_PASS");
})().catch(err=>{console.error("ISOLATED_REAL_API_FAIL",err.message);process.exitCode=1});
JS
docker exec -i "$PG" psql -U test -d testdb -A -t -v ON_ERROR_STOP=1 <<'SQL'
SELECT 'AUDIT_ROWS='||count(*) FROM audit_logs WHERE action='gpt02_pic_assigned';
SELECT 'ASSIGNED_ID='||assigned_to_id FROM ai_tasks WHERE id=1001;
SELECT 'EXECUTION_ROWS='||count(*) FROM ai_execution_jobs;
SQL
