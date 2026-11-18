
#!/usr/bin/env python3
"""Disposable CST AI Team DEV canary E2E. Never uses PROD or real user secrets."""
import base64
import hashlib
import hmac
import json
import os
import secrets
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LOG = Path("/tmp/cst-ai-team-canary-runtime-20261118.log")
EVIDENCE = Path("/tmp/cst-ai-team-canary-evidence-20261118.json")
SQL = """
CREATE TABLE ai_tasks (id integer PRIMARY KEY, company_id text NOT NULL);
INSERT INTO ai_tasks(id,company_id) VALUES (178,'1'),(181,'1'),(179,'3');
CREATE TABLE ai_execution_jobs (
 id uuid PRIMARY KEY, company_id text NOT NULL DEFAULT 'default',
 task_id integer, source text NOT NULL, external_id text NOT NULL UNIQUE,
 idempotency_key text NOT NULL UNIQUE, title text NOT NULL,
 instruction text, session_id text, correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
 command_id uuid, assigned_client_id text, worker_id text, worker_type text,
 status text NOT NULL DEFAULT 'queued', progress integer NOT NULL DEFAULT 0,
 result_summary text, error_message text, callback_verified boolean NOT NULL DEFAULT false,
 attestation_verified boolean NOT NULL DEFAULT false, final_ack_verified boolean NOT NULL DEFAULT false,
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb, started_at timestamptz,
 completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ai_execution_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), execution_id uuid NOT NULL,
 task_id integer, company_id text NOT NULL DEFAULT 'default',
 event_id text NOT NULL UNIQUE, event_type text NOT NULL,
 phase text, status text, message text, worker_id text,
 signature_verified boolean NOT NULL DEFAULT false,
 payload jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
-- Existing Core capacity tables are fixtures in temporary PG16 ONLY.
CREATE SCHEMA ai_platform;
CREATE TABLE ai_platform.ai_workers (
 worker_type text NOT NULL, status text NOT NULL, lease_expires_at timestamptz,
 provider_slug text, runtime_kind text, endpoint_url text,
 capabilities jsonb NOT NULL DEFAULT '[]'::jsonb, running_jobs integer NOT NULL DEFAULT 0
);
CREATE TABLE ai_platform.ai_coding_workstream_ai_handoffs (
 id uuid PRIMARY KEY
);
INSERT INTO ai_platform.ai_workers(worker_type,status,lease_expires_at) VALUES
 ('coding_worker','offline',NULL),
 ('coding_worker','offline',NULL),
 ('coding_worker','offline',NULL),
 ('coding_worker','offline',NULL);
-- A failed Company-1 worker task must remain failed in the monitor.
INSERT INTO ai_execution_jobs
(id, company_id, task_id, source, external_id, idempotency_key, title,
 assigned_client_id, status, error_message)
VALUES
('00000000-0000-4000-8000-000000000178', '1', 178, 'AI_TASK',
 'ai-task:1:178', 'test:task:178',
 '[INTERNAL-E2E] bounded worker ping', 'openclaw-pc-worker-dev',
 'failed', 'AI_CORE_COMMAND_HTTP_403');
-- Callback-verified bounded worker is not automatically signed or final-ACK verified.
INSERT INTO ai_execution_jobs
(id, company_id, task_id, source, external_id, idempotency_key, title,
 assigned_client_id, worker_id, command_id, status, progress, result_summary,
 callback_verified, attestation_verified, final_ack_verified)
VALUES
('00000000-0000-4000-8000-000000000181', '1', 181, 'AI_TASK',
 'ai-task:1:181', 'test:task:181',
 '[INTERNAL-E2E] bounded worker success without signed Final ACK',
 'openclaw-pc-worker-dev', 'openclaw-pc-worker-dev',
 'f3371023-1b15-4907-abaf-deff8b0a01ff',
 'completed', 100, 'pong from synthetic DEV worker',
 true, false, false);
-- A forged Company-1 job whose parent belongs to Company 3 must never appear.
INSERT INTO ai_execution_jobs
(id, company_id, task_id, source, external_id, idempotency_key, title,
 assigned_client_id, worker_id, command_id, status, progress,
 callback_verified, attestation_verified, final_ack_verified)
VALUES
('00000000-0000-4000-8000-000000000182', '1', 179, 'AI_TASK',
 'ai-task:1:179', 'test:task:182',
 '[INTERNAL-E2E] forged cross-company parent must not display',
 'openclaw-pc-worker-dev', 'openclaw-pc-worker-dev',
 'f3371023-1b15-4907-abaf-deff8b0a0182', 'completed',100, true,true,true);
-- A job without an actual parent task must never appear.
INSERT INTO ai_execution_jobs
(id, company_id, task_id, source, external_id, idempotency_key, title,
 assigned_client_id, worker_id, command_id, status, progress,
 callback_verified, attestation_verified, final_ack_verified)
VALUES
('00000000-0000-4000-8000-000000000183', '1', 999, 'AI_TASK',
 'ai-task:1:999', 'test:task:183',
 '[INTERNAL-E2E] orphan parent cannot grant callback authority',
 'openclaw-pc-worker-dev', 'openclaw-pc-worker-dev',
 'f3371023-1b15-4907-abaf-deff8b0a0183', 'completed',100, true,true,true);
-- Same title format in Company 3 must never appear or promote Company 1.
INSERT INTO ai_execution_jobs
(id, company_id, task_id, source, external_id, idempotency_key, title,
 assigned_client_id, worker_id, status, callback_verified, attestation_verified, final_ack_verified)
VALUES
('00000000-0000-4000-8000-000000000179', '3', 179, 'AI_TASK',
 'ai-task:3:179', 'test:task:179',
 '[INTERNAL-E2E] other tenant synthetic success',
 'openclaw-pc-worker-dev', 'openclaw-pc-worker-dev',
 'completed', true, true, true);
"""
def free_port():
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return port

