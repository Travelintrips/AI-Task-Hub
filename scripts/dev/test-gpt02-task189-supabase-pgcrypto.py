"""Exercise the production SQL against a disposable PostgreSQL 17 container."""
import base64
import hashlib
import importlib.util
import io
import json
import os
import re
import subprocess
import tempfile
import uuid
from pathlib import Path
from urllib.parse import unquote, urlsplit

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("native", HERE / "gpt02-task189-supabase.py")
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)


def main():
    os.umask(0o077)
    image = os.environ.get("TASK189_TEST_POSTGRES_IMAGE", "postgres:17-alpine")
    container = "task189-native-test-" + uuid.uuid4().hex[:12]
    subprocess.run(["docker", "run", "--rm", "--detach", "--network", "none", "--name", container,
                    "--tmpfs", "/var/lib/postgresql/data", "-e", "POSTGRES_PASSWORD=isolated-test-only", "-e", "POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256",
                    image], stdout=subprocess.DEVNULL, check=True)
    try:
        subprocess.run(["docker", "exec", container, "sh", "-ec",
                        'for i in $(seq 1 45); do pg_isready -h 127.0.0.1 -U postgres >/dev/null && exit 0; sleep 1; done; exit 1'], check=True)

        test_db = "gpt02_core_preparation_isolated"

        def sql(statement, db=test_db):
            return subprocess.run(["docker", "exec", "-i", container, "psql", "-XAtq", "-U", "postgres",
                                   "-d", db, "-v", "ON_ERROR_STOP=1"], input=statement, text=True,
                                  stdout=subprocess.PIPE, check=True).stdout.strip()

        sql("CREATE DATABASE " + test_db, db="postgres")
        fixture = (HERE / "gpt02-core-task-preparation-isolated.sql").read_text().replace(
            "-- GPT02_PREPARER_RLS_POLICY_INJECTION_POINT",
            (HERE / "gpt02-core-preparer-rls-candidate.sql").read_text())
        sql(fixture)
        signature = "gpt02_stage.prepare_core_task(text,integer,text,text,text,text)"
        sql(f"""ALTER FUNCTION {signature} RENAME TO prepare_core_task_v1_internal;
            REVOKE EXECUTE ON FUNCTION gpt02_stage.prepare_core_task_v1_internal(text,integer,text,text,text,text)
                FROM gpt02_core_prep_login;
            ALTER TABLE public.ai_tasks ADD COLUMN description text, ADD COLUMN source text DEFAULT 'manual';
            UPDATE public.ai_tasks SET description='Test native preparation' WHERE id=189;
            CREATE SCHEMA vault; CREATE TABLE vault.decrypted_secrets(name text PRIMARY KEY, decrypted_secret text);
            ALTER ROLE gpt02_core_prep_login NOLOGIN CONNECTION LIMIT 0;""")
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp)
            store = state / "store"
            store.mkdir()
            request_id = "1bdbed20-ac8d-4e63-898e-6a94b729c018"
            native.requester.write_state(state / "request.json", {"id": request_id,
                "scope": native.requester.SCOPE, "status": "waiting_for_issuer"})
            descriptor = native.run("request", state, store, io.BytesIO())
            query = (HERE / "gpt02-task189-supabase-response.sql").read_text()
            # Pin the disposable test recipient in place of the enrolled DEV key.
            query, n1 = re.subn(r"(descriptor->>'fingerprint' = ')[0-9A-F]{40}", r"\g<1>" + descriptor["fingerprint"], query)
            digest = hashlib.sha256(descriptor["publicKey"].encode()).hexdigest()
            query, n2 = re.subn(r"(,'hex'\) = ')[a-f0-9]{64}", r"\g<1>" + digest, query)
            assert (n1, n2) == (1, 1)
            request = "gpt02-task189-prepare-request-" + request_id
            grant = "gpt02-task189-prepare-grant-" + request_id
            sql(f"INSERT INTO vault.decrypted_secrets VALUES ('{request}', $doc${json.dumps(descriptor)}$doc$);")
            assert not sql(query)
            sql(f"""DO $fixture$ DECLARE ttl bigint := floor(extract(epoch from clock_timestamp()))::bigint+160;
                pw text := encode(extensions.gen_random_bytes(32),'hex');
                BEGIN EXECUTE format('ALTER ROLE gpt02_core_prep_login LOGIN CONNECTION LIMIT 1 PASSWORD %L VALID UNTIL %L',pw,to_timestamp(ttl));
                INSERT INTO vault.decrypted_secrets SELECT '{grant}',jsonb_build_object('requestId','{request_id}',
                 'scope',decrypted_secret::jsonb->'scope','role','gpt02_core_prep_login','expiresAt',ttl,
                 'kind','lease','password',pw)::text
                 FROM vault.decrypted_secrets WHERE name='{request}'; END $fixture$;""")
            # An otherwise valid native grant stays private against an unbound database.
            assert not sql(query)
            sql("SET ROLE gpt02_core_prep_owner;\n" +
                (HERE / "gpt02-preparer-task-lease-wrapper.sql").read_text() +
                f"REVOKE ALL ON FUNCTION {signature} FROM PUBLIC; "
                f"GRANT EXECUTE ON FUNCTION {signature} TO gpt02_core_prep_login;")
            assert not sql(query)
            sql(f"COMMENT ON FUNCTION {signature} IS 'GPT02 DEV prepare-only task 189 request {request_id}'")
            # Catalog-only release check. Simulate an accidental column grant in
            # the disposable database and roll it back before testing delivery.
            assert not sql("BEGIN; GRANT SELECT(id) ON public.ai_tasks TO gpt02_core_prep_login; "
                           + query + "\nROLLBACK;")
            ciphertext = sql(query)
            assert len(base64.b64decode(ciphertext, validate=True)) > 128
            result = native.run("receive", state, store, io.BytesIO(ciphertext.encode()))
            assert result["status"] == "published" and (store / (native.requester.NAME + ".incoming")).stat().st_size > 0
            # Use the delivered credential, with SCRAM required, inside the
            # network-isolated DB container. Credentials never appear in argv.
            bundle = subprocess.run(["systemd-creds", "decrypt", "--name=" + native.requester.NAME,
                                     str(store / (native.requester.NAME + ".incoming")), "-"],
                                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=True)
            pw = unquote(urlsplit(json.loads(bundle.stdout)["connectionString"]).password)

            def prepare(task):
                statement = ("SELECT created,dispatch_permitted FROM gpt02_stage.prepare_core_task("
                             f"'default',{task},'GPT02 DEV coding lifecycle','Travelintrips/Core-AI-Foundation',"
                             "'develop','Test native preparation');")
                return subprocess.run(["docker", "exec", "-i", container, "sh", "-ec",
                    'read -r PGPASSWORD; export PGPASSWORD PGREQUIREAUTH=scram-sha-256; '
                    'exec psql -XAtq -v ON_ERROR_STOP=1 -h 127.0.0.1 -U gpt02_core_prep_login -d "$1"',
                    "sh", test_db], input=pw + "\n" + statement, text=True, capture_output=True)

            denied = prepare(171)
            assert denied.returncode != 0 and "PREPARATION_TASK_OUTSIDE_LEASE" in denied.stderr
            first, second = prepare(189), prepare(189)
            assert first.returncode == second.returncode == 0
            assert (first.stdout.strip(), second.stdout.strip()) == ("t|f", "f|f")
            assert sql("SELECT count(*) FROM public.ai_execution_jobs WHERE task_id=189 "
                       "AND status='prepared' AND command_id IS NULL AND final_ack_verified=false") == "1"
            assert sql("SELECT count(*) FROM ai_platform.ai_coding_bridge_commands") == "0"
            sql(f"""UPDATE vault.decrypted_secrets SET decrypted_secret=
                jsonb_set(decrypted_secret::jsonb,'{{scope,taskId}}','183')::text WHERE name='{grant}';""")
            assert not sql(query)
            subprocess.run(["gpgconf", "--homedir", str(state / "supabase-recipient"), "--kill", "gpg-agent"], check=True)
    finally:
        subprocess.run(["docker", "rm", "--force", container], stdout=subprocess.DEVNULL, check=True)
    print("PASS: pgcrypto to systemd inbox, SCRAM login, task 189 preparation, replay and cross-task denial")


if __name__ == "__main__":
    main()
