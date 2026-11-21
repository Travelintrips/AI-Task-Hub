#!/usr/bin/env python3
"""CST-DEV Task183 single-click preparation broker. Root-only, loopback-only.

The authenticated Super Admin initiates one POST. This process temporarily
unlocks the existing least-privilege preparer, forwards that exact request to
the existing isolated preparation API, and ALWAYS relocks before responding.
No signer approval, command dispatch, lease, or worker scheduling.
"""
import base64
import datetime as dt
import fcntl
import hashlib
import hmac
import http.server
import importlib.util
import json
import os
import re
import secrets
import stat
import subprocess
import threading
import time
from pathlib import Path
from urllib import request, error
from urllib.parse import unquote, urlsplit
from psycopg import sql

HOST = "127.0.0.1"
PORT = 18509
ORIGIN = "https://dev-ai-task.cstlogistic.co.id"
TASK_PATH = "/api/ai-tasks/183/gpt02-prepare?companyId=default"
ROOT = Path("/opt/ai-coding-standalone-dev/qa")
RUNNER = ROOT / "gpt02-task183-hostnet-direct-superadmin-oneclick.py"
TTL_SECONDS = 45
UPSTREAM = "http://127.0.0.1:18503" + TASK_PATH

def checked_import(path, alias):
    if path.is_symlink() or path.stat().st_uid != 0 or stat.S_IMODE(path.stat().st_mode) != 0o400:
        raise RuntimeError("ROOT_SOURCE_CUSTODY_INVALID")
    spec=importlib.util.spec_from_file_location(alias,path)
    mod=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

runner = checked_import(RUNNER,"task183_original_runner")
helper=runner.load_checked_helper()
source=helper.load_existing_proof()

def secret_from_auth_container():
    raw=subprocess.check_output(["docker","inspect","ai-task-dev-google-direct-authonly-20261121"],timeout=8)
    env=dict(v.split("=",1) for v in json.loads(raw)[0]["Config"]["Env"] if "=" in v)
    secret=env.get("SESSION_SECRET","")
    if len(secret)<32 or secret=="fallback-secret-change-in-production":
        raise RuntimeError("SESSION_SECRET_INVALID")
    return secret.encode()

SECRET = secret_from_auth_container()

def decode_b64url(s):
    if not isinstance(s,str) or not re.fullmatch(r"[A-Za-z0-9_-]+",s):
        raise ValueError("INVALID_TOKEN_ENCODING")
    return base64.urlsafe_b64decode(s+"="*(-len(s)%4))

def verify_jwt(token, now=None):
    """HS256 only. No token, user identity, or secret is ever logged."""
    if not isinstance(token,str) or len(token)>4096 or len(token)<48:raise ValueError("TOKEN_LENGTH_INVALID")
    parts=token.split(".")
    if len(parts)!=3:raise ValueError("JWT_SHAPE_INVALID")
    header=json.loads(decode_b64url(parts[0]))
    if not isinstance(header,dict) or header.get("alg")!="HS256":raise ValueError("JWT_ALGORITHM_DENIED")
    signed=(parts[0]+"."+parts[1]).encode("ascii")
    if not hmac.compare_digest(hmac.new(SECRET,signed,hashlib.sha256).digest(),decode_b64url(parts[2])):
        raise ValueError("JWT_SIGNATURE_INVALID")
    data=json.loads(decode_b64url(parts[1]))
    if not isinstance(data,dict):raise ValueError("JWT_CLAIMS_INVALID")
    now=int(time.time()) if now is None else int(now)
    if type(data.get("exp")) is not int or data["exp"]<=now or data["exp"]>now+8*86400:
        raise ValueError("JWT_EXPIRED_OR_INVALID")
    if type(data.get("iat")) is not int or data["iat"]>now+30 or data["iat"]<now-8*86400:
        raise ValueError("JWT_ISSUED_AT_INVALID")
    # A genuine cross-company Super Admin is stored with company_id=NULL.
    # The existing AI Task getCompanyIdForWrite() resolves NULL to default
    # for an authenticated Super Admin; do not reject that signed claim.
    # The URL and original POST API still strictly enforce companyId=default.
    if data.get("role")!="super_admin" or "companyId" not in data or data["companyId"] not in (None,"default"):
        raise ValueError("SUPERADMIN_COMPANY_REQUIRED")
    if data.get("authSource")!="supabase_google_identity":
        raise ValueError("GOOGLE_APP_SESSION_REQUIRED")
    if not re.fullmatch(r"[0-9a-fA-F-]{36}",str(data.get("authSupabaseId",""))):
        raise ValueError("GOOGLE_IDENTITY_MISSING")
    if type(data.get("authVerifiedAt")) is not int or data["authVerifiedAt"]>now*1000+30000 or data["authVerifiedAt"]< (now-8*86400)*1000:
        raise ValueError("GOOGLE_EVIDENCE_INVALID")
    if not str(data.get("id","")).strip() or not re.fullmatch(r"[^@\s]+@[^@\s]+",str(data.get("email",""))):
        raise ValueError("USER_IDENTITY_MISSING")
    return data