def http(port, method="GET", path="/api/healthz", jwt=None, data=None):
    body = json.dumps(data).encode() if data is not None else None
    headers = {"Content-Type":"application/json"}
    if jwt: headers["Authorization"] = "Bearer " + jwt
    req = urllib.request.Request("http://127.0.0.1:" + str(port) + path,
                                 data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            raw = response.read(120000)
            return response.status, json.loads(raw) if raw.startswith((b"{", b"[")) else {}
    except urllib.error.HTTPError as error:
        raw = error.read(120000)
        return error.code, json.loads(raw) if raw.startswith((b"{", b"[")) else {}

def make_jwt(secret, role="super_admin"):
    hdr = {"alg":"HS256","typ":"JWT"}
    payload = {"id":123456, "name":"Synthetic CST DEV Canary",
               "companyId":"1", "email":"synthetic-canary@invalid.example",
               "role":role, "exp":int(time.time())+300}
    enc = lambda o: base64.urlsafe_b64encode(json.dumps(o,separators=(",",":")).encode()).rstrip(b"=").decode()
    part = enc(hdr) + "." + enc(payload)
    sig = base64.urlsafe_b64encode(hmac.new(secret.encode(),part.encode(),hashlib.sha256).digest()).rstrip(b"=").decode()
    return part + "." + sig

def command(*args, input=None, timeout=15):
    result = subprocess.run(args, input=input, text=True, check=False,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    if result.returncode:
        raise RuntimeError("TOOL_FAILED_" + args[0] + ": " + result.stderr[-500:].replace("\n", " "))
    return result

def main():
    pg_name = "cst-ai-canary-" + secrets.token_hex(4)
    pg_port, api_port = free_port(), free_port()
    password = secrets.token_hex(18)
    jwt_secret = secrets.token_hex(28)
    spawned = None
    created = False
    logfile = None
    proof = {"mode":"synthetic_isolated_postgres16_and_local_node",
             "nodeEnv":"development", "noProd":True,
             "postgresTemporary":True, "credentialsSynthetic":True,
             "start":time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    try:
        command("docker","run","-d","--rm","--name",pg_name,
                "--memory=384m","--cpus=1",
                "-e","POSTGRES_USER=canary","-e","POSTGRES_PASSWORD="+password,
                "-e","POSTGRES_DB=cst_team_canary",
                "-p","127.0.0.1:"+str(pg_port)+":5432",
                "postgres:16-alpine",timeout=30)
        created = True
        for _ in range(40):
            ready = subprocess.run(["docker","exec",pg_name,"pg_isready","-h","127.0.0.1","-U","canary","-d","cst_team_canary"],
                                   stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            if ready.returncode == 0: break
            time.sleep(0.3)
        else: raise RuntimeError("PG_NOT_READY")
        command("docker","exec","-i",pg_name,"psql","-v","ON_ERROR_STOP=1","-U","canary","-d","cst_team_canary",input=SQL)
        e = os.environ.copy()
        e.update({
          "NODE_ENV":"development","APP_ENV":"development",
          "CST_AI_TEAM_DEV_ENABLED":"true",
          "CST_AI_TEAM_EXTERNAL_EVIDENCE_ENABLED":"true",
          "PORT":str(api_port),"HOST":"127.0.0.1",
          "SESSION_SECRET":jwt_secret,
          "SUPABASE_DATABASE_URL_DEV":"postgresql://canary:"+password+"@127.0.0.1:"+str(pg_port)+"/cst_team_canary",
          "DB_SSL":"false","DB_POOL_MAX":"2",
          "DISABLE_BACKGROUND_SCHEDULERS":"true",
          "RUN_STARTUP_MIGRATIONS":"false",
          "AI_CORE_JOB_WA_ENABLED":"false",
          "AI_TASK_BRIDGE_TOKEN":"",
          "GCP_SECRET_MANAGER_BOOTSTRAP_JSON":"",
        })
        os.umask(0o077)
        logfile = LOG.open("w")
        spawned = subprocess.Popen(["node","artifacts/api-server/dist/index.mjs"],cwd=ROOT,env=e,
                                   stdout=logfile,stderr=subprocess.STDOUT,start_new_session=True)
        for _ in range(80):
            if spawned.poll() is not None: raise RuntimeError("API_EXITED_"+str(spawned.returncode))
            try:
                status,body = http(api_port)
                if status == 200 and body.get("status") == "ok": break
            except (OSError,ValueError):
                pass
            time.sleep(0.3)
        else: raise RuntimeError("API_NOT_READY")
        proof["health"] = "HTTP_200_OK"
        noauth, _ = http(api_port,path="/api/cst-ai-team/monitor?companyId=1")
        staff, _ = http(api_port,path="/api/cst-ai-team/monitor?companyId=1",jwt=make_jwt(jwt_secret,"staff"))
        wrong, _ = http(api_port,path="/api/cst-ai-team/monitor?companyId=3",jwt=make_jwt(jwt_secret))
        proof["authGuards"] = {"anonymous":noauth,"staff":staff,"wrongCompany":wrong}
        if (noauth,staff,wrong)!=(401,403,403): raise AssertionError("AUTH_GUARD_FAILED")
        accepted, job = http(api_port,"POST","/api/cst-ai-team/runs?companyId=1",
                              make_jwt(jwt_secret), {"scenario":"dev_read_only_canary"})
        proof["postHttp"] = accepted
        if accepted != 202: raise AssertionError("CANARY_NOT_ACCEPTED_"+str(job))
        jobid = job.get("id")
        proof["runId"] = jobid
        for _ in range(45):
            status,data = http(api_port,path="/api/cst-ai-team/monitor?companyId=1",jwt=make_jwt(jwt_secret))
            run = next((x for x in data.get("runs",[]) if x["id"] == jobid),None)
            if status==200 and run and run.get("status") in ("completed","failed"):
                proof["monitorHttp"]=status
                proof["readinessStatus"]=data.get("agentReadiness",{}).get("status")
                proof["readinessReason"]=data.get("agentReadiness",{}).get("reason")
                if data.get("canRunCanary") is not True: raise AssertionError("CANARY_DEV_FLAG_NOT_ON")
                binding = data.get("operationalTaskBinding", {})
                proof["operationalTaskBindingVerified"] = binding.get("verified")
                if (binding.get("verified"),binding.get("workerCallbackVerified"),
                    binding.get("taskId"),binding.get("independentFinalAckVerified"),
                    binding.get("reason")) != (
                      False, True, 181, False,
                      "WORKER_CALLBACK_VERIFIED_SIGNED_E2E_NOT_ESTABLISHED"):
                    raise AssertionError("WORKER_CALLBACK_LINEAGE_NOT_SEPARATED_FROM_SIGNED_E2E")
                proof["company1WorkerCallbackBinding"]={"taskId":181,
                    "callbackVerified":True,"verifiedSignedE2E":False,
                    "independentFinalAckVerified":False}
                capacity = data.get("independentTeamGate", {})
                proof["independentTeamCapacity"] = {
                    key: capacity.get(key) for key in
                    ("status", "registeredCodingWorkers", "activeLeasedCodingWorkers",
                     "recordedAiHandoffs", "availableOllamaCodingSlots", "verifiedIndependentTeam", "blockers")
                }
                if (capacity.get("status"), capacity.get("registeredCodingWorkers"),
                    capacity.get("activeLeasedCodingWorkers"), capacity.get("recordedAiHandoffs")) != ("blocked",4,0,0):
                    raise AssertionError("CORE_CAPACITY_NOT_PROJECTED")
                if capacity.get("availableOllamaCodingSlots") != 0 or capacity.get("verifiedIndependentTeam") is not False or len(capacity.get("blockers", [])) != 4:
                    raise AssertionError("FALSE_FOUR_AGENT_FINAL_ACK")
                probes = data.get("operationalProbes", [])
                if len(probes) != 2 or {p.get("taskId") for p in probes} != {178,181}:
                    raise AssertionError("WORKER_PROBE_TENANT_SCOPE_MISMATCH")
                failed = next(p for p in probes if p.get("taskId") == 178)
                completed = next(p for p in probes if p.get("taskId") == 181)
                if failed.get("status") != "failed" or any(failed.get(k) is not False for k in ("callbackVerified", "attestationVerified", "finalAckVerified")):
                    raise AssertionError("FAILED_WORKER_FALSE_PASS")
                if (completed.get("status"),completed.get("progress"),completed.get("callbackVerified")) != ("completed",100,True):
                    raise AssertionError("WORKER_COMPLETION_NOT_PROJECTED")
                if completed.get("attestationVerified") is not False or completed.get("finalAckVerified") is not False or not completed.get("commandId"):
                    raise AssertionError("UNSIGNED_WORKER_WRONGLY_FINAL_ACKED")
                proof["operationalProbeScope"] = "COMPANY_1_FAILED_AND_CALLBACK_ONLY"
                if (proof["readinessStatus"],proof["readinessReason"]) != ("unavailable","BRIDGE_NOT_CONFIGURED"):
                    raise AssertionError("READINESS_NOT_FAIL_CLOSED")
                proof["runStatus"]=run.get("status")
                proof["verifiedComplete"]=run.get("verifiedComplete")
                proof["roles"]=[{"role":x["role"],"status":x["status"],"ok":(x.get("evidence") or {}).get("ok")}
                                for x in run.get("steps",[]) if x.get("status")!="started"]
                proof["callbackVerified"]=run.get("callbackVerified")
                proof["attestationVerified"]=run.get("attestationVerified")
                proof["finalAckVerified"]=run.get("finalAckVerified")
                break
            time.sleep(0.3)
        else: raise RuntimeError("CANARY_NOT_COMPLETED")
        if proof["runStatus"]!="completed" or not proof["verifiedComplete"]:
            raise AssertionError("RUN_EVIDENCE_NOT_PASS")
        if len(proof["roles"])!=4 or {x["role"] for x in proof["roles"]}!={"coding","infrastructure","security","qa"}:
            raise AssertionError("NOT_FOUR_DISTINCT_ROLE_EVENTS")
        if not all(x["status"]=="completed" and x["ok"] is True for x in proof["roles"]):
            raise AssertionError("ROLE_EVIDENCE_INCOMPLETE")
        if any(proof[k] for k in ("callbackVerified","attestationVerified","finalAckVerified")):
            raise AssertionError("UNAUTHORIZED_ACK_FLAGS")
        # Adversarial regression on disposable PostgreSQL only: a completed job
        # must lose its diagnostic PASS when the terminal evidence is tampered.
        command("docker", "exec", pg_name, "psql", "-v", "ON_ERROR_STOP=1", "-U", "canary",
                "-d", "cst_team_canary", "-c", """
                  UPDATE ai_execution_events SET worker_id='forged-external-agent'
                  WHERE execution_id='%s'::uuid AND phase='qa' AND event_type='team.completed'
                """ % jobid)
        tampered_status, tampered = http(api_port, path="/api/cst-ai-team/monitor?companyId=1",
                                        jwt=make_jwt(jwt_secret))
        tampered_run = next((x for x in tampered.get("runs",[]) if x["id"] == jobid), None)
        if tampered_status != 200 or not tampered_run or tampered_run.get("verifiedComplete") is not False:
            raise AssertionError("FORGED_TERMINAL_EVIDENCE_FALSE_PASS")
        proof["forgedWorkerRejected"] = True
        command("docker", "exec", pg_name, "psql", "-v", "ON_ERROR_STOP=1", "-U", "canary",
                "-d", "cst_team_canary", "-c", """
                  UPDATE ai_execution_events SET worker_id='cst-team-dev-qa'
                  WHERE execution_id='%s'::uuid AND phase='qa' AND event_type='team.completed'
                """ % jobid)
        command("docker", "exec", pg_name, "psql", "-v", "ON_ERROR_STOP=1", "-U", "canary",
                "-d", "cst_team_canary", "-c", """
                  INSERT INTO ai_execution_events (
                    execution_id, task_id, company_id, event_id, event_type, phase,
                    status, message, worker_id, signature_verified, payload)
                  SELECT execution_id, task_id, company_id, gen_random_uuid()::text,
                    event_type, phase, status, message, worker_id, signature_verified, payload
                  FROM ai_execution_events
                  WHERE execution_id='%s'::uuid AND phase='coding' AND event_type='team.completed'
                  LIMIT 1
                """ % jobid)
        duplicate_status, duplicated = http(api_port, path="/api/cst-ai-team/monitor?companyId=1",
                                            jwt=make_jwt(jwt_secret))
        duplicate_run = next((x for x in duplicated.get("runs",[]) if x["id"] == jobid), None)
        if duplicate_status != 200 or not duplicate_run or duplicate_run.get("verifiedComplete") is not False:
            raise AssertionError("DUPLICATE_TERMINAL_EVIDENCE_FALSE_PASS")
        proof["duplicateReceiptRejected"] = True
        # Operator-collected observations use existing execution ledger, not GPT02 authority.
        rpath="/api/cst-ai-team/external-reviews?companyId=1"
        admitted,review=http(api_port,"POST",rpath,make_jwt(jwt_secret),
                             {"scenario":"operator_collected_read_only_review"})
        anonymous_review,_=http(api_port,"POST",rpath,data={"scenario":"operator_collected_read_only_review"})
        staff_review,_=http(api_port,"POST",rpath,make_jwt(jwt_secret,"staff"),
                            {"scenario":"operator_collected_read_only_review"})
        other_company_review,_=http(api_port,"POST",
          "/api/cst-ai-team/external-reviews?companyId=3",make_jwt(jwt_secret),
          {"scenario":"operator_collected_read_only_review"})
        if (anonymous_review,staff_review,other_company_review)!=(401,403,403):
            raise AssertionError("EXTERNAL_REVIEW_TENANT_OR_AUTH_GUARD_FAILED")
        if admitted!=201 or review.get("proofLevel")!="DEV_OPERATOR_COLLECTED_UNATTESTED":
            raise AssertionError("OPERATOR_REVIEW_START_FAIL")
        reviewid=review["id"]; challenge=review["challenge"]
        path="/api/cst-ai-team/external-reviews/"+reviewid+"/observations?companyId=1"
        profile={"coding":("Travelintrips","main"),"infrastructure":("DELL","dell-recovery"),
                 "security":("DELL","dell-verifier"),"qa":("DELL","dell-browser")}
        def item(role):
            host,agent=profile[role]
            return {"role":role,"host":host,"agentId":agent,"challenge":challenge,
              "result":"BLOCKED","summaryCode":"NO_PERSISTED_HANDOFF",
              "responseSha256":hashlib.sha256(("dev-sample-response-"+role).encode()).hexdigest(),
              "sessionSha256":hashlib.sha256(("dev-sample-session-"+role).encode()).hexdigest()}
        early,_=http(api_port,"POST",path,make_jwt(jwt_secret),item("qa"))
        bad=item("coding");bad["agentId"]="different-agent"
        mismatched,_=http(api_port,"POST",path,make_jwt(jwt_secret),bad)
        stale=item("coding");stale["challenge"]="e1d00000-1111-4111-8111-111111111111"
        wrong_challenge,_=http(api_port,"POST",path,make_jwt(jwt_secret),stale)
        if (early,mismatched,wrong_challenge)!=(409,400,403):
            raise AssertionError("EARLY_QA_OR_WRONG_PROFILE_OR_CHALLENGE_ALLOWED")
        for role in ("coding","infrastructure","security"):
            status,_=http(api_port,"POST",path,make_jwt(jwt_secret),item(role))
            if status!=201:raise AssertionError("OBSERVATION_NOT_ACCEPTED_"+role)
        duplicate,_=http(api_port,"POST",path,make_jwt(jwt_secret),item("coding"))
        if duplicate!=409:raise AssertionError("OBSERVATION_REPLAY_ALLOWED")
        # Disposable PG only: a forged prior receipt must be rejected BEFORE
        # QA is written, even though the three prior role labels are present.
        command("docker","exec",pg_name,"psql","-v","ON_ERROR_STOP=1","-U","canary",
                "-d","cst_team_canary","-c", """
                  UPDATE ai_execution_events SET signature_verified=true
                  WHERE execution_id='%s'::uuid AND phase='security'
                    AND event_type='team.external.observed'
                """ % reviewid)
        signed_prior,_=http(api_port,"POST",path,make_jwt(jwt_secret),item("qa"))
        if signed_prior!=409:raise AssertionError("QA_ACCEPTED_SPOOFED_SIGNED_PRIOR")
        command("docker","exec",pg_name,"psql","-v","ON_ERROR_STOP=1","-U","canary",
                "-d","cst_team_canary","-c", """
                  UPDATE ai_execution_events SET signature_verified=false
                  WHERE execution_id='%s'::uuid AND phase='security'
                    AND event_type='team.external.observed'
                """ % reviewid)
        command("docker","exec",pg_name,"psql","-v","ON_ERROR_STOP=1","-U","canary",
                "-d","cst_team_canary","-c", """
                  UPDATE ai_execution_events SET worker_id='forged-worker'
                  WHERE execution_id='%s'::uuid AND phase='infrastructure'
                    AND event_type='team.external.observed'
                """ % reviewid)
        forged_prior,_=http(api_port,"POST",path,make_jwt(jwt_secret),item("qa"))
        if forged_prior!=409:raise AssertionError("QA_ACCEPTED_FORGED_PRIOR_IDENTITY")
        command("docker","exec",pg_name,"psql","-v","ON_ERROR_STOP=1","-U","canary",
                "-d","cst_team_canary","-c", """
                  UPDATE ai_execution_events SET worker_id='openclaw:DELL:dell-recovery'
                  WHERE execution_id='%s'::uuid AND phase='infrastructure'
                    AND event_type='team.external.observed'
                """ % reviewid)
        proof["invalidPriorQaRejected"]={"forgedSignature":True,"forgedWorker":True}
        qa_status,_=http(api_port,"POST",path,make_jwt(jwt_secret),item("qa"))
        if qa_status!=201:raise AssertionError("QA_OBSERVATION_NOT_ACCEPTED")
        status,data=http(api_port,path=rpath,jwt=make_jwt(jwt_secret))
        row=next((x for x in data.get("reviews",[]) if x.get("id")==reviewid),None)
        if status!=200 or not row or row.get("status")!="blocked" or not row.get("internallyConsistent"):
            raise AssertionError("REVIEW_OBSERVATION_READBACK_FAILED")
        if row.get("operationalVerified") is not False or row.get("independentFinalAckVerified") is not False:
            raise AssertionError("UNSIGNED_OBSERVATIONS_PROMOTED")
        proof["externalReviewObservation"]={"id":reviewid,"roles":row["recordedRoles"],
           "replayRejected":True,"earlyQaRejected":True,"wrongChallengeRejected":True,
           "unauthorizedAccessRejected":True,"crossCompanyRejected":True,"notSigned":True,
           "operationalVerified":False}
        # Alternate QA origin: direct local Ollama is not the dell-browser OpenClaw profile.
        local_http,local_review=http(api_port,"POST",rpath,make_jwt(jwt_secret),
                           {"scenario":"operator_collected_read_only_review"})
        if local_http!=201 or local_review.get("qaLocalFallback")!={"host":"DELL","agentId":"ollama-local-qa"}:
            raise AssertionError("LOCAL_QA_FALLBACK_NOT_EXPLICIT")
        local_id,local_challenge=local_review["id"],local_review["challenge"]
        local_path="/api/cst-ai-team/external-reviews/"+local_id+"/observations?companyId=1"
        for role in ("coding","infrastructure","security"):
            saved=item(role);saved["challenge"]=local_challenge
            st,_=http(api_port,"POST",local_path,make_jwt(jwt_secret),saved)
            if st!=201:raise AssertionError("LOCAL_QA_PRIOR_ROLE_FAILED_"+role)
        native_qa=item("qa");native_qa["challenge"]=local_challenge
        native_qa["agentId"]="ollama-local-qa"
        native_qa["result"]="BLOCKED";native_qa["summaryCode"]="MISSING_FINAL_ACK"
        st,_=http(api_port,"POST",local_path,make_jwt(jwt_secret),native_qa)
        if st!=201:raise AssertionError("LOCAL_QA_OBSERVATION_NOT_RECORDED")
        st,readback=http(api_port,path=rpath,jwt=make_jwt(jwt_secret))
        local_row=next((r for r in readback.get("reviews",[]) if r.get("id")==local_id),None)
        local_obs=next((r for r in (local_row or {}).get("observations",[]) if r.get("role")=="qa"),None)
        if st!=200 or not local_row or not local_row.get("internallyConsistent") or \
           not local_obs or local_obs.get("sourceKind")!="ollama-local" or \
           local_obs.get("agentId")!="ollama-local-qa" or \
           local_row.get("operationalVerified") is not False or \
           local_row.get("independentFinalAckVerified") is not False:
            raise AssertionError("LOCAL_QA_ORIGIN_CONFUSED_WITH_OPENCLAW_OR_SIGNED_FINAL")
        proof["localModelQaAlternative"]={"id":local_id,"qaSource":"ollama-local",
            "roleCount":len(local_row["recordedRoles"]),"internallyConsistent":True,
            "operationalVerified":False,"independentFinalAckVerified":False}
        # QA-provider failure: retain only three actual-shaped records; never invent QA.
        code,partial=http(api_port,"POST",rpath,make_jwt(jwt_secret),
                        {"scenario":"operator_collected_read_only_review"})
        if code!=201:raise AssertionError("PARTIAL_OPERATOR_REVIEW_ADMISSION_FAILED")
        partial_id,partial_challenge=partial["id"],partial["challenge"]
        partial_path="/api/cst-ai-team/external-reviews/"+partial_id+"/observations?companyId=1"
        for role in ("coding","infrastructure","security"):
            evidence=item(role);evidence["challenge"]=partial_challenge
            code,_=http(api_port,"POST",partial_path,make_jwt(jwt_secret),evidence)
            if code!=201:raise AssertionError("PARTIAL_ROLE_NOT_RECORDED_"+role)
        close_path="/api/cst-ai-team/external-reviews/"+partial_id+"/close?companyId=1"
        invalid_close,_=http(api_port,"POST",close_path,make_jwt(jwt_secret),
                             {"reason":"UNBOUNDED_RAW_PROVIDER_ERROR"})
        anonymous_close,_=http(api_port,"POST",close_path,data={"reason":"QA_PROVIDER_LIMIT"})
        wrong_company_close,_=http(api_port,"POST",
          "/api/cst-ai-team/external-reviews/"+partial_id+"/close?companyId=3",
          make_jwt(jwt_secret),{"reason":"QA_PROVIDER_LIMIT"})
        if (invalid_close,anonymous_close,wrong_company_close)!=(400,401,403):
            raise AssertionError("REVIEW_ABORT_ACCESS_NOT_SCOPED")
        closed,closure=http(api_port,"POST",close_path,make_jwt(jwt_secret),
                            {"reason":"QA_PROVIDER_LIMIT"})
        duplicate_close,_=http(api_port,"POST",close_path,make_jwt(jwt_secret),
                               {"reason":"QA_PROVIDER_LIMIT"})
        late_qa=item("qa");late_qa["challenge"]=partial_challenge
        late_qa_code,_=http(api_port,"POST",partial_path,make_jwt(jwt_secret),late_qa)
        if (closed,duplicate_close,late_qa_code)!=(200,409,409):
            raise AssertionError("QA_FAILURE_ABORT_NOT_TERMINAL")
        state,response=http(api_port,path=rpath,jwt=make_jwt(jwt_secret))
        partial_row=next((r for r in response.get("reviews",[]) if r["id"]==partial_id),None)
        if state!=200 or not partial_row or partial_row.get("status")!="blocked" or \
           partial_row.get("failureReason")!="QA_PROVIDER_LIMIT" or \
           partial_row.get("qaReviewRecorded") is not False or \
           partial_row.get("recordedRoles")!=["coding","infrastructure","security"] or \
           partial_row.get("internallyConsistent") is not False or \
           partial_row.get("independentFinalAckVerified") is not False:
            raise AssertionError("PARTIAL_QA_BLOCKED_PROJECTION_FAILED")
        proof["providerBlockedReview"]={"id":partial_id,"recordedRoles":3,
           "qaReviewRecorded":False,"failureReason":"QA_PROVIDER_LIMIT",
           "replayBlocked":True,"authorizationGuardsPass":True,
           "independentFinalAckVerified":False}
        # A stale run must appear blocked and reject more observations without writes.
        code,old=http(api_port,"POST",rpath,make_jwt(jwt_secret),
                      {"scenario":"operator_collected_read_only_review"})
        if code!=201:raise AssertionError("STALE_REVIEW_ADMISSION_FAILED")
        command("docker","exec",pg_name,"psql","-v","ON_ERROR_STOP=1","-U","canary",
                "-d","cst_team_canary","-c", """
                  UPDATE ai_execution_jobs SET created_at=now()-interval '11 minutes'
                  WHERE id='%s'::uuid AND source='cst-ai-team-dev-external-review'
                """ % old["id"])
        stale_code,stale_listing=http(api_port,path=rpath,jwt=make_jwt(jwt_secret))
        stale_row=next((r for r in stale_listing.get("reviews",[]) if r["id"]==old["id"]),None)
        if stale_code!=200 or not stale_row or stale_row.get("status")!="blocked" or \
           stale_row.get("expired") is not True or \
           stale_row.get("failureReason")!="OPERATOR_REVIEW_TIMEOUT":
            raise AssertionError("STALE_REVIEW_NOT_BLOCKED_ON_READ")
        stale_observation=item("coding");stale_observation["challenge"]=old["challenge"]
        stale_post,_=http(api_port,"POST", "/api/cst-ai-team/external-reviews/"+old["id"]+
                         "/observations?companyId=1",make_jwt(jwt_secret),stale_observation)
        if stale_post!=409:raise AssertionError("STALE_REVIEW_OBSERVATION_WRITTEN")
        proof["staleReview"]={"projectedBlocked":True,"writeRejected":True,
           "failureReason":"OPERATOR_REVIEW_TIMEOUT"}
        proof["result"]="ISOLATED_CANARY_E2E_PASS"
    except Exception as err:
        proof["result"]="FAIL"
        proof["error"]=str(err)[:700]
        if LOG.exists():
            # No secrets should be copied into evidence or stdout.
            last=LOG.read_text(errors="replace").splitlines()[-20:]
            proof["logErrors"]=[line[:200] for line in last
                                if "error" in line.lower() and "postgresql://" not in line][:8]
    finally:
        if spawned and spawned.poll() is None:
            spawned.terminate()
            try: spawned.wait(timeout=5)
            except subprocess.TimeoutExpired: spawned.kill()
        if logfile: logfile.close()
        if created:
            subprocess.run(["docker","rm","-f",pg_name],capture_output=True,text=True,timeout=20)
        proof["end"]=time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())
        EVIDENCE.write_text(json.dumps(proof,indent=2,sort_keys=True))
        print(json.dumps(proof,indent=2,sort_keys=True))
    return 0 if proof["result"]=="ISOLATED_CANARY_E2E_PASS" else 1

if __name__=="__main__":
    sys.exit(main())
