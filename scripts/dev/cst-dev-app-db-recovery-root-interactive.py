#!/usr/bin/env python3
"""CST-DEV-only AI Task Hub application DB credential recovery.

The authorized root operator enters the current CST-DEV postgres password
interactively into THIS application custody, never ChatGPT/argv/env/logs.
This script NEVER reads the Task183 encrypted DBA credential, updates PROD,
changes any database role, recreates containers, or enables dispatch.
--preflight is read-only and requires no secret.
--stage performs one pinned-TLS READ ONLY native authentication before atomic
replace of the existing root-owned DEV app env; any failure keeps it intact.
"""
import argparse
import datetime as dt
import fcntl
import getpass
import os
from pathlib import Path
import stat
import sys
from urllib.parse import quote, unquote, urlsplit, urlunsplit

REF = "xssrfshdrtdfupgqwfdw"
ENV = Path("/etc/ai-task/development.env")
CA = Path("/etc/ssl/certs/cst-dev-supabase-root.crt")
POOLER = "aws-1-ap-southeast-2.pooler.supabase.com"
DIRECT = "db." + REF + ".supabase.co"
USERNAME = "postgres." + REF
KEY = "SUPABASE_DATABASE_URL_DEV"
LOCK = Path("/run/cst-dev-ai-task-app-db-recovery.lock")


def checked_env():
    st = ENV.lstat()
    if (not stat.S_ISREG(st.st_mode) or st.st_uid != 0 or
        stat.S_IMODE(st.st_mode) != 0o600 or st.st_size > 128 * 1024 or
        st.st_nlink != 1):
        raise RuntimeError("DEV_APP_ENV_CUSTODY_INVALID")
    data = ENV.read_bytes()
    if b"\x00" in data or b"\r" in data:
        raise RuntimeError("DEV_APP_ENV_FORMAT_INVALID")
    lines = data.decode("utf-8").splitlines(keepends=True)
    idx = [i for i, line in enumerate(lines) if line.startswith(KEY + "=")]
    if len(idx) != 1:
        raise RuntimeError("DEV_APP_DB_KEY_NOT_UNIQUE")
    current = lines[idx[0]].split("=", 1)[1].strip()
    if current.startswith(("'", '"')) or not current:
        raise RuntimeError("DEV_APP_DB_URI_NOT_CANONICAL")
    parsed = urlsplit(current)
    if (parsed.scheme != "postgresql" or parsed.hostname != POOLER or
        parsed.port != 5432 or parsed.path != "/postgres" or
        unquote(parsed.username or "") != USERNAME or
        not parsed.password or parsed.query or parsed.fragment):
        raise RuntimeError("DEV_APP_DB_TARGET_SCOPE_DENIED")
    return lines, idx[0], parsed


def native_check(password):
    # App credential is validated against the SAME CST-DEV postgres login as
    # already deployed. The password is never sent to ChatGPT or a shell argv.
    import psycopg
    direct = "postgresql://postgres:" + quote(password, safe="") + (
        "@" + DIRECT + ":5432/postgres"
    )
    try:
        with psycopg.connect(
            direct, autocommit=True, sslmode="verify-full",
            sslrootcert=str(CA), connect_timeout=7,
            application_name="cst-dev-ai-task-app-credential-stage-readonly",
        ) as conn:
            with conn.cursor() as cur:
                cur.execute("BEGIN READ ONLY")
                cur.execute("SET LOCAL statement_timeout = 3000")
                cur.execute("SELECT session_user::text,current_database()::text,"
                            "current_setting('transaction_read_only')::text")
                ok = cur.fetchone() == ("postgres", "postgres", "on")
                conn.rollback()
                return ok
    except Exception:
        return False


def _is_root_owned_private_env(path):
    """Release-side custody invariant; synthetic CI can mock ownership only."""
    st = path.stat()
    return st.st_uid == 0 and stat.S_IMODE(st.st_mode) == 0o600


