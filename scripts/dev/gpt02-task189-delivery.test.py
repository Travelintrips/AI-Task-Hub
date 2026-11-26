#!/usr/bin/python3
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path

script = Path(__file__).with_name("gpt02-task189-delivery.py")
spec = importlib.util.spec_from_file_location("delivery", script)
delivery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(delivery)


class DeliveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        path = Path(self.temp.name)
        self.dest = path / "target"
        self.dest.mkdir(mode=0o500)
        self.source = path / "encrypted-input-after-systemd"
        self.marker = path / "record"
        self.stage = ".incoming-test"
        self.live = self.dest / delivery.LIVE_NAME
        self.owner = (1000, 1000)
        os.chown(self.dest, *self.owner)
        self.grant = dict(taskId=189, companyId="default",
                          connectionString=f"postgresql://{delivery.PREPARER}:fixture@{delivery.POOLER}:5432/postgres")
        self.source.write_text(json.dumps(self.grant))

    def publish(self):
        delivery.publish(self.source, self.dest, self.marker, self.stage, self.owner)

    def withdraw(self):
        delivery.withdraw(self.dest, self.marker, self.stage)

    def test_deliver_and_withdraw(self):
        self.publish()
        self.assertEqual(json.loads(self.live.read_bytes()), self.grant)
        info = self.live.stat()
        self.assertEqual((info.st_uid, info.st_gid, info.st_mode & 0o777, info.st_nlink), (1000, 1000, 0o400, 1))
        self.withdraw()
        self.withdraw()
        self.assertEqual(list(self.dest.iterdir()), [])

    def test_missing_source(self):
        self.source.unlink()
        with self.assertRaises(FileNotFoundError):
            self.publish()
        self.withdraw()
        self.assertFalse(self.live.exists())

    def test_wrong_scope_and_broken_bundles(self):
        dsn = self.grant["connectionString"]
        for patch in [dict(taskId=183), dict(taskId=True), dict(companyId="other"),
                      dict(connectionString=dsn.replace(delivery.PREPARER, "postgres")),
                      dict(connectionString=dsn.replace(delivery.POOLER, "other.invalid")),
                      dict(connectionString=dsn.replace(":5432", ":6543")),
                      dict(connectionString=dsn + "?sslmode=disable")]:
            with self.subTest(patch=list(patch)):
                self.source.write_text(json.dumps({**self.grant, **patch}))
                with self.assertRaises(ValueError):
                    self.publish()
        for raw in [b"{}", b"[]", b"not-json", b"x" * 8193]:
            self.source.write_bytes(raw)
            with self.assertRaises(ValueError):
                self.publish()
        self.assertEqual(list(self.dest.iterdir()), [])

    def test_conflict_preserves_existing_credential(self):
        self.live.write_text("existing")
        with self.assertRaises(FileExistsError):
            self.publish()
        self.withdraw()
        self.assertEqual(self.live.read_text(), "existing")
        self.assertEqual(list(self.dest.iterdir()), [self.live])

    def test_withdraw_preserves_replacement(self):
        self.publish()
        replacement = self.dest / "replacement"
        replacement.write_text("existing replacement")
        replacement.replace(self.live)
        self.withdraw()
        self.assertEqual(self.live.read_text(), "existing replacement")

    def test_wrong_directory_mode(self):
        self.dest.chmod(0o750)
        with self.assertRaises(ValueError):
            self.publish()
        self.assertFalse(self.live.exists())


if __name__ == "__main__":
    unittest.main()
