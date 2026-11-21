#!/usr/bin/env python3
"""CST-DEV Task #183: arm one short, authenticated browser preparation window.

This is NOT a preparation runner. A real signed-in Super Admin must click the
existing UI button. Only the existing dedicated gpt02_core_prep_login role is
briefly made available, within the Issue159 watchdog boundary. The script
observes the one task's committed preparation and relocks the role even when
the user does nothing. It never signs, approves, dispatches, or calls
prepare_core_task itself. Only DEV xssrfshdrtdfupgqwfdw.
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
import subprocess
import sys
import time
from urllib.parse import unquote, urlsplit

CANARY_PROOF = Path("/opt/ai-coding-standalone-dev/qa/gpt02-task183-canary-readiness-bounded-proof.py")
TASK_ID = 183
WINDOW_SECONDS = 180
MAX_WAIT_SECONDS = 150


def fail(reason):
    raise RuntimeError(reason)


def load_checked_helper():
    import stat
    if (not CANARY_PROOF.is_file() or CANARY_PROOF.is_symlink() or
        CANARY_PROOF.stat().st_uid != 0 or
        stat.S_IMODE(CANARY_PROOF.stat().st_mode) != 0o400):
        fail("SOURCE_CUSTODY_INVALID")
    spec = importlib.util.spec_from_file_location("task183_bounded_canary", CANARY_PROOF)
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    return helper


def db_counts(admin):
    with admin.cursor() as cur:
        cur.execute("BEGIN READ ONLY")
        try:
            cur.execute("SET LOCAL statement_timeout=3000")
            cur.execute(
                "SELECT (SELECT count(*)::integer FROM gpt02_stage.core_preparations WHERE hub_task_id=183), "
                "(SELECT count(*)::integer FROM public.ai_execution_jobs WHERE task_id=183)")
            return cur.fetchone()
        finally:
            admin.rollback()


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--arm", action="store_true", help="Open one bounded window for genuine Super Admin browser action")
    args = p.parse_args()
    if os.geteuid() != 0:
        fail("ROOT_ONLY")
    helper = load_checked_helper()
    helper.check_canary()
    source = helper.load_existing_proof()
    source.ensure_watchdog()
    if not args.arm:
        print("TASK183_BROWSER_WINDOW_PREFLIGHT=PASS")
        print("NO_ROLE_OR_TASK_CHANGE=TRUE")
        return 0

    fd = source.acquire_exclusive_host_lock()
    admin = None
    changed = False
    cleanup_ok = False
    action_observed = False
    try:
        source.safe_file(source.CREDS / "gpt02-task183-dba-dsn")
        source.safe_file(source.CREDS / "gpt02-task183-preparer-dsn")
        admin_dsn = source.validate_dsn(
            source.encrypted_credential("gpt02-task183-dba-dsn", "task183-dba-dsn"), "dba")
        preparer_dsn = source.validate_dsn(
            source.encrypted_credential("gpt02-task183-preparer-dsn", "preparer-dsn"), "preparer")
        import psycopg
        from psycopg import sql
        admin = psycopg.connect(
            admin_dsn, autocommit=True, sslmode="verify-full", sslrootcert=str(source.CA),
            connect_timeout=7, application_name="task183-browser-preparation-window-dev")
        with admin.cursor() as cur:
            cur.execute("SELECT pg_try_advisory_lock(%s)", (source.ADVISORY_KEY,))
            if cur.fetchone() != (True,):
                fail("ANOTHER_TASK183_PROOF_RUNNING")
        source.admin_preflight(admin)
        if not source.locked_readback(admin):
            fail("PREPARER_NOT_LOCKED_AT_BASELINE")
        if db_counts(admin) != (0, 0):
            fail("TASK183_ALREADY_PREPARED_OR_JOB_EXISTS")
        pwd = unquote(urlsplit(preparer_dsn).password or "")
        if not pwd or len(pwd) > 512:
            fail("PREPARER_CREDENTIAL_NOT_AVAILABLE")
        salt = secrets.token_bytes(16)
        salted = hashlib.pbkdf2_hmac("sha256", pwd.encode(), salt, 4096)
        stored = hashlib.sha256(hmac.new(salted, b"Client Key", hashlib.sha256).digest()).digest()
        server = hmac.new(salted, b"Server Key", hashlib.sha256).digest()
        b64 = lambda x: base64.b64encode(x).decode("ascii")
        verifier = "SCRAM-SHA-256$4096:" + b64(salt) + "$" + b64(stored) + ":" + b64(server)
        expires = (dt.datetime.now(dt.timezone.utc) +
                   dt.timedelta(seconds=WINDOW_SECONDS)).isoformat()
        source.ensure_watchdog()
        changed = True
        with admin.cursor() as cur:
            cur.execute(sql.SQL(
                "ALTER ROLE gpt02_core_prep_login LOGIN CONNECTION LIMIT 1 "
                "PASSWORD {} VALID UNTIL {}").format(sql.Literal(verifier), sql.Literal(expires)))
        # Demonstrate the real pinned-TLS preparer identity before notifying
        # the operator that their existing UI button may become enabled.
        p = subprocess.run(["docker","exec",helper.CANARY,"node","-e",helper.NODE_READ_ONLY],
                           capture_output=True,text=True,timeout=20)
        if p.returncode or "CANARY_NATIVE_PREPARER_TLS_READ_ONLY=PASS" not in p.stdout:
            fail("CANARY_READINESS_NOT_VERIFIED")
        print("TASK183_BROWSER_PREPARATION_WINDOW=OPEN",flush=True)
        print("CANARY_TLS_READ_ONLY=PASS",flush=True)
        print("WINDOW_MAX_SECONDS="+str(WINDOW_SECONDS),flush=True)
        print("ACTION_REQUIRED=GENUINE_SUPERADMIN_CLICK_IN_BROWSER",flush=True)
        print("NO_AUTOMATED_PREPARATION_OR_DISPATCH=TRUE",flush=True)
        start = time.monotonic()
        while time.monotonic()-start < MAX_WAIT_SECONDS:
            source.ensure_watchdog()
            core, jobs = db_counts(admin)
            if core>0 or jobs>0:
                action_observed = True
                print("TASK183_PREPARATION_OBSERVED="+str(core==1 and jobs==1),flush=True)
                print("CORE_PREPARATIONS="+str(core),flush=True)
                print("HUB_JOBS="+str(jobs),flush=True)
                break
            time.sleep(3)
        if not action_observed:
            print("TASK183_BROWSER_ACTION_OBSERVED=FALSE",flush=True)
            print("NO_PREPARATION_CREATED_BY_THIS_SCRIPT=TRUE",flush=True)
        return 0
    finally:
        if admin is not None:
            if changed:
                try:
                    source.force_relock(admin)
                    cleanup_ok = source.locked_readback(admin)
                except Exception:
                    cleanup_ok = False
            else:
                cleanup_ok = True
            admin.close()
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)
        if changed:
            print("ROLE_NOLOGIN_PASSWORD_NULL_SESSIONS_ZERO="+
                  ("PASS" if cleanup_ok else "NO_GO_RELOCK_REQUIRED"),flush=True)
        if changed and not cleanup_ok:
            raise RuntimeError("FINAL_RELOCK_NOT_VERIFIED")


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        reason=str(e)
        print("TASK183_BROWSER_WINDOW=NO_GO")
        print("REASON="+(reason if re.fullmatch("[A-Z0-9_]{1,90}",reason) else "WINDOW_UNAVAILABLE"))
        sys.exit(2)
