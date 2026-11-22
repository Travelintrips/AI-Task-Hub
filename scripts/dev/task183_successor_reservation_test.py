import runpy
import sqlite3
import unittest
from pathlib import Path

from task183_successor_reservation import SCHEMA, reserve

HERE = Path(__file__).resolve().parent
REQUEST = "a" * 36


class ReservationTest(unittest.TestCase):
    def setUp(self):
        db = self.db = sqlite3.connect(":memory:")
        self.addCleanup(db.close)
        db.executescript(runpy.run_path(str(HERE / "task183-install-dormant-owner-approval-schema.py"))["DDL"])
        db.executescript(SCHEMA)
        db.execute("ATTACH ':memory:' AS custody")
        db.execute("CREATE TABLE custody.signature_receipts(state TEXT)")
        common = (183, REQUEST, "default", "e"*64, "a"*64, "owner:test",
                  "n"*32, "actor", "super_admin", "supabase_admin_session")
        db.execute("INSERT INTO gpt02_task183_owner_recovery_decisions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                   ("decision", *common, "APPROVE_RECOVERY_ATTEMPT2_ONLY", 100, 200))
        db.execute("INSERT INTO gpt02_task183_owner_recovery_outbox VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                   ("outbox", "decision", *common, 100, 200))
        db.commit()

    def test_single_successor_preserves_history(self):
        self.assertNotEqual(reserve(self.db, REQUEST, 200), REQUEST)
        with self.assertRaises(sqlite3.IntegrityError):
            reserve(self.db, REQUEST, 201)
        for table in ("gpt02_task183_owner_recovery_decisions",
                      "gpt02_task183_owner_recovery_outbox", "task183_successor_requests"):
            self.assertEqual(self.db.execute("SELECT count(*) FROM " + table).fetchone(), (1,))

    def test_active_or_wrong_request(self):
        for request, now in ((REQUEST, 199), ("wrong", 201)):
            with self.assertRaises(ValueError):
                reserve(self.db, request, now)

    def test_any_signer_activity_blocks(self):
        for state in ("RESERVED", "COMPLETED"):
            self.db.execute("INSERT INTO custody.signature_receipts VALUES (?)", (state,))
            self.db.commit()
            with self.assertRaises(ValueError):
                reserve(self.db, REQUEST, 201)
            self.db.execute("DELETE FROM custody.signature_receipts")
            self.db.commit()

    def test_unreadable_custody(self):
        self.db.execute("DETACH custody")
        with self.assertRaises(sqlite3.OperationalError):
            reserve(self.db, REQUEST, 201)
        self.assertEqual(self.db.execute("SELECT count(*) FROM task183_successor_requests").fetchone(), (0,))


if __name__ == "__main__":
    unittest.main()