def prepare_bounded(token):
    """Use established custody locks and preflight; no user-provided SQL."""
    helper.check_canary()
    source.ensure_watchdog()
    fd=source.acquire_exclusive_host_lock()
    admin=None
    changed=False
    verified_relock=False
    advisory=False
    try:
        source.safe_file(source.CREDS/"gpt02-task183-dba-dsn")
        source.safe_file(source.CREDS/"gpt02-task183-preparer-dsn")
        admind=source.validate_dsn(source.encrypted_credential("gpt02-task183-dba-dsn","task183-dba-dsn"),"dba")
        prepd=source.validate_dsn(source.encrypted_credential("gpt02-task183-preparer-dsn","preparer-dsn"),"preparer")
        import psycopg
        admin=psycopg.connect(admind,autocommit=True,sslmode="verify-full",sslrootcert=str(source.CA),connect_timeout=7,application_name="task183-single-click-broker-dev")
        with admin.cursor() as cur:
            cur.execute("SELECT pg_try_advisory_lock(%s)",(source.ADVISORY_KEY,))
            advisory=cur.fetchone()==(True,)
        if not advisory:raise RuntimeError("ANOTHER_TASK183_PROOF_RUNNING")
        source.admin_preflight(admin)
        if not source.locked_readback(admin):raise RuntimeError("PREPARER_NOT_LOCKED")
        if runner.db_counts(admin)!=(0,0):raise RuntimeError("TASK183_ALREADY_PREPARED")
        password=unquote(urlsplit(prepd).password or "")
        if not password or len(password)>512:raise RuntimeError("PREPARER_CREDENTIAL_UNAVAILABLE")
        salt=secrets.token_bytes(16)
        salted=hashlib.pbkdf2_hmac("sha256",password.encode(),salt,4096)
        stored=hashlib.sha256(hmac.new(salted,b"Client Key",hashlib.sha256).digest()).digest()
        server=hmac.new(salted,b"Server Key",hashlib.sha256).digest()
        enc=lambda x:base64.b64encode(x).decode("ascii")
        verifier="SCRAM-SHA-256$4096:"+enc(salt)+"$"+enc(stored)+":"+enc(server)
        expires=(dt.datetime.now(dt.timezone.utc)+dt.timedelta(seconds=TTL_SECONDS)).isoformat()
        changed=True
        with admin.cursor() as cur:
            cur.execute(sql.SQL("ALTER ROLE gpt02_core_prep_login LOGIN CONNECTION LIMIT 1 PASSWORD {} VALID UNTIL {}").format(sql.Literal(verifier),sql.Literal(expires)))
        check=subprocess.run(["docker","exec",helper.CANARY,"node","-e",helper.NODE_READ_ONLY],capture_output=True,text=True,timeout=15)
        if check.returncode or "CANARY_NATIVE_PREPARER_TLS_READ_ONLY=PASS" not in check.stdout:
            raise RuntimeError("PREPARER_TLS_PROOF_FAILED")
        # Relay the actual authenticated request to the original, audited
        # DEV-only endpoint, which independently checks PIC, task, audit,
        # CSRF Origin and exact prepare-only body.
        req=request.Request(UPSTREAM,data=b'{"prepareOnly":true}',method="POST",headers={
            "Host":"dev-ai-task.cstlogistic.co.id",
            "Origin":ORIGIN,
            "Authorization":"Bearer "+token,
            "X-GPT02-Intent":"prepare-only",
            "Content-Type":"application/json",
        })
        try:
            with request.urlopen(req,timeout=19) as response:
                code=response.status
                result=json.load(response)
        except error.HTTPError:
            raise RuntimeError("PREPARATION_API_DENIED")
        if code!=200 or not isinstance(result,dict) or result.get("preparedOnly") is not True or result.get("dispatchPermitted") is not False or result.get("operatorApprovalGranted") is not False:
            raise RuntimeError("UNTRUSTED_PREPARATION_REPLY")
        if runner.db_counts(admin)!=(1,1):
            raise RuntimeError("PREPARATION_COUNTS_NOT_ATOMIC")
        return {"taskId":183,"preparedOnly":True,"corePreparations":1,"hubJobs":1,"dispatchPermitted":False,"operatorApprovalGranted":False}
    finally:
        if admin is not None:
            try:
                if changed:
                    source.force_relock(admin)
                    verified_relock=source.locked_readback(admin)
                else:verified_relock=source.locked_readback(admin)
            finally:
                admin.close()
        fcntl.flock(fd,fcntl.LOCK_UN)
        os.close(fd)
        if changed and not verified_relock:
            raise RuntimeError("FINAL_RELOCK_NOT_VERIFIED")

