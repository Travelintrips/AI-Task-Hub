#!/usr/bin/env python3
"""One-time, local-only CST-DEV DBA credential custody installer.

Run in a trusted interactive VPS console as root. Input is hidden and never
passed via command-line arguments, shell history, environment or ChatGPT.
Creates an encrypted systemd credential only; DOES NOT connect or ALTER ROLE.
"""
import getpass
import os
from pathlib import Path
import stat
import subprocess
import sys
from urllib.parse import urlsplit, unquote

REF = "xssrfshdrtdfupgqwfdw"
NAME = "task183-dba-dsn"
OUT = Path("/etc/credstore.encrypted/gpt02-task183-dba-dsn")


def main():
    if os.geteuid() != 0:
        print("DBA_CUSTODY_INSTALL=ROOT_REQUIRED")
        return 2
    if OUT.exists() or OUT.is_symlink():
        print("DBA_CUSTODY_INSTALL=ALREADY_PRESENT_NO_OVERWRITE")
        return 3
    if not os.isatty(sys.stdin.fileno()):
        print("DBA_CUSTODY_INSTALL=INTERACTIVE_CONSOLE_REQUIRED")
        return 4
    print("CST-DEV project " + REF + ". Use the official postgres session-pooler DSN.")
    print("Input will be hidden. Do not enter this connection string in ChatGPT.")
    try:
        raw = getpass.getpass("CST-DEV postgres connection URI (hidden): ").strip()
        u = urlsplit(raw)
        if (len(raw) > 8192 or u.scheme != "postgresql" or
            u.hostname not in ("aws-1-ap-southeast-2.pooler.supabase.com", "db." + REF + ".supabase.co") or
            u.port != 5432 or u.path != "/postgres" or
            unquote(u.username or "") not in ("postgres", "postgres." + REF) or
            not u.password or u.query or u.fragment):
            print("DBA_CUSTODY_INSTALL=WRONG_PROJECT_ROLE_OR_URL")
            return 5
        OUT.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        old_umask = os.umask(0o077)
        try:
            p = subprocess.run(
                ["/usr/bin/systemd-creds", "encrypt", "--with-key=host",
                 "--name=" + NAME, "-", str(OUT)],
                input=raw.encode("utf-8"), capture_output=True, timeout=15,
            )
            if p.returncode != 0:
                raise RuntimeError("ENCRYPT_FAILED")
            os.chmod(OUT, 0o600)
            s = OUT.lstat()
            if not stat.S_ISREG(s.st_mode) or s.st_uid != 0 or stat.S_IMODE(s.st_mode) != 0o600:
                raise RuntimeError("CUSTODY_MODE_FAILED")
            check = subprocess.run(
                ["/usr/bin/systemd-creds", "decrypt", "--name=" + NAME, str(OUT), "-"],
                capture_output=True, timeout=15,
            )
            if check.returncode != 0 or check.stdout != raw.encode("utf-8"):
                raise RuntimeError("CUSTODY_ROUNDTRIP_FAILED")
            print("DBA_CUSTODY_INSTALL=PASS")
            print("ENCRYPTED_FILE_MODE=0600")
            print("HOSTED_ROLE_OR_TASK_CHANGED=FALSE")
            print("READY_FOR_BOUNDED_PROOF=TRUE")
            return 0
        finally:
            os.umask(old_umask)
    except Exception:
        try:
            if OUT.exists():
                OUT.unlink()
        except OSError:
            pass
        print("DBA_CUSTODY_INSTALL=FAILED_CLEANED")
        return 6


if __name__ == "__main__":
    sys.exit(main())
