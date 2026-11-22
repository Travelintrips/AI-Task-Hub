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
        db.executescript("""
            ATTACH ':memory:' AS review;
            CREATE TABLE review.reviews(request_id, company_id, hub_task_id, requested_by,
                status, owner_approval_granted, issuer_grant, dispatch_permitted);
            CREATE TABLE review.recovery_consent_intents(request_id, actor_id, evidence_sha256,
                state, signed_owner_approval, issuer_authority, nonce_issuer_consumed,
                attempt_issued, dispatch_permitted);
        """)
        db.execute("INSERT INTO review.reviews VALUES (?, 'default', 183, 7, ?, 0, 0, 0)",
                   (REQUEST, "PENDING_INDEPENDENT_OWNER_REVIEW"))
        db.execute("INSERT INTO review.recovery_consent_intents VALUES (?, 7, ?, ?, 0, 0, 0, 0, 0)",
                   (REQUEST, "e"*64, "SUPERADMIN_RECOVERY_INTENT_PENDING_INDEPENDENT_ISSUER"))
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

    def test_used_or_ambiguous_review(self):
        for statement in (
            "UPDATE review.reviews SET issuer_grant = 1",
            "UPDATE review.recovery_consent_intents SET nonce_issuer_consumed = 1",
            "UPDATE review.recovery_consent_intents SET attempt_issued = 1",
            "UPDATE review.recovery_consent_intents SET evidence_sha256 = 'different'",
            "INSERT INTO review.recovery_consent_intents SELECT * FROM review.recovery_consent_intents",
        ):
            with self.subTest(statement=statement):
                self.db.execute(statement)
                self.db.commit()
                with self.assertRaisesRegex(ValueError, "UNUSED_MATCHING_REVIEW_REQUIRED"):
                    reserve(self.db, REQUEST, 201)
                self.assertEqual(self.db.execute("SELECT count(*) FROM task183_successor_requests").fetchone(), (0,))
                self.db.execute("UPDATE review.reviews SET issuer_grant = 0")
                self.db.execute("UPDATE review.recovery_consent_intents SET nonce_issuer_consumed=0, attempt_issued=0, evidence_sha256=?", ("e"*64,))
                self.db.commit()

    def test_unreadable_custody(self):
        self.db.execute("DETACH custody")
        with self.assertRaises(sqlite3.OperationalError):
            reserve(self.db, REQUEST, 201)
        self.assertEqual(self.db.execute("SELECT count(*) FROM task183_successor_requests").fetchone(), (0,))


if __name__ == "__main__":
    unittest.main()
