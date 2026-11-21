#!/usr/bin/env python3
"""CST-DEV only: interactive encrypted DBA custody, with authentic login validation.

Run on authorized VPS terminal as root; never paste a password into ChatGPT,
a command-line argument, an environment variable, or a GitHub comment.
This installer does not change PostgreSQL roles, task data or dispatch state.
"""
import argparse
import getpass
import os
from pathlib import Path
import secrets
import stat
import subprocess
import sys
from urllib.parse import urlsplit, unquote, quote

REF = "xssrfshdrtdfupgqwfdw"
NAME = "task183-dba-dsn"
OUT = Path("/etc/credstore.encrypted/gpt02-task183-dba-dsn")
CA = Path("/etc/ssl/certs/cst-dev-supabase-root.crt")
EXPECTED_POOLER = "aws-1-ap-southeast-2.pooler.supabase.com"
EXPECTED_DIRECT = "db." + REF + ".supabase.co"


def _secret_password(raw):
    # Existing Session Pooler URLs are accepted, but inputting the new
    # database password alone avoids URI quoting and wrong-host mistakes.
    if raw.startswith(("postgresql://", "postgres://")):
        try:
            u = urlsplit(raw)
            username = unquote(u.username or "")
            if not (u.scheme == "postgresql"
                    and u.hostname in (EXPECTED_POOLER, EXPECTED_DIRECT)
                    and u.port == 5432 and u.path == "/postgres"
                    and username in ("postgres", "postgres." + REF)
                    and not u.query and not u.fragment):
                return None, "WRONG_PROJECT_ROLE_OR_HOST"
            return unquote(u.password or ""), "URI_SCOPE_PASS"
        except (ValueError, UnicodeError):
            return None, "INVALID_DATABASE_URI"
    return raw, "PASSWORD_INPUT_SCOPE_FIXED_TO_CST_DEV"


def check_uri(raw):
    if not 1 <= len(raw) <= 8192:
        return False, "INVALID_INPUT_LENGTH"
    password, reason = _secret_password(raw)
    if password is None:
        return False, reason
    upper = password.strip().upper()
    if (not password or len(password) < 12
        or upper in ("[YOUR-DATABASE-PASSWORD]", "YOUR-DATABASE-PASSWORD",
                     "[YOUR_PASSWORD]", "YOUR_PASSWORD", "[PASSWORD]", "PASSWORD")
        or upper.startswith("[YOUR-") or upper.startswith("<YOUR-")):
        return False, "MISSING_OR_TEMPLATE_PASSWORD"
    return True, reason


def direct_dev_dsn(raw):
    valid, reason = check_uri(raw)
    if not valid:
        raise ValueError(reason)
    password, _ = _secret_password(raw)
    return ("postgresql://postgres:" + quote(password, safe="") + "@"
            + EXPECTED_DIRECT + ":5432/postgres")


def _safe_error_category(exc):
    # Never output a libpq/psycopg exception, URI, password or raw server text.
    state = getattr(exc, "sqlstate", None)
    message = str(exc).lower()
    if state == "28P01" or "password authentication failed" in message:
        return "INVALID_POSTGRES_PASSWORD"
    if "certificate verify failed" in message or "hostname mismatch" in message:
        return "TLS_CERTIFICATE_INVALID"
    if "network is unreachable" in message or "no route to host" in message:
        return "DIRECT_IPV6_NETWORK_UNAVAILABLE"
    if "connection refused" in message or "could not translate host" in message:
        return "DIRECT_DATABASE_UNREACHABLE"
    if "timeout expired" in message or "connection timed out" in message:
        return "DIRECT_DATABASE_TIMEOUT"
    return "DIRECT_DATABASE_AUTH_UNVERIFIED"


def check_native_auth(dsn):
    """Exactly one direct PostgreSQL connection with verified TLS, no pooler."""
    try:
        import psycopg
        with psycopg.connect(
            dsn, autocommit=True, sslmode="verify-full", sslrootcert=str(CA),
            connect_timeout=6, application_name="gpt02-task183-direct-dba-custody-verify",
        ) as conn:
            with conn.cursor() as cur:
                cur.execute("BEGIN READ ONLY")
                cur.execute("SET LOCAL statement_timeout=3000")
                cur.execute("SELECT session_user::text,current_database()::text")
                valid = cur.fetchone() == ("postgres", "postgres")
                conn.rollback()
                return valid, "PASS" if valid else "WRONG_SESSION_IDENTITY"
    except Exception as exc:
        return False, _safe_error_category(exc)


