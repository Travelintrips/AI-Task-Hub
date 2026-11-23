"""Exercise the exact rollout and rollback on a disposable, network-isolated PG17."""
import os
import subprocess
import uuid

from render import BINDING, GUARD_NEW, GUARD_OLD, HERE, SCRIPTS, WRAPPER_NEW, WRAPPER_OLD, render

WRAPPER = "gpt02_stage.prepare_core_task(text,integer,text,text,text,text)"
HELPER = WRAPPER.replace("prepare_core_task(", "prepare_core_task_v1_internal(")
AUDIT = "gpt02_guard.relock_task183_preparer()"
AUDITOR = "dev_gpt02_relock_catalog_auditor"


def main():
    container = "task189-pair-" + uuid.uuid4().hex[:10]
    image = os.environ.get("TASK189_TEST_POSTGRES_IMAGE", "postgres:17-alpine")
    subprocess.run(["docker", "run", "-d", "--rm", "--network", "none", "--name", container,
                    "--tmpfs", "/var/lib/postgresql/data", "-e", "POSTGRES_USER=qa_bootstrap",
                    "-e", "POSTGRES_PASSWORD=qa-only", image], check=True, stdout=subprocess.DEVNULL)
    try:
        subprocess.run(["docker", "exec", container, "sh", "-ec",
                        "for i in $(seq 1 50); do pg_isready -h 127.0.0.1 -U qa_bootstrap -d postgres "
                        ">/dev/null && exit 0; sleep 1; done; exit 1"], check=True)

        def sql(statement, user="qa_bootstrap", error=None, db="postgres"):
            result = subprocess.run(["docker", "exec", "-i", container, "psql", "-XAtq", "-U", user,
                                     "-d", db, "-v", "ON_ERROR_STOP=1"], text=True,
                                    input=statement, capture_output=True)
            if error:
                assert result.returncode and error in result.stderr, result.stderr
            elif result.returncode:
                raise RuntimeError(result.stderr)
            return result.stdout.strip()

        fixture = (SCRIPTS / "gpt02-core-task-preparation-isolated.sql").read_text().replace(
            "-- GPT02_PREPARER_RLS_POLICY_INJECTION_POINT",
            (SCRIPTS / "gpt02-core-preparer-rls-candidate.sql").read_text())
        fixture_db = "gpt02_core_preparation_isolated"
        sql("CREATE ROLE postgres LOGIN SUPERUSER; CREATE DATABASE " + fixture_db + " OWNER postgres;")
        sql(fixture, "postgres", db=fixture_db)
        sql("ALTER DATABASE postgres RENAME TO qa_empty; ALTER DATABASE " + fixture_db +
            " RENAME TO postgres;", db="template1")
        sql(f"""ALTER ROLE postgres NOSUPERUSER CREATEROLE BYPASSRLS;
            CREATE ROLE {AUDITOR} LOGIN NOINHERIT;
            CREATE SCHEMA gpt02_guard AUTHORIZATION postgres; CREATE SCHEMA gpt02_private;
            CREATE SCHEMA vault;
            CREATE TABLE vault.secrets(id uuid PRIMARY KEY,name text UNIQUE);
            INSERT INTO vault.secrets VALUES ('6fcc96fe-da67-4002-98c4-26b32d76cba8',
             'gpt02-task189-prepare-request-1bdbed20-ac8d-4e63-898e-6a94b729c018');
            ALTER TABLE public.ai_tasks ADD COLUMN source text NOT NULL DEFAULT 'manual';
            ALTER FUNCTION {WRAPPER} RENAME TO prepare_core_task_v1_internal;
            REVOKE EXECUTE ON FUNCTION {HELPER} FROM gpt02_core_prep_login;
            GRANT gpt02_core_prep_owner TO postgres WITH SET FALSE, INHERIT TRUE;
            GRANT gpt02_core_prep_login TO postgres WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;
            GRANT pg_read_all_data,pg_read_all_stats TO postgres;
            GRANT SELECT ON pg_catalog.pg_authid TO postgres;
            ALTER ROLE gpt02_core_prep_login NOLOGIN PASSWORD NULL CONNECTION LIMIT 0 VALID UNTIL '2000-01-01';
            SET ROLE gpt02_core_prep_owner;
            """ + (SCRIPTS / "gpt02-preparer-instruction-bound-wrapper-candidate.sql").read_text() +
            f"REVOKE ALL ON FUNCTION {WRAPPER} FROM PUBLIC; "
            f"GRANT EXECUTE ON FUNCTION {WRAPPER} TO gpt02_core_prep_login; RESET ROLE; SET ROLE postgres; " +
            (HERE / "relock-baseline.sql").read_text() +
            f"REVOKE ALL ON FUNCTION {AUDIT} FROM PUBLIC; GRANT USAGE ON SCHEMA gpt02_guard TO {AUDITOR}; "
            f"GRANT EXECUTE ON FUNCTION {AUDIT} TO {AUDITOR};")
        assert sql("SELECT rolsuper FROM pg_roles WHERE rolname='postgres'") == "f"
        assert sql("SELECT pg_has_role('postgres','gpt02_core_prep_owner','SET')") == "f"

        def snapshot():
            return sql(f"SELECT oid,proowner,proacl,proconfig,pg_get_functiondef(oid),obj_description(oid,'pg_proc') "
                       f"FROM pg_proc WHERE oid IN ('{WRAPPER}'::regprocedure,'{AUDIT}'::regprocedure) ORDER BY oid;")

        def digest(routine):
            return sql(f"SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') "
                       f"FROM pg_proc WHERE oid='{routine}'::regprocedure")

        def auditor_result():
            return sql(f"SELECT role_locked,sessions_remaining,operational_active FROM {AUDIT};", AUDITOR)

        def hosted(statement, error=None):
            return sql(statement, "postgres", error)

        original = snapshot()
        assert (digest(WRAPPER),digest(AUDIT)) == (WRAPPER_OLD,GUARD_OLD)
        policies_query = "SELECT * FROM pg_policies WHERE schemaname='public' AND tablename='ai_tasks' ORDER BY policyname"
        policies = sql(policies_query)
        install, rollback = render("install"), render("rollback")
        # A failure after the first CREATE OR REPLACE must unwind the entire statement.
        broken = install.replace("      EXECUTE $task189_guard$", "      RAISE EXCEPTION 'QA_AFTER_WRAPPER';\n      EXECUTE $task189_guard$",1)
        hosted(broken, "QA_AFTER_WRAPPER")
        assert snapshot() == original
        hosted(install)
        installed = snapshot()
        assert (digest(WRAPPER),digest(AUDIT)) == (WRAPPER_NEW,GUARD_NEW)
        assert auditor_result() == "t|0|f"
        hosted(install, "TASK189_RELEASE_PAIR_OR_ACL_DRIFT")
        assert snapshot() == installed
        hosted(rollback)
        assert snapshot() == original and auditor_result() == "t|0|f"
        hosted(install)
        assert snapshot() == installed

        # Only the disposable fixture opens a window. It establishes that the
        # independent auditor accepts the scoped pair and closes it on drift.
        sql("""DO $$ BEGIN EXECUTE format('ALTER ROLE gpt02_core_prep_login LOGIN CONNECTION LIMIT 1
             PASSWORD %L VALID UNTIL %L',gen_random_uuid()::text,clock_timestamp()+interval '100 seconds'); END $$;""")
        hosted(rollback, "TASK189_RELEASE_REQUIRES_CLOSED_WINDOW")
        assert auditor_result() == "f|0|t"
        sql(f"COMMENT ON FUNCTION {WRAPPER} IS NULL")
        assert auditor_result() == "t|0|f"
        assert sql("SELECT NOT rolcanlogin AND rolpassword IS NULL AND rolconnlimit=0 "
                   "FROM pg_authid WHERE rolname='gpt02_core_prep_login'") == "t"
        hosted(rollback, "TASK189_RELEASE_PAIR_OR_ACL_DRIFT")
        sql(f"COMMENT ON FUNCTION {WRAPPER} IS '{BINDING}'")
        hosted(rollback)
        assert snapshot() == original and sql(policies_query) == policies
        assert sql("SELECT count(*) FROM public.ai_execution_jobs WHERE task_id=189") == "0"
        print("PASS: atomic failure, install, rollback, reinstall, drift refusal, independent relock and unchanged policies")
    finally:
        subprocess.run(["docker", "rm", "-f", container], check=True, stdout=subprocess.DEVNULL)


if __name__ == "__main__":
    main()
