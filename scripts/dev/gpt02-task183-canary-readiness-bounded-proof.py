#!/usr/bin/env python3
"""One-shot, authenticated, read-only Task183 preparer CANARY proof on CST-DEV only.

Reuses the established root-encrypted DBA/preparer custody and exclusive
watchdog-test locks. --proof opens the dedicated preparer role for <=90 seconds
while the DEV canary verifies its exact pinned-TLS identity, then ALWAYS
relocks and terminates any session. Never calls prepare_core_task or creates
task jobs, command approvals, signers, leases, or DELL dispatch.
"""
import argparse
import base64
import datetime as dt
import fcntl
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import stat
import subprocess
import sys
from urllib.parse import unquote, urlsplit

VPS_QA = Path("/opt/ai-coding-standalone-dev/qa/gpt02-task183-secure-hosted-session-proof.py")
CANARY = "gpt02-task183-dev-canary-77abb2ce"
IMAGE = "ai-task-hub:gpt02-task183-dev-ro-custody-77abb2ce"
CRED_DIR = "/run/credentials/gpt02-core-preparer.service"
PROJECT = "xssrfshdrtdfupgqwfdw"
TTL_SECONDS = 90

NODE_READ_ONLY = r"""
const {Pool} = require('/app/artifacts/api-server/node_modules/pg');
(async()=>{
  let factory;
  try {
    const m = await import('file:///app/artifacts/api-server/src/lib/gpt02-core-task-preparation.mjs');
    factory = m.createCoreTaskPreparer({env:process.env,PoolClass:Pool});
    const result = await factory.preparer.verifyReadiness();
    if(result?.verified!==true || result.readOnly!==true ||
       result.operatorApprovalGranted!==false || result.issuerGrantReady!==false ||
       result.dispatchPermitted!==false) throw Error('UNTRUSTED_READINESS_RESULT');
    console.log('CANARY_NATIVE_PREPARER_TLS_READ_ONLY=PASS');
    console.log('PREPARATION_ATTEMPTED=FALSE');
    console.log('DISPATCH_PERMITTED=FALSE');
  } catch(e) {
    const code = String(e?.code || 'READINESS_UNAVAILABLE');
    console.log('CANARY_NATIVE_PREPARER_TLS_READ_ONLY=NO_GO');
    console.log('REASON=' + (/^[A-Z0-9_]{1,80}$/.test(code) ? code : 'READINESS_UNAVAILABLE'));
    process.exitCode=4;
  } finally {
    if(factory) await factory.close().catch(()=>{});
  }
})();
"""


def deny(reason):
    raise RuntimeError(reason)


def check_canary():
    p = subprocess.run(["docker", "inspect", CANARY], capture_output=True, timeout=8)
    if p.returncode:
        deny("DEV_CANARY_MISSING")
    x = json.loads(p.stdout)[0]
    e = dict(kv.split("=", 1) for kv in x["Config"]["Env"] if "=" in kv)
    if (x["Config"]["Image"] != IMAGE or x["State"]["Running"] is not True or
        x["Config"]["User"] != "1000:1000" or
        x["HostConfig"]["NetworkMode"] != "ai-task-development_default" or
        x["HostConfig"]["RestartPolicy"]["Name"] != "no" or
        x["HostConfig"]["PortBindings"] !=
        {"8080/tcp": [{"HostIp": "127.0.0.1", "HostPort": "18395"}]} or
        len(x["Mounts"]) != 1 or x["Mounts"][0]["RW"] is not False or
        x["Mounts"][0]["Destination"] != CRED_DIR or
        e.get("NODE_ENV") != "development" or e.get("APP_ENV") != "development" or
        e.get("GPT02_CORE_PREPARATION_ENABLED") != "true" or
        e.get("GPT02_CORE_PREP_CREDENTIAL_SOURCE") != "docker-readonly" or
        e.get("GPT02_CORE_PREP_DEV_PROJECT_REF") != PROJECT or
        e.get("DISABLE_BACKGROUND_SCHEDULERS") != "true"):
        deny("DEV_CANARY_POLICY_DRIFT")
    p = subprocess.run(["docker", "exec", CANARY, "node", "-e",
                       "const fs=require('fs');const s=fs.statSync('/run/credentials/gpt02-core-preparer.service');if(!s.isDirectory()||(s.mode&0o777)!==0o500)process.exit(6)"],
                       capture_output=True, timeout=8)
    if p.returncode:
        deny("DEV_CANARY_CUSTODY_MODE_DRIFT")
    return True


