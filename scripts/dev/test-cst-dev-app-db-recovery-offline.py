#!/usr/bin/env python3
"""Offline/synthetic CST-DEV application DB custody tests; never use a real secret.

The production installer requires a genuine interactive root console. These
fixtures replace its secret input and its database probe with synthetic values.
No Docker, PostgreSQL, Nginx or production/dev service is started or changed.
"""
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import stat
import tempfile
from unittest.mock import patch
from urllib.parse import urlsplit, unquote

SRC = Path(__file__).with_name("cst-dev-app-db-recovery-root-interactive.py")
spec = importlib.util.spec_from_file_location("app_recovery", SRC)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

OLD_PASS = "synthetic_old_password_only"
NEW_PASS = "synthetic_new_password_with_!@%#"
POOLER = "aws-1-ap-southeast-2.pooler.supabase.com"
REF = "xssrfshdrtdfupgqwfdw"
URI = "postgresql://postgres." + REF + ":" + OLD_PASS + "@" + POOLER + ":5432/postgres"


def run():
    count = 0
    with tempfile.TemporaryDirectory(prefix="synthetic-cst-dev-recovery-") as dirname:
        env = Path(dirname) / "development.env"
        ca = Path(dirname) / "synthetic-ca-for-mocked-auth.crt"
        ca.write_text("not-an-actual-CA")
        before = ("NODE_ENV=development\n"
                  "SUPABASE_DATABASE_URL_DEV=" + URI + "\n"
                  "EMPLOYEE_KASBON_WA_POLL_ENABLED=true\n"
                  "GPT02_CORE_PREPARATION_ENABLED=false\n")
        env.write_text(before)
        os.chmod(env, 0o600)

        def unchanged_env():
            data = env.read_text()
            items = [x for x in data.splitlines(keepends=True)
                     if x.startswith("SUPABASE_DATABASE_URL_DEV=")]
            assert len(items) == 1
            uri = urlsplit(items[0].split("=", 1)[1].strip())
            return data.splitlines(keepends=True), 1, uri

        with (patch.object(mod, "ENV", env),
              patch.object(mod, "CA", ca),
              patch.object(mod, "native_check", return_value=False),
              patch.object(mod, "checked_env", side_effect=unchanged_env)):
            lines, index, parsed = unchanged_env()
            try:
                with contextlib.redirect_stdout(io.StringIO()):
                    mod.stage(lines, index, parsed, NEW_PASS)
                raise AssertionError("Bad auth was accepted")
            except RuntimeError as e:
                assert str(e) == "DEV_APP_NATIVE_AUTH_NOT_VERIFIED"
            assert env.read_text() == before
            assert len(list(env.parent.glob("development.env.pre-app-db-restore-*"))) == 0
            count += 1

        with (patch.object(mod, "ENV", env),
              patch.object(mod, "CA", ca),
              patch.object(mod, "native_check", return_value=True),
              patch.object(mod, "checked_env", side_effect=unchanged_env)):
            lines, index, parsed = unchanged_env()
            with contextlib.redirect_stdout(io.StringIO()) as output:
                mod.stage(lines, index, parsed, NEW_PASS)
            assert "DEV_APP_ENV_ATOMIC_STAGED=PASS" in output.getvalue()
            result = env.read_text()
            assert "EMPLOYEE_KASBON_WA_POLL_ENABLED=true" in result
            assert "GPT02_CORE_PREPARATION_ENABLED=false" in result
            assert result.count("SUPABASE_DATABASE_URL_DEV=") == 1
            uri = urlsplit([x for x in result.splitlines()
                            if x.startswith("SUPABASE_DATABASE_URL_DEV=")][0].split("=", 1)[1])
            assert unquote(uri.password or "") == NEW_PASS
            assert uri.hostname == POOLER and uri.port == 5432
            assert unquote(uri.username or "") == "postgres." + REF
            assert stat.S_IMODE(env.stat().st_mode) == 0o600
            backups = list(env.parent.glob("development.env.pre-app-db-restore-*"))
            assert len(backups) == 1
            assert backups[0].read_text() == before
            assert stat.S_IMODE(backups[0].stat().st_mode) == 0o600
            count += 1

            # Running twice with same input must make no additional backup.
            lines, index, parsed = unchanged_env()
            with contextlib.redirect_stdout(io.StringIO()) as out:
                mod.stage(lines, index, parsed, NEW_PASS)
            assert "DEV_APP_CREDENTIAL_ALREADY_STAGED=TRUE" in out.getvalue()
            assert len(list(env.parent.glob("development.env.pre-app-db-restore-*"))) == 1
            count += 1

            for bad in ("", "short", "[YOUR-DATABASE-PASSWORD]", "<YOUR-DB>", "PASSWORD"):
                lines, index, parsed = unchanged_env()
                try:
                    with contextlib.redirect_stdout(io.StringIO()):
                        mod.stage(lines, index, parsed, bad)
                    raise AssertionError("Invalid password accepted")
                except RuntimeError as e:
                    assert str(e) in ("NEW_PASSWORD_INPUT_INVALID", "NEW_PASSWORD_IS_PLACEHOLDER")
                count += 1

    print("CST_DEV_APPLICATION_CUSTODY_SYNTHETIC_TESTS=" + str(count) + "/" + str(count) + "_PASS")
    print("REAL_CREDENTIAL_USED=FALSE")
    print("NETWORK_CONNECTION_ATTEMPTED=FALSE")
    print("HOSTED_DATABASE_CHANGED=FALSE")
    print("RUNNING_CONTAINER_CHANGED=FALSE")


if __name__ == "__main__":
    run()
