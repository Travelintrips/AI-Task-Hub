"""Reserve one replacement request in an isolated Task 183 recovery transaction.

The function takes BEGIN IMMEDIATE across the decision database and attached custody
database. A reservation is not an approval, a signed claim or a dispatch.
"""
import uuid

SCHEMA = """
CREATE TABLE task183_successor_requests (
    predecessor_id TEXT PRIMARY KEY NOT NULL
        REFERENCES gpt02_task183_owner_recovery_decisions(id),
    request_id TEXT NOT NULL UNIQUE,
    created_at_ms INTEGER NOT NULL
);
CREATE TRIGGER task183_successor_no_delete BEFORE DELETE ON task183_successor_requests
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_SUCCESSOR'); END;
CREATE TRIGGER task183_successor_no_update BEFORE UPDATE ON task183_successor_requests
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_SUCCESSOR'); END;
"""


def reserve(db, previous_request, now_ms):
    """Requires a dedicated idle connection with custody attached as custody."""
    db.execute("BEGIN IMMEDIATE")
    try:
        rows = db.execute("""
            SELECT d.id, d.expires_at_ms
            FROM gpt02_task183_owner_recovery_decisions AS d
            JOIN gpt02_task183_owner_recovery_outbox AS o
              ON o.decision_id = d.id
             AND o.request_id = d.request_id AND o.task_id = d.task_id
             AND o.company_id = d.company_id AND o.claims_sha256 = d.claims_sha256
             AND o.evidence_sha256 = d.evidence_sha256 AND o.nonce = d.nonce
             AND o.owner_subject = d.owner_subject AND o.auth_user_id = d.auth_user_id
             AND o.role_at_decision = d.role_at_decision AND o.auth_method = d.auth_method
             AND o.recorded_at_ms = d.recorded_at_ms AND o.expires_at_ms = d.expires_at_ms
            WHERE d.request_id = ? AND d.task_id = 183 AND d.company_id = 'default'
              AND (SELECT count(*) FROM gpt02_task183_owner_recovery_decisions) = 1
              AND (SELECT count(*) FROM gpt02_task183_owner_recovery_outbox) = 1
        """, (previous_request,)).fetchall()
        if len(rows) != 1 or now_ms < rows[0][1]:
            raise ValueError("EXPIRED_MATCHING_PREDECESSOR_REQUIRED")
        if db.execute("SELECT 1 FROM custody.signature_receipts LIMIT 1").fetchone():
            raise ValueError("SIGNER_RESERVATION_OR_RECEIPT_EXISTS")
        request_id = str(uuid.uuid4())
        if request_id == previous_request:
            raise ValueError("REQUEST_ID_COLLISION")
        db.execute("INSERT INTO task183_successor_requests VALUES (?, ?, ?)",
                   (rows[0][0], request_id, now_ms))
        db.commit()
        return request_id
    except BaseException:
        db.rollback()
        raise