class Handler(http.server.BaseHTTPRequestHandler):
    server_version="Task183Dev/1.0"
    sys_version=""
    def log_message(self,*args):pass
    def reply(self,code,payload):
        raw=json.dumps(payload,separators=(",",":")).encode()
        self.send_response(code)
        self.send_header("Content-Type","application/json")
        self.send_header("Cache-Control","no-store")
        self.send_header("Content-Length",str(len(raw)))
        self.end_headers();self.wfile.write(raw)
    def do_GET(self):
        if self.path=="/internal/healthz":
            self.reply(200,{"status":"ok","taskId":183,"dispatchPermitted":False})
        else:self.reply(404,{"error":"NOT_FOUND"})
    def do_POST(self):
        if self.path!=TASK_PATH:
            self.reply(404,{"error":"NOT_FOUND"});return
        if self.headers.get("Origin")!=ORIGIN or self.headers.get("Host")!="dev-ai-task.cstlogistic.co.id":
            self.reply(403,{"error":"SAME_ORIGIN_REQUIRED"});return
        if self.headers.get("X-GPT02-Intent")!="prepare-only" or self.headers.get("Content-Type","").split(";")[0].strip()!="application/json":
            self.reply(400,{"error":"EXPLICIT_INTENT_REQUIRED"});return
        if self.headers.get("Content-Length")!="20":
            self.reply(400,{"error":"EXACT_BODY_REQUIRED"});return
        body=self.rfile.read(20)
        if body!=b'{"prepareOnly":true}':
            self.reply(400,{"error":"EXACT_BODY_REQUIRED"});return
        raw=self.headers.get("Authorization","")
        if not raw.startswith("Bearer "):
            self.reply(401,{"error":"AUTHENTICATION_REQUIRED"});return
        token=raw[7:]
        try:verify_jwt(token)
        except (ValueError,TypeError,UnicodeError,KeyError):
            self.reply(403,{"error":"VERIFIED_SUPERADMIN_GOOGLE_SESSION_REQUIRED"});return
        try:
            result=prepare_bounded(token)
            self.reply(200,result)
        except Exception as e:
            # Never disclose DSN, token, stack traces, or sensitive SQL.
            print("TASK183_BROKER_FAIL_CLOSED",type(e).__name__,flush=True)
            self.reply(409,{"error":"TASK183_PREPARATION_DENIED_OR_LOCKED","dispatchPermitted":False})

def main():
    if os.geteuid()!=0:raise SystemExit("ROOT_ONLY")
    helper.check_canary()
    source.ensure_watchdog()
    # No always-on root-owned reachable service without an explicit DEV
    # operator enablement; bind exclusively on VPS loopback.
    http.server.HTTPServer((HOST,PORT),Handler).serve_forever()

if __name__=="__main__":main()