def load_existing_proof():
    if (not VPS_QA.is_file() or VPS_QA.is_symlink() or VPS_QA.stat().st_uid != 0 or
        stat.S_IMODE(VPS_QA.stat().st_mode) != 0o400):
        deny("VETTED_QA_SOURCE_MISSING")
    spec = importlib.util.spec_from_file_location("task183_existing_proof", VPS_QA)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def scrubbed_code(message):
    code = str(message)
    return code if re.fullmatch(r"[A-Z0-9_]{1,90}", code) else "BOUNDED_CANARY_PROOF_UNAVAILABLE"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--proof", action="store_true",
                        help="DEV-only authenticated read-only preparer canary proof with guaranteed relock")
    args = parser.parse_args()
    if os.geteuid() != 0:
        deny("ROOT_CUSTODIAN_REQUIRED")
    helper = load_existing_proof()
    helper.ensure_watchdog()
    check_canary()
    if not args.proof:
        print("CANARY_PREPARER_BOUNDARY_PREFLIGHT=PASS")
        print("ROLE_OR_TASK_CHANGED=FALSE")
        return 0
    fd = helper.acquire_exclusive_host_lock()
    admin = None
    changed = False
    cleanup_ok = False
    try:
        helper.safe_file(helper.CREDS / "gpt02-task183-dba-dsn")
        helper.safe_file(helper.CREDS / "gpt02-task183-preparer-dsn")
        admin_dsn = helper.validate_dsn(
            helper.encrypted_credential("gpt02-task183-dba-dsn", "task183-dba-dsn"), "dba")
        prep_dsn = helper.validate_dsn(
            helper.encrypted_credential("gpt02-task183-preparer-dsn", "preparer-dsn"), "preparer")
        import psycopg
        from psycopg import sql
        admin = psycopg.connect(
            admin_dsn, autocommit=True, sslmode="verify-full", sslrootcert=str(helper.CA),
            connect_timeout=7, application_name="task183-canary-readonly-custody-qa")
        with admin.cursor() as cursor:
            cursor.execute("SELECT pg_try_advisory_lock(%s)", (helper.ADVISORY_KEY,))
            if cursor.fetchone() != (True,):
                deny("TASK183_PROOF_ALREADY_RUNNING")
        helper.admin_preflight(admin)
        # Verify the exact original locked baseline and unchanged Task183.
        if not helper.locked_readback(admin):
            deny("PREPARER_NOT_LOCKED_AT_BASELINE")
        password = unquote(urlsplit(prep_dsn).password or "")
        if not password or len(password) > 512:
            deny("PREPARER_PASSWORD_UNAVAILABLE")
        salt = secrets.token_bytes(16)
        salted = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 4096)
        client_key = hmac.new(salted, b"Client Key", hashlib.sha256).digest()
        stored_key = hashlib.sha256(client_key).digest()
        server_key = hmac.new(salted, b"Server Key", hashlib.sha256).digest()
        b64 = lambda value: base64.b64encode(value).decode("ascii")
        verifier = ("SCRAM-SHA-256$4096:" + b64(salt) + "$" +
                    b64(stored_key) + ":" + b64(server_key))
        until = (dt.datetime.now(dt.timezone.utc) +
                 dt.timedelta(seconds=TTL_SECONDS)).isoformat()
        helper.ensure_watchdog()
        # Cleanup is armed before the privileged instruction is sent.
        changed = True
        with admin.cursor() as cursor:
            cursor.execute(
                sql.SQL("ALTER ROLE gpt02_core_prep_login LOGIN CONNECTION LIMIT 1 "
                        "PASSWORD {} VALID UNTIL {}").format(
                            sql.Literal(verifier), sql.Literal(until)))
        print("BOUNDED_PREPARER_LOGIN_WINDOW_OPENED=TRUE", flush=True)
        p = subprocess.run(["docker", "exec", CANARY, "node", "-e", NODE_READ_ONLY],
                           capture_output=True, text=True, timeout=20)
        if p.returncode or "CANARY_NATIVE_PREPARER_TLS_READ_ONLY=PASS" not in p.stdout:
            reason = next((line.split("=", 1)[1] for line in p.stdout.splitlines()
                           if line.startswith("REASON=")), "READINESS_UNAVAILABLE")
            deny("CANARY_READINESS_" + scrubbed_code(reason))
        print("CANARY_NATIVE_PREPARER_TLS_READ_ONLY=PASS", flush=True)
        print("PREPARATION_ATTEMPTED=FALSE", flush=True)
        print("DISPATCH_PERMITTED=FALSE", flush=True)
        return 0
    finally:
        if admin is not None:
            if changed:
                try:
                    helper.force_relock(admin)
                    cleanup_ok = helper.locked_readback(admin)
                except Exception:
                    cleanup_ok = False
            else:
                cleanup_ok = True
            admin.close()
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)
        if changed:
            print("POSTFLIGHT_NOLOGIN_PASSWORD_NULL_ZERO_SESSIONS=" +
                  ("PASS" if cleanup_ok else "NO_GO_RELOCK_REQUIRED"), flush=True)
        if changed and not cleanup_ok:
            # Fail hard even if the read-only phase worked. Existing watchdog
            # remains active to perform independent relock on expiry.
            raise RuntimeError("RELOCK_POSTFLIGHT_NOT_VERIFIED")


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print("TASK183_CANARY_BOUNDED_READINESS_PROOF=NO_GO")
        print("REASON=" + scrubbed_code(exc))
        sys.exit(2)
