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

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("native", HERE / "gpt02-task189-supabase.py")
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)


def main():
    os.umask(0o077)
    image = os.environ.get("TASK189_TEST_POSTGRES_IMAGE", "postgres:17-alpine")
    container = "task189-native-test-" + uuid.uuid4().hex[:12]
    subprocess.run(["docker", "run", "--rm", "--detach", "--network", "none", "--name", container,
                    "--tmpfs", "/var/lib/postgresql/data", "-e", "POSTGRES_HOST_AUTH_METHOD=trust",
                    image], stdout=subprocess.DEVNULL, check=True)
    try:
        subprocess.run(["docker", "exec", container, "sh", "-ec",
                        'for i in $(seq 1 45); do pg_isready -h 127.0.0.1 -U postgres >/dev/null && exit 0; sleep 1; done; exit 1'], check=True)

        def sql(statement):
            return subprocess.run(["docker", "exec", "-i", container, "psql", "-XAtq", "-U", "postgres",
                                   "-v", "ON_ERROR_STOP=1"], input=statement, text=True,
                                  stdout=subprocess.PIPE, check=True).stdout.strip()

        sql("""CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
               CREATE SCHEMA vault; CREATE TABLE vault.decrypted_secrets(name text PRIMARY KEY, decrypted_secret text);
               CREATE ROLE gpt02_core_prep_login NOLOGIN NOINHERIT CONNECTION LIMIT 0;""")
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
                BEGIN EXECUTE format('ALTER ROLE gpt02_core_prep_login LOGIN CONNECTION LIMIT 1 VALID UNTIL %L',to_timestamp(ttl));
                INSERT INTO vault.decrypted_secrets SELECT '{grant}',jsonb_build_object('requestId','{request_id}',
                 'scope',decrypted_secret::jsonb->'scope','role','gpt02_core_prep_login','expiresAt',ttl,
                 'kind','lease','password',encode(extensions.gen_random_bytes(32),'hex'))::text
                 FROM vault.decrypted_secrets WHERE name='{request}'; END $fixture$;""")
            ciphertext = sql(query)
            assert len(base64.b64decode(ciphertext, validate=True)) > 128
            result = native.run("receive", state, store, io.BytesIO(ciphertext.encode()))
            assert result["status"] == "published" and (store / (native.requester.NAME + ".incoming")).stat().st_size > 0
            sql(f"""UPDATE vault.decrypted_secrets SET decrypted_secret=
                jsonb_set(decrypted_secret::jsonb,'{{scope,taskId}}','183')::text WHERE name='{grant}';""")
            assert not sql(query)
            subprocess.run(["gpgconf", "--homedir", str(state / "supabase-recipient"), "--kill", "gpg-agent"], check=True)
    finally:
        subprocess.run(["docker", "rm", "--force", container], stdout=subprocess.DEVNULL, check=True)
    print("PASS: Supabase pgcrypto SQL, request scope, VPS decryption and systemd-encrypted inbox")


if __name__ == "__main__":
    main()
