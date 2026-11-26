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
import sqlite3
import subprocess
import threading
import time
from pathlib import Path
import importlib.util as _importlib_util
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

REVIEW_INTAKE_FILE = Path("/opt/ai-coding-standalone-dev/qa/task183-recovery-review-intake-dev.py")
REVIEW_REQUEST_PATH = "/api/ai-tasks/183/gpt02-recovery-review-request?companyId=default"
REVIEW_STATUS_PATH = "/api/ai-tasks/183/gpt02-recovery-review-status?companyId=default"
REVIEW_PACKET_PATH = "/api/ai-tasks/183/gpt02-recovery-review-evidence?companyId=default"
REVIEW_ACK_PATH = "/api/ai-tasks/183/gpt02-recovery-review-ack?companyId=default"
REVIEW_ACK_STATUS_PATH = "/api/ai-tasks/183/gpt02-recovery-review-ack-status?companyId=default"
RECOVERY_CONSENT_CHALLENGE_PATH="/api/ai-tasks/183/gpt02-recovery-consent-challenge?companyId=default"
RECOVERY_CONSENT_PATH="/api/ai-tasks/183/gpt02-recovery-consent?companyId=default"
RECOVERY_CONSENT_STATUS_PATH="/api/ai-tasks/183/gpt02-recovery-consent-status?companyId=default"
OWNER_IDENTITY_STATUS_PATH="/api/ai-tasks/183/gpt02-owner-identity-readiness?companyId=default"
OWNER_APPROVAL_PATH="/api/ai-tasks/183/gpt02-owner-approval?companyId=default"
OWNER_APPROVAL_READINESS_PATH="/api/ai-tasks/183/gpt02-owner-approval-readiness?companyId=default"

def task183_owner_signing_ready():
    """Fail closed before allowing the time-limited Owner decision to be written.

    A recorded Owner decision expires after 120 seconds and cannot be
    recorded twice. Never accept approval unless the broker + detached
    signer are ALREADY started through an independently reviewed release.
    """
    import grp as _grp
    try:
        state=lambda unit:subprocess.check_output(
            ["systemctl","show",unit,"--property=ActiveState","--value"],timeout=3
        ).decode().strip()
        if (state("cst-task183-root-broker.service")!="active"
            or state("gpt02-issue159-operational-signer@approval.service")!="active"
            or state("gpt02-issue159-issuer-reader.service")=="active"):
            return False
        token=Path("/etc/gpt02-dev/task183-broker-release.approved")
        tst=token.lstat()
        if (not stat.S_ISREG(tst.st_mode) or token.is_symlink()
            or tst.st_uid!=0 or tst.st_gid!=0
            or stat.S_IMODE(tst.st_mode)!=0o400
            or token.read_text().strip()!="CST_DEV_TASK183_BROKER_RELEASE_V1"):
            return False
        gid=_grp.getgrnam("gpt02-issue159-signers").gr_gid
        broker_socket=Path("/run/cst-task183-root-broker/broker.sock").lstat()
        if (not stat.S_ISSOCK(broker_socket.st_mode) or
            broker_socket.st_uid!=0 or broker_socket.st_gid!=gid or
            stat.S_IMODE(broker_socket.st_mode)!=0o660):
            return False
        signer_unit="gpt02-issue159-operational-signer@approval.service"
        signer_path=Path("/run/gpt02-issue159-operational-signer-approval/signer.sock")
        signer_socket=signer_path.lstat()
        if (not stat.S_ISSOCK(signer_socket.st_mode) or
            signer_socket.st_uid==0 or stat.S_IMODE(signer_socket.st_mode)!=0o660):
            return False
        # DynamicUser owns the socket with its PRIMARY dynamic group; the
        # signer authorization group is SUPPLEMENTARY. Do not require st_gid
        # to equal the signer supplementary group (proved on real systemd).
        pid_raw=subprocess.check_output(
            ["systemctl","show",signer_unit,"--property=MainPID","--value"],
            timeout=3).decode().strip()
        if not pid_raw.isdigit() or int(pid_raw)<=1:
            return False
        pid=int(pid_raw)
        proc_status=Path(f"/proc/{pid}/status").read_text()
        proc_cgroup=Path(f"/proc/{pid}/cgroup").read_text()
        fields=dict(line.split(":",1) for line in proc_status.splitlines()
                    if ":" in line)
        uids=fields.get("Uid","").split()
        groups=fields.get("Groups","").split()
        if (len(uids)<2 or int(uids[1])!=signer_socket.st_uid
            or str(gid) not in groups
            or not any(signer_unit in line.split("/") for line in proc_cgroup.splitlines())):
            return False
        return True
    except (OSError,ValueError,KeyError,subprocess.SubprocessError):
        return False

