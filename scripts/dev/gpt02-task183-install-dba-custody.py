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
from urllib.parse import urlsplit, unquote

REF = "xssrfshdrtdfupgqwfdw"
NAME = "task183-dba-dsn"
OUT = Path("/etc/credstore.encrypted/gpt02-task183-dba-dsn")
CA = Path("/etc/ssl/certs/cst-dev-supabase-root.crt")
EXPECTED_POOLER = "aws-1-ap-southeast-2.pooler.supabase.com"
EXPECTED_DIRECT = "db." + REF + ".supabase.co"


def check_uri(raw):
    if not 1 <= len(raw) <= 8192:
        return False, "INVALID_URI_LENGTH"
    try:
        uri = urlsplit(raw)
        username = unquote(uri.username or "")
        password = unquote(uri.password or "")
        valid = (uri.scheme == "postgresql"
                 and uri.hostname in (EXPECTED_POOLER, EXPECTED_DIRECT)
                 and uri.port == 5432
                 and uri.path == "/postgres"
                 and username in ("postgres", "postgres." + REF)
                 and not uri.query and not uri.fragment)
    except (ValueError, UnicodeError):
        return False, "INVALID_DATABASE_URI"
    if not valid:
        return False, "WRONG_PROJECT_ROLE_OR_HOST"
    upper = password.strip().upper()
    if (not password or len(password) < 12
        or upper in ("[YOUR-DATABASE-PASSWORD]", "YOUR-DATABASE-PASSWORD",
                     "[YOUR_PASSWORD]", "YOUR_PASSWORD", "[PASSWORD]", "PASSWORD")
        or upper.startswith("[YOUR-")
        or upper.startswith("<YOUR-")):
        return False, "MISSING_OR_TEMPLATE_PASSWORD"
    return True, "URI_SCOPE_PASS"


def check_native_auth(raw):
    """Exactly one pinned-TLS authenticated connection, read only, no retry."""
    try:
        import psycopg
        with psycopg.connect(
            raw, autocommit=True, sslmode="verify-full", sslrootcert=str(CA),
            connect_timeout=6, application_name="gpt02-task183-dba-custody-verify",
            options="-c statement_timeout=3000",
        ) as conn:
            with conn.cursor() as cur:
                cur.execute("BEGIN READ ONLY")
                cur.execute("SELECT session_user::text,current_database()::text")
                valid = cur.fetchone() == ("postgres", "postgres")
                conn.rollback()
                return valid
    except Exception:
        return False


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
    print("Provide a real postgres Session pooler URI, not the example [YOUR-DATABASE-PASSWORD].")
    print("Input is hidden; no database password will be displayed or logged.")
    raw = getpass.getpass("CST-DEV postgres connection URI (hidden): ").strip()
    valid, reason = check_uri(raw)
    if not valid:
        print("DBA_CUSTODY_INSTALL=" + reason)
        return 6
    print("PROJECT_ROLE_HOST_SCOPE=PASS")
    if not check_native_auth(raw):
        print("DBA_CUSTODY_INSTALL=AUTHENTICATION_NOT_VERIFIED")
        print("EXISTING_ENCRYPTED_CREDENTIAL_UNCHANGED=TRUE")
        return 7
    print("POSTGRES_NATIVE_AUTH=PASS")

    os.umask(0o077)
    OUT.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temp = OUT.parent / (".gpt02-dba-custody-" + secrets.token_hex(12))
    try:
        p = subprocess.run(
            ["/usr/bin/systemd-creds", "encrypt", "--with-key=host",
             "--name=" + NAME, "-", str(temp)],
            input=raw.encode("utf-8"), capture_output=True, timeout=15,
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
        if check.returncode or check.stdout != raw.encode("utf-8"):
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