def main():
    parser = argparse.ArgumentParser(description="CST-DEV only. Hidden DBA URI input.")
    parser.add_argument("--replace", action="store_true",
                        help="Replace previous encrypted DBA credential after a successful native login test.")
    args = parser.parse_args()
    if os.geteuid() != 0:
        print("DBA_CUSTODY_INSTALL=ROOT_REQUIRED")
        return 2
    if OUT.is_symlink() or (OUT.exists() and not args.replace):
        print("DBA_CUSTODY_INSTALL=EXISTS_USE_REPLACE_AFTER_REAL_PASSWORD_KNOWN")
        return 3
    if not os.isatty(sys.stdin.fileno()):
        print("DBA_CUSTODY_INSTALL=INTERACTIVE_CONSOLE_REQUIRED")
        return 4
    if not CA.is_file():
        print("DBA_CUSTODY_INSTALL=PINNED_CA_MISSING")
        return 5

    print("CST-DEV database only (" + REF + ").")
    print("Enter the NEW CST-DEV postgres password only (recommended), or a genuine Session Pooler URI.")
    print("Input is hidden; no database password will be displayed or logged.")
    raw = getpass.getpass("CST-DEV postgres password (hidden): ")
    valid, reason = check_uri(raw)
    if not valid:
        print("DBA_CUSTODY_INSTALL=" + reason)
        return 6
    print("PROJECT_ROLE_HOST_SCOPE=PASS")
    print("DIRECT_POSTGRES_IPV6_TLS_VERIFICATION=START")
    direct_uri = direct_dev_dsn(raw)
    authenticated, auth_reason = check_native_auth(direct_uri)
    if not authenticated:
        print("DIRECT_DATABASE_PROBE=" + auth_reason)
        print("DBA_CUSTODY_INSTALL=AUTHENTICATION_NOT_VERIFIED")
        print("EXISTING_ENCRYPTED_CREDENTIAL_UNCHANGED=TRUE")
        return 7
    print("DIRECT_DATABASE_PROBE=PASS")
    print("POSTGRES_NATIVE_AUTH=PASS")

    os.umask(0o077)
    OUT.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temp = OUT.parent / (".gpt02-dba-custody-" + secrets.token_hex(12))
    try:
        p = subprocess.run(
            ["/usr/bin/systemd-creds", "encrypt", "--with-key=host",
             "--name=" + NAME, "-", str(temp)],
            input=direct_uri.encode("utf-8"), capture_output=True, timeout=15,
        )
        if p.returncode:
            raise RuntimeError("ENCRYPT_FAILED")
        os.chmod(temp, 0o600)
        s = temp.lstat()
        if not stat.S_ISREG(s.st_mode) or s.st_uid != 0 or stat.S_IMODE(s.st_mode) != 0o600:
            raise RuntimeError("FILE_MODE_INVALID")
        check = subprocess.run(
            ["/usr/bin/systemd-creds", "decrypt", "--name=" + NAME, str(temp), "-"],
            capture_output=True, timeout=15,
        )
        if check.returncode or check.stdout != direct_uri.encode("utf-8"):
            raise RuntimeError("ENCRYPTED_ROUNDTRIP_FAILED")
        if OUT.exists() and not args.replace:
            raise RuntimeError("EXISTING_CREDENTIAL_PROTECTED")
        os.replace(temp, OUT)
        print("DBA_CUSTODY_INSTALL=PASS")
        print("POSTGRES_AUTHENTICATED_AND_CREDENTIAL_ENCRYPTED=TRUE")
        print("ENCRYPTED_FILE_MODE=0600")
        print("HOSTED_ROLE_OR_TASK_CHANGED=FALSE")
        print("READY_FOR_BOUNDED_PROOF=TRUE")
        return 0
    except Exception:
        print("DBA_CUSTODY_INSTALL=FAILED_OLD_FILE_PRESERVED")
        return 8
    finally:
        try:
            if temp.exists():
                temp.unlink()
        except OSError:
            pass


if __name__ == "__main__":
    sys.exit(main())
