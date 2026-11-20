#!/usr/bin/env python3
"""CST-DEV Task183 hosted active-session relock proof. Never dispatches or prepares a task.

Read-only preflight is default. --proof requires a separately provisioned,
root-held systemd-encrypted DBA DSN and an already staged preparer DSN.
No credentials are accepted on argv, stdin, environment, or in logs.
"""
import argparse
import datetime as dt
import os
from pathlib import Path
import stat
import subprocess
import sys
import threading
import time
from urllib.parse import urlsplit, unquote

REF = "xssrfshdrtdfupgqwfdw"
PREPARER = "gpt02_core_prep_login"
AUDITOR = "dev_gpt02_relock_catalog_auditor"
GUARD_SHA = "7651f9b031d7c6b8f70edb61efd4fe2bab4c2a62bb82b12435da24ae100485d2"
CA = Path("/etc/ssl/certs/cst-dev-supabase-root.crt")
CREDS = Path("/etc/credstore.encrypted")
RELOCK_TIMER = "gpt02-issue159-relock-catalog-auditor.timer"
RELOCK_SERVICE = "gpt02-issue159-relock-catalog-auditor.service"
TTL_SECONDS = 45


def deny(code):
    raise RuntimeError(code)


def systemctl(*args):
    p = subprocess.run(["/usr/bin/systemctl", *args], capture_output=True, text=True, timeout=8)
    return p.stdout.strip() if p.returncode == 0 else ""


def ensure_watchdog():
    if systemctl("is-active", RELOCK_TIMER) != "active":
        deny("ISSUE159_WATCHDOG_NOT_ACTIVE")
    env = systemctl("show", RELOCK_SERVICE, "-p", "Environment", "--value")
    if "GPT02_TASK183_RELOCK_REUSE_ENABLED=true" not in env:
        deny("TASK183_REUSE_NOT_ENABLED")
    if systemctl("is-active", "gpt02-task183-preparer-relock.timer") == "active":
        deny("UNEXPECTED_SECOND_RELOCK_TIMER")


def safe_file(file):
    info = file.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > 16384:
        deny("CREDENTIAL_CUSTODY_INVALID")


def encrypted_credential(filename, name):
    file = CREDS / filename
    safe_file(file)
    proc = subprocess.run(
        ["/usr/bin/systemd-creds", "decrypt", "--name=" + name, str(file), "-"],
        capture_output=True, timeout=12, check=False,
    )
    if proc.returncode or not proc.stdout or len(proc.stdout) > 8192:
        deny("CREDENTIAL_DECRYPT_FAILED")
    return proc.stdout.decode("utf-8").strip()


def validate_dsn(raw, kind):
    p = urlsplit(raw)
    if p.scheme != "postgresql" or not p.password or p.query or p.fragment or p.path != "/postgres" or p.port != 5432:
        deny("DSN_SHAPE_NOT_ALLOWED")
    name = unquote(p.username or "")
    if kind == "preparer":
        if p.hostname != "aws-1-ap-southeast-2.pooler.supabase.com" or name not in (PREPARER, PREPARER + "." + REF):
            deny("PREPARER_PROJECT_SCOPE_DENIED")
    elif kind == "dba":
        if p.hostname not in ("aws-1-ap-southeast-2.pooler.supabase.com", "db." + REF + ".supabase.co") or name not in ("postgres", "postgres." + REF):
            deny("DBA_PROJECT_SCOPE_DENIED")
    else:
        deny("INVALID_CREDENTIAL_KIND")
    return raw


