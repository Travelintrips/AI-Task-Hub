import base64
import hashlib
import importlib.util
import io
import json
import subprocess
import tempfile
import time
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("native", Path(__file__).with_name("gpt02-task189-supabase.py"))
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)


class DirectExchange(unittest.TestCase):
    def test_native_recipient_and_scoped_delivery(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp)
            store = state / "inbox"
            store.mkdir()
            request_id = str(uuid.uuid4())
            record = state / "request.json"
            native.requester.write_state(record, {"id": request_id, "scope": native.requester.SCOPE,
                                                  "status": "waiting_for_issuer"})

            def run(action, payload=b""):
                return native.run(action, state, store, io.BytesIO(payload))

            descriptor = run("request")
            self.assertEqual(descriptor, run("request"))
            self.assertNotIn("PRIVATE", descriptor["publicKey"])
            home = state / "supabase-recipient"

            def encrypt(value):
                data = native.gpg(home, ["--trust-model", "always", "--recipient",
                                         descriptor["fingerprint"], "--encrypt"], json.dumps(value).encode())
                return base64.b64encode(data)

            message = {"requestId": request_id, "scope": native.requester.SCOPE,
                       "kind": "challenge", "nonce": "ab" * 32}
            self.assertEqual(run("verify", encrypt(message))["challengeSHA256"],
                             hashlib.sha256(message["nonce"].encode()).hexdigest())
            with self.assertRaises(ValueError):
                run("receive", encrypt(message))
            lease = dict(message, kind="lease", role=native.requester.ROLE,
                         expiresAt=int(time.time()) + 150, password="fixture/only")
            for changes in ({"requestId": str(uuid.uuid4())}, {"role": "postgres"},
                            {"scope": dict(native.requester.SCOPE, taskId=183)},
                            {"expiresAt": int(time.time()) - 1}, {"expiresAt": int(time.time()) + 999},
                            {"password": ""}):
                with self.assertRaises(ValueError):
                    run("receive", encrypt(dict(lease, **changes)))
            self.assertEqual(list(store.iterdir()), [])
            with patch.object(native.requester, "encrypt", return_value=b"fixture-systemd-sealed") as seal:
                self.assertEqual(run("receive", encrypt(lease))["status"], "published")
                self.assertIn("fixture%2Fonly", seal.call_args.args[0]["connectionString"])
                self.assertEqual(run("receive", encrypt(lease))["status"], "already_published")
                self.assertEqual(seal.call_count, 1)
            self.assertNotIn("fixture/only", record.read_text())
            subprocess.run(["gpgconf", "--homedir", str(home), "--kill", "gpg-agent"], check=True)


if __name__ == "__main__":
    unittest.main()
