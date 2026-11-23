import concurrent.futures
import hashlib
import importlib.util
import json
import os
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from socketserver import UnixStreamServer
from urllib.parse import unquote, urlsplit


def module(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + ".py"))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


issuer = module("gpt02-task189-request")
delivery = module("gpt02-task189-delivery")


class Tests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.state, self.store, self.sock = root / "state", root / "store", root / "agent.sock"
        self.state.mkdir()
        self.store.mkdir()
        self.calls = []
        self.password = "test only:&/+%?"
        self.grant = dict(lease_id=issuer.ENDPOINT[4:] + "/fixture", lease_duration=170,
                          data={"username": issuer.ROLE, "password": self.password})
        self.code = 200
        self.drop = False

    def start(self):
        case = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                case.calls.append((self.path, self.headers.get("X-CST-Request-ID"),
                                   self.headers.get("X-Vault-Request")))
                if case.drop:
                    return
                payload = json.dumps(case.grant).encode()
                self.send_response(case.code)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, *args):
                pass

        server = UnixStreamServer(str(self.sock), Handler)
        self.sock.chmod(0o600)
        thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.02})
        thread.start()
        self.addCleanup(thread.join)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)

    def run_request(self):
        def seal(bundle):
            restricted = self.state / "fixture"
            restricted.write_text(json.dumps(bundle))
            parsed = json.loads(delivery.read_bundle(restricted))
            restricted.unlink()
            self.assertEqual(unquote(urlsplit(parsed["connectionString"]).password), self.password)
            return b"opaque fixture ciphertext"
        return issuer.request(self.state, self.store, self.sock, owner=os.getuid(), encrypt_package=seal)

    @property
    def record(self):
        return json.loads((self.state / "request.json").read_text())

    def test_wait_then_concurrent_publication(self):
        self.assertEqual(self.run_request(), "waiting_for_issuer")
        req = self.record["id"]
        self.start()
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
            self.assertEqual(list(pool.map(lambda _: self.run_request(), range(5))), ["published"] * 5)
        self.assertEqual(self.calls, [(issuer.ENDPOINT, req, "true")])
        self.assertEqual((self.store / (issuer.NAME + ".incoming")).read_bytes(), b"opaque fixture ciphertext")
        self.assertNotIn(self.password, str(self.record))
        # Inbox consumed the file. A restart must not issue it again.
        (self.store / (issuer.NAME + ".incoming")).unlink()
        self.assertEqual(self.run_request(), "published")
        self.assertEqual(len(self.calls), 1)

    def test_lost_response_never_repeats(self):
        self.start()
        self.drop = True
        self.assertEqual(self.run_request(), "reconciliation_required")
        self.assertEqual(self.run_request(), "reconciliation_required")
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(list(self.store.iterdir()), [])

    def test_crash_between_request_and_response(self):
        self.run_request()
        issuer.write_state(self.state / "request.json", {**self.record, "status": "request_sent"})
        self.start()
        self.assertEqual(self.run_request(), "reconciliation_required")
        self.assertEqual(self.calls, [])

    def test_forbidden_never_retries(self):
        self.start()
        self.code = 403
        self.assertEqual(self.run_request(), "issuer_denied")
        self.assertEqual(self.run_request(), "issuer_denied")
        self.assertEqual(len(self.calls), 1)

    def test_wrong_provider_socket_permissions(self):
        self.start()
        self.sock.chmod(0o666)
        with self.assertRaises(ValueError):
            self.run_request()
        self.assertEqual(self.calls, [])
        self.assertEqual(self.record["status"], "waiting_for_issuer")

    def test_invalid_grants(self):
        self.start()
        original = self.grant.copy()
        for change in ({"lease_duration": 181}, {"lease_duration": 0}, {"lease_duration": True},
                       {"lease_id": "database/creds/gpt02-task183-preparer/example"},
                       {"data": {"username": "postgres", "password": "wrong"}},
                       {"data": {"username": issuer.ROLE, "password": ""}}):
            with self.subTest(change=change):
                self.grant = {**original, **change}
                self.assertEqual(self.run_request(), "reconciliation_required")
                self.assertEqual(list(self.store.iterdir()), [])
                (self.state / "request.json").unlink()

    def test_existing_manual_publication(self):
        (self.store / issuer.NAME).write_bytes(b"existing")
        self.start()
        self.assertEqual(self.run_request(), "existing_publication")
        self.assertEqual(self.calls, [])

    def test_publication_recovery(self):
        self.run_request()
        saved = b"opaque fixture ciphertext"
        entry = {**self.record, "status": "publishing", "sha256": hashlib.sha256(saved).hexdigest(),
                 "expiresAt": time.time() + 60}
        issuer.write_state(self.state / "request.json", entry)
        (self.state / "pending.enc").write_bytes(saved)
        self.assertEqual(self.run_request(), "published")
        incoming = self.store / (issuer.NAME + ".incoming")
        self.assertEqual(incoming.read_bytes(), saved)
        incoming.rename(self.store / issuer.NAME)
        issuer.write_state(self.state / "request.json", entry)
        self.assertEqual(self.run_request(), "published")
        self.assertFalse(incoming.exists())

    def test_recovery_after_lease_expired(self):
        self.run_request()
        saved = b"opaque fixture ciphertext"
        entry = {**self.record, "status": "publishing", "sha256": hashlib.sha256(saved).hexdigest(),
                 "expiresAt": time.time() - 1}
        issuer.write_state(self.state / "request.json", entry)
        (self.state / "pending.enc").write_bytes(saved)
        self.assertEqual(self.run_request(), "reconciliation_required")
        self.assertEqual(list(self.store.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