def stage(lines, index, parsed, password):
    if not password or len(password) < 12 or len(password) > 512:
        raise RuntimeError("NEW_PASSWORD_INPUT_INVALID")
    upper = password.strip().upper()
    if (upper.startswith("[YOUR-") or upper.startswith("<YOUR-") or
        upper in ("PASSWORD", "[PASSWORD]", "[YOUR-DATABASE-PASSWORD]")):
        raise RuntimeError("NEW_PASSWORD_IS_PLACEHOLDER")
    if not CA.is_file():
        raise RuntimeError("PINNED_CA_MISSING")
    print("DEV_APP_NATIVE_POSTGRES_PINNED_TLS_CHECK=START")
    if not native_check(password):
        raise RuntimeError("DEV_APP_NATIVE_AUTH_NOT_VERIFIED")
    print("DEV_APP_NATIVE_POSTGRES_PINNED_TLS_CHECK=PASS")

    # Change ONLY the password field of the existing, verified pooler URI.
    old_username = parsed.username or ""
    auth = old_username + ":" + quote(password, safe="") + "@" + POOLER + ":5432"
    newuri = urlunsplit(("postgresql", auth, "/postgres", "", ""))
    assert unquote(urlsplit(newuri).username or "") == USERNAME
    assert urlsplit(newuri).hostname == POOLER
    newlines = list(lines)
    newlines[index] = KEY + "=" + newuri + ("\n" if lines[index].endswith("\n") else "")
    old = "".join(lines).encode("utf-8")
    new = "".join(newlines).encode("utf-8")
    if old == new:
        print("DEV_APP_CREDENTIAL_ALREADY_STAGED=TRUE")
        return

    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = ENV.with_name(ENV.name + ".pre-app-db-restore-" + stamp)
    if backup.exists() or backup.is_symlink():
        raise RuntimeError("BACKUP_CONFLICT_REFUSED")
    fd = os.open(str(backup), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(old)
            f.flush()
            os.fsync(f.fileno())
    except Exception:
        try:
            backup.unlink()
        except OSError:
            pass
        raise
    temp = ENV.parent / (".cst-dev-db-restore-" + str(os.getpid()))
    try:
        fd = os.open(str(temp), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(new)
            f.flush()
            os.fsync(f.fileno())
        # Revalidate ownership and source has not changed between preflight
        # and replacement, avoiding a stale update to another operator's edit.
        current_lines, _, _ = checked_env()
        if "".join(current_lines).encode("utf-8") != old:
            raise RuntimeError("ENV_CONCURRENT_CHANGE_REJECTED")
        os.replace(temp, ENV)
        if not _is_root_owned_private_env(ENV):
            raise RuntimeError("POSTFLIGHT_ENV_CUSTODY_INVALID")
        print("DEV_APP_ENV_ATOMIC_STAGED=PASS")
        print("DEV_APP_OLD_ENV_BACKUP_ROOT_ONLY=PASS")
        print("MAIN_DEV_CONTAINER_RESTARTED=FALSE")
        print("CONTAINER_CUTOVER_READY_FOR_SEPARATE_TEST=TRUE")
    finally:
        if temp.exists():
            temp.unlink()


def main():
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--preflight", action="store_true")
    mode.add_argument("--stage", action="store_true")
    args = parser.parse_args()
    if os.geteuid() != 0:
        print("DEV_APP_RECOVERY=ROOT_REQUIRED")
        return 2
    if not args.stage and not args.preflight:
        print("DEV_APP_RECOVERY=USE_EXPLICIT_PREFLIGHT_OR_STAGE")
        return 3
    try:
        os.umask(0o077)
        lock_fd = os.open(str(LOCK), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            lines, idx, parsed = checked_env()
            print("CST_DEV_APP_DATABASE_SCOPE=PASS")
            print("APP_ENV_ROOT_CUSTODY=PASS")
            if args.preflight:
                print("DEV_APP_RECOVERY_PREFLIGHT=PASS")
                print("HOSTED_DATABASE_CHANGED=FALSE")
                print("DEV_APP_ENV_CHANGED=FALSE")
                return 0
            if not os.isatty(sys.stdin.fileno()):
                raise RuntimeError("INTERACTIVE_ROOT_CONSOLE_REQUIRED")
            print("Enter CURRENT CST-DEV postgres password, hidden.")
            print("Do NOT paste any password or DSN into chat.")
            password = getpass.getpass("CST-DEV application DB credential (hidden): ")
            try:
                stage(lines, idx, parsed, password)
            finally:
                password = None
            print("PROD_CHANGED=FALSE")
            print("TASK183_DISPATCH_ENABLED=FALSE")
            print("SECRET_PRINTED=FALSE")
            return 0
        finally:
            os.close(lock_fd)
    except Exception as e:
        reason = str(e)
        if (not reason.isupper() or len(reason) > 90 or
            any(c not in "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_" for c in reason)):
            reason = "STAGING_FAILED_NO_SECRET_OUTPUT"
        print("DEV_APP_RECOVERY=NO_GO")
        print("REASON=" + reason)
        print("MAIN_DEV_CONTAINER_RESTARTED=FALSE")
        return 4


if __name__ == "__main__":
    raise SystemExit(main())
