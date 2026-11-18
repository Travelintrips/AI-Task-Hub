
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