def task183_owner_decision_status(*,include_request=False,review_actor=None):
    uri="file:/opt/ai-coding-standalone-dev/tasks.db?mode=ro"
    db=sqlite3.connect(uri,uri=True,timeout=2)
    try:
        status=read_task183_owner_decision_status(db,time.time_ns()//1_000_000)
        if not include_request:
            return status
        successor=None
        if status=="successor_reserved":
            successor=db.execute("SELECT request_id FROM task183_successor_requests").fetchone()[0]
        if status=="expired" and review_actor is not None:
            table=db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='task183_successor_requests'").fetchone()
            expired=db.execute("SELECT request_id FROM task183_successor_requests").fetchone() if table else None
            if expired:
                renewal=load_review_intake().get_pending_renewal(review_actor,expired[0])
                if renewal:
                    return "renewal_review_pending",renewal
        return status,successor
    finally:
        db.close()


def read_task183_owner_decision_status(db,now):
    db.execute("BEGIN")
    original="6bcd8419254dc21c0b149eb09e68a7b6da66"
    rows=db.execute("SELECT id,request_id,expires_at_ms FROM gpt02_task183_owner_recovery_decisions "
                    "WHERE task_id=183 AND company_id='default' LIMIT 3").fetchall()
    ledger=db.execute("SELECT type FROM sqlite_master WHERE name='task183_successor_requests'").fetchone()
    if ledger and ledger[0]!="table":
        return "unavailable"
    reservations=db.execute("SELECT predecessor_id,request_id,created_at_ms "
                            "FROM task183_successor_requests LIMIT 2").fetchall() if ledger else []
    if not rows and not reservations:
        return "not_recorded"
    parents=[r for r in rows if r[1]==original]
    if len(parents)!=1 or type(parents[0][2]) is not int:
        return "unavailable"
    parent=parents[0]
    if not reservations:
        if len(rows)!=1:
            return "unavailable"
        return "expired" if parent[2]<=now else "recorded"
    if len(reservations)!=1:
        return "unavailable"
    previous,request,created=reservations[0]
    if (previous!=parent[0] or not isinstance(request,str) or len(request)!=36
        or any(c not in '0123456789abcdef' for c in request) or request==original
        or type(created) is not int or not parent[2]<=created<=now):
        return "unavailable"
    if len(rows)==1:
        return "successor_reserved"
    children=[r for r in rows if r[1]==request]
    if len(rows)!=2 or len(children)!=1 or type(children[0][2]) is not int:
        return "unavailable"
    return "successor_recorded"


def verify_task183_owner_session(token):
    actor=verify_jwt(token)
    if not task183_owner_signing_ready():
        raise ValueError("TASK183_SIGNER_BROKER_NOT_READY")
    return actor

RECOVERY_CHALLENGE_BODY=b'{"startRecoveryConsent":true}'
REVIEW_BODY = b'{"requestReview":true}'

def load_review_intake():
    if (not REVIEW_INTAKE_FILE.is_file() or REVIEW_INTAKE_FILE.is_symlink()
        or REVIEW_INTAKE_FILE.stat().st_uid!=0
        or stat.S_IMODE(REVIEW_INTAKE_FILE.stat().st_mode)!=0o400):
        raise RuntimeError("ROOT_REVIEW_SOURCE_CUSTODY_INVALID")
    spec=_importlib_util.spec_from_file_location("task183_recovery_review_intake",REVIEW_INTAKE_FILE)
    module=_importlib_util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

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
        if self.path==OWNER_APPROVAL_READINESS_PATH:
            auth=self.headers.get("Authorization","")
            if not auth.startswith("Bearer "):
                self.reply(401,{"error":"AUTHENTICATION_REQUIRED","signingReady":False});return
            try:
                actor=verify_jwt(auth[7:])
                if actor.get("role")!="super_admin":
                    raise ValueError("SUPER_ADMIN_REQUIRED")
                try:
                    decision_status,successor=task183_owner_decision_status(include_request=True,review_actor=actor)
                except sqlite3.Error:
                    decision_status,successor="unavailable",None
                self.reply(200,{"taskId":183,"ownerDecisionStatus":decision_status,
                    "successorRequestId":successor if decision_status=="successor_reserved" else None,
                    "renewalReviewRequestId":successor if decision_status=="renewal_review_pending" else None,
                    "signingReady":decision_status in ("not_recorded","successor_reserved") and task183_owner_signing_ready(),
                    "decisionDurationSeconds":120,"readOnly":True,
                    "issuerAuthorized":False,"dispatchPermitted":False,
                    "releaseDecision":"NO_GO"})
            except (ValueError,TypeError,KeyError,UnicodeError):
                self.reply(403,{"error":"SUPER_ADMIN_REQUIRED","signingReady":False,
                                "dispatchPermitted":False})
            return
        if self.path==OWNER_IDENTITY_STATUS_PATH:
            raw=self.headers.get("Authorization","")
            if not raw.startswith("Bearer "):
                self.reply(401,{"error":"AUTHENTICATION_REQUIRED"});return
            try:
                actor=verify_jwt(raw[7:])
                source_path=Path("/opt/ai-coding-standalone-dev/qa/task183-owner-identity-readiness.py")
                st=source_path.lstat()
                if (source_path.is_symlink() or st.st_uid!=0 or
                    stat.S_IMODE(st.st_mode)!=0o400):
                    raise RuntimeError("OWNER_IDENTITY_READER_SOURCE_UNTRUSTED")
                spec=_importlib_util.spec_from_file_location("task183_owner_identity_readiness",source_path)
                module=_importlib_util.module_from_spec(spec)
                spec.loader.exec_module(module)
                result=module.eligible_owner(actor)
                if result.get("eligible") is not True or result.get("issuerAuthorized") is not False or result.get("dispatchPermitted") is not False:
                    raise ValueError("OWNER_IDENTITY_PROOF_INVALID")
                self.reply(200,result)
            except (ValueError,TypeError,UnicodeError,KeyError):
                self.reply(403,{"error":"SUPERADMIN_OWNER_LINK_NOT_AUTHORIZED",
                    "eligible":False,"issuerAuthorized":False,"dispatchPermitted":False})
            except Exception as exc:
                print("OWNER_IDENTITY_READER_UNAVAILABLE",type(exc).__name__,flush=True)
                self.reply(503,{"error":"OWNER_IDENTITY_READER_UNAVAILABLE",
                    "eligible":False,"issuerAuthorized":False,"dispatchPermitted":False})
            return
        if self.path==RECOVERY_CONSENT_STATUS_PATH:
            auth=self.headers.get("Authorization","")
            if not auth.startswith("Bearer "):
                self.reply(401,{"error":"AUTHENTICATION_REQUIRED"});return
            try:
                actor=verify_jwt(auth[7:])
                status=load_review_intake().get_recovery_consent_state(actor)
                self.reply(200,{**status,"taskId":183,"readOnly":True})
            except (ValueError,TypeError,UnicodeError,KeyError):
                self.reply(403,{"error":"CONSENT_STATUS_NOT_AUTHORIZED","dispatchPermitted":False})
            except Exception as ex:
                print("RECOVERY_CONSENT_STATUS_FAILED",type(ex).__name__,flush=True)
                self.reply(503,{"error":"CONSENT_STATUS_UNAVAILABLE","dispatchPermitted":False})
            return
        if self.path==REVIEW_ACK_STATUS_PATH:
            raw=self.headers.get("Authorization","")
            if not raw.startswith("Bearer "):
                self.reply(401,{"error":"AUTHENTICATION_REQUIRED"});return
            try:
                actor=verify_jwt(raw[7:])
                status=load_review_intake().get_review_acknowledgement(actor)
                self.reply(200,{**status,"taskId":183,"readOnly":True,
                    "dispatchPermitted":False})
            except (ValueError,TypeError,UnicodeError,KeyError):
                self.reply(403,{"error":"REVIEW_ACK_STATUS_NOT_AUTHORIZED","dispatchPermitted":False})
            except Exception as exc:
                print("REVIEW_ACK_STATUS_UNAVAILABLE",type(exc).__name__,flush=True)
                self.reply(503,{"error":"REVIEW_ACK_STATUS_UNAVAILABLE","dispatchPermitted":False})
            return
        if self.path==REVIEW_PACKET_PATH:
            raw=self.headers.get("Authorization","")
            if not raw.startswith("Bearer "):
                self.reply(401,{"error":"AUTHENTICATION_REQUIRED"});return
            try:
                actor=verify_jwt(raw[7:])
                packet=load_review_intake().review_evidence_packet(actor)
                if packet.get("readOnly") is not True or packet.get("ownerApprovalGranted") is not False or packet.get("dispatchPermitted") is not False:
                    raise ValueError("UNTRUSTED_EVIDENCE_PACKET")
                self.reply(200,packet)
            except (ValueError,TypeError,UnicodeError,KeyError):
                self.reply(403,{"error":"REVIEW_PACKET_NOT_AUTHORIZED","dispatchPermitted":False})
            except Exception as exc:
                print("REVIEW_PACKET_UNAVAILABLE",type(exc).__name__,flush=True)
                self.reply(503,{"error":"REVIEW_PACKET_UNAVAILABLE","dispatchPermitted":False})
            return
        if self.path==REVIEW_STATUS_PATH:
            raw=self.headers.get("Authorization","")
            if not raw.startswith("Bearer "):
                self.reply(401,{"error":"AUTHENTICATION_REQUIRED"});return
            try:
                actor=verify_jwt(raw[7:])
                result=load_review_intake().get_status(actor)
                self.reply(200,{**result,"taskId":183,"readOnly":True})
            except (ValueError,TypeError,UnicodeError,KeyError):
                self.reply(403,{"error":"REVIEW_STATUS_NOT_AUTHORIZED"});return
            except Exception as exc:
                print("REVIEW_STATUS_UNAVAILABLE",type(exc).__name__,flush=True)
                self.reply(503,{"error":"REVIEW_STATUS_UNAVAILABLE","dispatchPermitted":False})
            return
        if self.path=="/internal/healthz":
            self.reply(200,{"status":"ok","taskId":183,"dispatchPermitted":False})
            return
        if self.path!="/api/ai-tasks/183/gpt02-postprepare-readiness?companyId=default":
            self.reply(404,{"error":"NOT_FOUND"});return
        raw=self.headers.get("Authorization","")
        if not raw.startswith("Bearer "):
            self.reply(401,{"error":"AUTHENTICATION_REQUIRED"});return
        try:
            verify_jwt(raw[7:])
        except (ValueError,TypeError,UnicodeError,KeyError):
            self.reply(403,{"error":"VERIFIED_SUPERADMIN_GOOGLE_SESSION_REQUIRED"});return
        try:
            proc=subprocess.run(["/usr/bin/python3",
                "/opt/ai-coding-standalone-dev/qa/task183-postprepare-readiness.py"],
                capture_output=True,text=True,timeout=25)
            report=json.loads(proc.stdout)
            if proc.returncode not in (0,2) or report.get("project")!="CST-DEV" or report.get("hub_task")!=183 or report.get("dispatch_authorized") is not False or report.get("writes_performed") is not False:
                raise ValueError("READBACK_CONTRACT_MISMATCH")
            proof=report.get("proof",{})
            if not isinstance(proof,dict) or not isinstance(report.get("status"),str):
                raise ValueError("READBACK_MISSING")
            # A negative operational release decision is normal HTTP 200
            # for this strictly read-only status endpoint.
            self.reply(200,{"taskId":183,"status":report["status"],
              "reservationExpiryUtc":proof.get("reservation_expiry_utc"),
              "reservationCurrent":proof.get("reservation_current") is True,
              "corePreparations":proof.get("preparations"),
              "hubJobs":proof.get("hub_jobs"),
              "officialCommandCount":proof.get("official_command"),
              "validApprovalCount":proof.get("valid_command_approvals"),
              "verifiedBindings":proof.get("verified_bindings"),
              "preparerLocked":proof.get("preparer_locked") is True,
              "dispatchPermitted":False,"readOnly":True})
        except Exception as err:
            print("TASK183_STATUS_READ_FAILED",type(err).__name__,flush=True)
            self.reply(503,{"error":"POSTPREP_READINESS_UNAVAILABLE","dispatchPermitted":False})
    def do_POST(self):
        if self.path==OWNER_APPROVAL_PATH:
            # Final Owner decision is different from review ACK or recovery intent.
            # Both the endpoint and the writer demand an explicit signed action.
            if (self.headers.get("Origin")!=ORIGIN or
                self.headers.get("Host")!="dev-ai-task.cstlogistic.co.id"):
                self.reply(403,{"error":"SAME_ORIGIN_REQUIRED","dispatchPermitted":False});return
            if self.headers.get("X-GPT02-Intent")!="approve-task183-recovery-attempt2-only":
                self.reply(400,{"error":"EXPLICIT_OWNER_APPROVAL_INTENT_REQUIRED",
                                "dispatchPermitted":False});return
            length=self.headers.get("Content-Length","")
            if length!=str(len(b'{"approveRecoveryAttempt2":true}')):
                self.reply(400,{"error":"EXACT_OWNER_APPROVAL_BODY_REQUIRED",
                                "dispatchPermitted":False});return
            auth=self.headers.get("Authorization","")
            if not isinstance(auth,str) or not auth.startswith("Bearer "):
                self.reply(401,{"error":"AUTHENTICATION_REQUIRED",
                                "dispatchPermitted":False});return
            successor=self.headers.get("X-GPT02-Successor")
            def verified_session(token):
                actor=verify_task183_owner_session(token)
                status,reserved=task183_owner_decision_status(include_request=True)
                if (status,reserved)!=("not_recorded",None) and (
                    status!="successor_reserved" or not reserved or reserved!=successor):
                    raise ValueError("STALE_OWNER_REQUEST")
                if status=="not_recorded" and successor is not None:
                    raise ValueError("UNRESERVED_SUCCESSOR")
                return actor
            try:
                adapter=checked_import(ROOT/"task183-owner-approval-http.candidate.py",
                    "task183_owner_http")
                writer=checked_import(ROOT/"task183-owner-approval-writer-dev.py",
                    "task183_owner_writer")
                # Verify root-only one-shot source BEFORE committing the
                # irreversible Owner decision. Never discover missing code
                # after the 120-second signed window has begun.
                after=checked_import(ROOT/"task183-owner-after-decision.candidate.py",
                    "task183_owner_after_decision")
                response=adapter.authorize_request(
                    path=self.path,headers={
                        "Origin":self.headers.get("Origin"),
                        "Host":self.headers.get("Host"),
                        "X-GPT02-Intent":self.headers.get("X-GPT02-Intent"),
                        "Content-Type":self.headers.get("Content-Type"),
                        "Content-Length":length,
                        "Authorization":auth,
                        "X-GPT02-Successor":self.headers.get("X-GPT02-Successor")},
                    body=self.rfile.read(int(length)),
                    verify_session=verified_session,
                    load_review=load_review_intake,
                    write_approval=writer.record)
                # The signed-session POST is the ONLY trigger. After the
                # writer atomically commits, invoke one detached signing
                # handoff immediately inside the 120-second Owner window.
                # On uncertain outcomes, return 202 for manual reconciliation:
                # never retry the irreversible Owner decision/signature.
                try:
                    result=after.run_handoff(response,expected_request=successor)
                except Exception as exc:
                    print("TASK183_OWNER_SIGNATURE_HANDOFF_FAILED",type(exc).__name__,flush=True)
                    result={"taskId":183,"ownerDecisionStored":True,
                            "signedEvidenceVerified":False,"manualReviewRequired":True,
                            "issuerAuthorized":False,"dispatchPermitted":False,
                            "releaseDecision":"NO_GO"}
                self.reply(201 if result["signedEvidenceVerified"] is True else 202,result)
            except (ValueError,TypeError,UnicodeError,KeyError):
                self.reply(409,{"error":"OWNER_APPROVAL_REJECTED_OR_NOT_READY",
                                "dispatchPermitted":False})
            except Exception as exc:
                print("TASK183_OWNER_APPROVAL_FAIL_CLOSED",type(exc).__name__,flush=True)
                self.reply(503,{"error":"OWNER_APPROVAL_UNAVAILABLE",
                                "dispatchPermitted":False})
            return
        if self.path in (RECOVERY_CONSENT_CHALLENGE_PATH,RECOVERY_CONSENT_PATH):
            if (self.headers.get("Origin")!=ORIGIN
                or self.headers.get("Host")!="dev-ai-task.cstlogistic.co.id"):
                self.reply(403,{"error":"SAME_ORIGIN_REQUIRED"});return
            intent=("recovery-consent-challenge-only" if
                self.path==RECOVERY_CONSENT_CHALLENGE_PATH else
                "recovery-consent-record-only")
            if (self.headers.get("X-GPT02-Intent")!=intent or
                self.headers.get("Content-Type","").split(";")[0].strip()!="application/json"):
                self.reply(400,{"error":"CONSENT_EXPLICIT_INTENT_REQUIRED"});return
            n=self.headers.get("Content-Length","")
            if not n.isdigit() or not (2<=int(n)<=512):
                self.reply(400,{"error":"CONSENT_BODY_SIZE_INVALID"});return
            try:
                body=json.loads(self.rfile.read(int(n)).decode("utf-8"))
                if not isinstance(body,dict):
                    raise ValueError("CONSENT_JSON_SHAPE")
                if self.path==RECOVERY_CONSENT_CHALLENGE_PATH:
                    if body!={"startRecoveryConsent":True}:
                        raise ValueError("CHALLENGE_EXPLICIT_BODY_REQUIRED")
                elif (set(body)!={"challengeId","nonce","evidenceSha256","authorizeRecoveryOnly"}
                    or body["authorizeRecoveryOnly"] is not True
                    or any(not isinstance(body[k],str) for k in
                       ("challengeId","nonce","evidenceSha256"))):
                    raise ValueError("CONSENT_EXPLICIT_BODY_REQUIRED")
            except (ValueError,TypeError,UnicodeError):
                self.reply(400,{"error":"CONSENT_BODY_INVALID"});return
            auth=self.headers.get("Authorization","")
            if not auth.startswith("Bearer "):
                self.reply(401,{"error":"AUTHENTICATION_REQUIRED"});return
            try:
                actor=verify_jwt(auth[7:])
                module=load_review_intake()
                if self.path==RECOVERY_CONSENT_CHALLENGE_PATH:
                    result=module.issue_recovery_consent_challenge(actor=actor)
                    if result.get("ownerApprovalGranted") is not False or result.get("dispatchPermitted") is not False:
                        raise RuntimeError("CHALLENGE_TRUST_VIOLATION")
                    self.reply(200,result)
                else:
                    result=module.consent_to_recovery_review(actor=actor,
                        challenge_id=body["challengeId"],nonce=body["nonce"],
                        evidence_sha256=body["evidenceSha256"])
                    if (result.get("signedOwnerApproval") is not False
                        or result.get("issuerAuthority") is not False
                        or result.get("dispatchPermitted") is not False
                        or result.get("attemptIssued") is not False):
                        raise RuntimeError("CONSENT_TRUST_VIOLATION")
                    self.reply(201,result)
            except (ValueError,TypeError,UnicodeError,KeyError):
                self.reply(409,{"error":"RECOVERY_CONSENT_DENIED_OR_EXPIRED",
                    "signedOwnerApproval":False,"issuerAuthority":False,"dispatchPermitted":False})
            except Exception as ex:
                print("RECOVERY_CONSENT_FAILED_CLOSED",type(ex).__name__,flush=True)
                self.reply(503,{"error":"RECOVERY_CONSENT_UNAVAILABLE",
                    "signedOwnerApproval":False,"issuerAuthority":False,"dispatchPermitted":False})
            return
        if self.path==REVIEW_ACK_PATH:
            if (self.headers.get("Origin")!=ORIGIN or
                self.headers.get("Host")!="dev-ai-task.cstlogistic.co.id"):
                self.reply(403,{"error":"SAME_ORIGIN_REQUIRED"});return
            if (self.headers.get("X-GPT02-Intent")!="acknowledge-review-only"
                or self.headers.get("Content-Type","").split(";")[0].strip()!="application/json"):
                self.reply(400,{"error":"ACK_EXPLICIT_INTENT_REQUIRED"});return
            length=self.headers.get("Content-Length","")
            if not length.isdigit() or int(length)<20 or int(length)>256:
                self.reply(400,{"error":"ACK_BODY_SIZE_INVALID"});return
            try:
                body=json.loads(self.rfile.read(int(length)).decode("utf-8"))
                if (not isinstance(body,dict) or set(body)!={"evidenceSha256","reviewedOnly"}
                    or body["reviewedOnly"] is not True
                    or not isinstance(body["evidenceSha256"],str)):
                    raise ValueError("ACK_SHAPE_INVALID")
            except (ValueError,TypeError,UnicodeError):
                self.reply(400,{"error":"ACK_BODY_INVALID"});return
            raw=self.headers.get("Authorization","")
            if not raw.startswith("Bearer "):
                self.reply(401,{"error":"AUTHENTICATION_REQUIRED"});return
            try:
                actor=verify_jwt(raw[7:])
                result=load_review_intake().attest_review_evidence(
                  actor=actor,evidence_sha256=body["evidenceSha256"])
                if result.get("ownerApprovalGranted") is not False or result.get("dispatchPermitted") is not False:
                    raise RuntimeError("ACK_AUTHORITY_CONTRACT_INVALID")
                self.reply(201 if result["created"] else 200,result)
            except (ValueError,TypeError,UnicodeError,KeyError):
                self.reply(409,{"error":"ACK_EVIDENCE_OR_ACTOR_DENIED",
                    "ownerApprovalGranted":False,"dispatchPermitted":False})
            except Exception as exc:
                print("REVIEW_ACK_FAILED_CLOSED",type(exc).__name__,flush=True)
                self.reply(503,{"error":"REVIEW_ACK_UNAVAILABLE",
                    "ownerApprovalGranted":False,"dispatchPermitted":False})
            return
        if self.path==REVIEW_REQUEST_PATH:
            if (self.headers.get("Origin")!=ORIGIN
              or self.headers.get("Host")!="dev-ai-task.cstlogistic.co.id"):
                self.reply(403,{"error":"SAME_ORIGIN_REQUIRED"});return
            if (self.headers.get("X-GPT02-Intent")!="recovery-review-only"
                or self.headers.get("Content-Type","").split(";")[0].strip()!="application/json"
                or self.headers.get("Content-Length")!=str(len(REVIEW_BODY))):
                self.reply(400,{"error":"EXPLICIT_REVIEW_ONLY_INTENT_REQUIRED"});return
            if self.rfile.read(len(REVIEW_BODY))!=REVIEW_BODY:
                self.reply(400,{"error":"EXACT_REVIEW_BODY_REQUIRED"});return
            raw=self.headers.get("Authorization","")
            if not raw.startswith("Bearer "):
                self.reply(401,{"error":"AUTHENTICATION_REQUIRED"});return
            try:
                actor=verify_jwt(raw[7:])
                intake=load_review_intake()
                result=intake.record_pending_request(actor=actor,source=intake.source_readback())
                self.reply(201 if result["created"] else 200,{**result,"taskId":183})
            except (ValueError,TypeError,UnicodeError,KeyError):
                self.reply(409,{"error":"RECOVERY_REVIEW_SCOPE_OR_DUPLICATE_DENIED",
                                "approvalGranted":False,"dispatchPermitted":False});return
            except Exception as exc:
                print("REVIEW_REQUEST_FAILED_CLOSED",type(exc).__name__,flush=True)
                self.reply(503,{"error":"RECOVERY_REVIEW_REQUEST_UNAVAILABLE",
                                "approvalGranted":False,"dispatchPermitted":False})
            return
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