def admin_preflight(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT session_user,current_database()")
        if cur.fetchone() != ("postgres", "postgres"):
            deny("NOT_AUTHENTICATED_POSTGRES_ADMIN")
        cur.execute("""
            SELECT NOT rolcanlogin AND rolconnlimit=0 AND rolpassword IS NULL
               AND rolvaliduntil < clock_timestamp()
               AND NOT (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication OR rolinherit)
            FROM pg_authid WHERE rolname='gpt02_core_prep_login'
        """)
        if cur.fetchone() != (True,):
            deny("PREPARER_NOT_LOCKED_AT_BASELINE")
        cur.execute("""
            SELECT count(*) FROM pg_stat_activity
            WHERE usename='gpt02_core_prep_login'
        """)
        if cur.fetchone()[0] != 0:
            deny("PREPARER_EXISTING_SESSION_NOT_ZERO")
        cur.execute("""
            SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex')
            FROM pg_proc WHERE oid=to_regprocedure('gpt02_guard.relock_task183_preparer()')
        """)
        if cur.fetchone() != (GUARD_SHA,):
            deny("TASK183_GUARD_SHA_DRIFT")
        cur.execute("""
            SELECT count(*) FROM pg_roles WHERE rolname='dev_gpt02_relock_catalog_auditor' AND rolcanlogin
              AND rolconnlimit=1 AND NOT (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolinherit)
        """)
        if cur.fetchone()[0] != 1:
            deny("AUDITOR_NOT_BOUNDED")
        cur.execute("""
            SELECT
              (SELECT count(*) FROM gpt02_stage.core_preparations WHERE hub_task_id=183),
              (SELECT count(*) FROM public.ai_execution_jobs WHERE task_id=183)
        """)
        if cur.fetchone() != (0, 0):
            deny("TASK183_ALREADY_PREPARED_OR_STARTED")


def locked_readback(conn):
    with conn.cursor() as cur:
        cur.execute("""
            SELECT NOT rolcanlogin AND rolconnlimit=0 AND rolpassword IS NULL
              AND rolvaliduntil < clock_timestamp(),
              (SELECT count(*) FROM pg_stat_activity WHERE usename='gpt02_core_prep_login')
            FROM pg_authid WHERE rolname='gpt02_core_prep_login'
        """)
        return cur.fetchone() == (True, 0)


def force_relock(conn):
    with conn.cursor() as cur:
        cur.execute("""
            ALTER ROLE gpt02_core_prep_login NOLOGIN CONNECTION LIMIT 0
            PASSWORD NULL VALID UNTIL '2000-01-01'
        """)
        cur.execute("""
            SELECT pg_terminate_backend(pid)
            FROM pg_stat_activity
            WHERE usename='gpt02_core_prep_login' AND pid<>pg_backend_pid()
        """)


def main():
    parser = argparse.ArgumentParser(description="Read-only preparation; no live changes without --proof")
    parser.add_argument("--proof", action="store_true", help="One bounded hosted DEV login/session-termination proof; DBA custody required")
    args = parser.parse_args()
    if os.geteuid() != 0:
        deny("ROOT_CUSTODIAN_REQUIRED")
    if not CA.is_file():
        deny("PINNED_CA_MISSING")
    ensure_watchdog()
    safe_file(CREDS / "gpt02-task183-preparer-dsn")
    if not args.proof:
        print("TASK183_PROVER_PREFLIGHT=PASS")
        print("HOSTED_DATABASE_CHANGED=FALSE")
        print("DBA_CUSTODY_AVAILABLE=" + str((CREDS / "gpt02-task183-dba-dsn").is_file()).lower())
        print("DISPATCH_PERMITTED=FALSE")
        return 0
    # The DBA credential must be provisioned independently in the root-host
    # custody system. It must NEVER pass through ChatGPT, GitHub or application env.
    admin_dsn = validate_dsn(encrypted_credential("gpt02-task183-dba-dsn", "task183-dba-dsn"), "dba")
    prep_dsn = validate_dsn(encrypted_credential("gpt02-task183-preparer-dsn", "preparer-dsn"), "preparer")
    import psycopg
    from psycopg import sql

    connect_kwargs = {"sslmode": "verify-full", "sslrootcert": str(CA), "connect_timeout": 6}
    admin = psycopg.connect(admin_dsn, autocommit=True, application_name="task183-safe-admin-proof", **connect_kwargs)
    started = threading.Event()
    ended = threading.Event()
    state = {"accepted": False, "interrupted": False, "unexpected_finish": False}
    worker = None
    changed = False

    def sleeper():
        try:
            with psycopg.connect(prep_dsn, autocommit=True, application_name="task183-hosted-session-proof", **connect_kwargs) as c:
                with c.cursor() as cur:
                    cur.execute("SELECT session_user,current_database()")
                    if cur.fetchone() != (PREPARER, "postgres"):
                        deny("NATIVE_SESSION_IDENTITY_MISMATCH")
                    state["accepted"] = True
                    started.set()
                    cur.execute("SELECT pg_sleep(100)")
                    state["unexpected_finish"] = True
        except psycopg.OperationalError:
            if state["accepted"]:
                state["interrupted"] = True
        except Exception:
            pass
        finally:
            ended.set()

    try:
        admin_preflight(admin)
        ensure_watchdog()
        valid_until = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=TTL_SECONDS)).isoformat()
        password = unquote(urlsplit(prep_dsn).password)
        with admin.cursor() as cur:
            cur.execute(sql.SQL("ALTER ROLE gpt02_core_prep_login LOGIN CONNECTION LIMIT 1 PASSWORD {} VALID UNTIL {}").format(
                sql.Literal(password), sql.Literal(valid_until)))
        changed = True
        worker = threading.Thread(target=sleeper, daemon=True)
        worker.start()
        if not started.wait(9):
            deny("NATIVE_PREPARER_LOGIN_NOT_ESTABLISHED")
        print("AUTHENTICATED_PREPARER_SESSION=PASS")
        with admin.cursor() as cur:
            cur.execute("SELECT count(*) FROM pg_stat_activity WHERE usename='gpt02_core_prep_login'")
            if cur.fetchone()[0] != 1:
                deny("ACTIVE_SESSION_CENSUS_NOT_ONE")
        print("ACTIVE_PREPARER_SESSION_OBSERVED=PASS")
        if not ended.wait(82):
            deny("WATCHDOG_ACTIVE_SESSION_TERMINATION_TIMEOUT")
        # The test sleep is 100 seconds, so it cannot complete normally before
        # 45-second role expiry + watchdog; a disconnected backend is required.
        if not state["interrupted"] or state["unexpected_finish"]:
            deny("ACTIVE_SESSION_NOT_PROVEN_TERMINATED")
        if not locked_readback(admin):
            deny("RELOCK_ROLE_CATALOG_NOT_CLEAN")
        print("LIVE_HOSTED_TERMINATION=PASS")
        print("NOLOGIN_PASSWORD_NULL_ZERO_SESSIONS=PASS")
        print("PREPARATION_ATTEMPTED=FALSE")
        print("DISPATCH_PERMITTED=FALSE")
        return 0
    finally:
        if changed:
            try:
                force_relock(admin)
            except Exception:
                print("EMERGENCY_RELOCK_REQUIRES_DBA_ATTENTION")
        if worker:
            worker.join(timeout=3)
        try:
            if changed and not locked_readback(admin):
                print("POSTFLIGHT_NOT_LOCKED_NO_GO")
        except Exception:
            print("POSTFLIGHT_UNAVAILABLE_NO_GO")
        admin.close()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        code = str(e)
        if not code.isupper() or len(code) > 90 or not all(c.isupper() or c.isdigit() or c == "_" for c in code):
            code = "HOSTED_PROOF_UNAVAILABLE"
        print("TASK183_HOSTED_ACTIVE_SESSION_PROOF=NO_GO")
        print("REASON=" + code)
        sys.exit(2)
