#!/usr/bin/env python3
"""Task183 root-custody sign-once supervisor candidate; NOT a live signer or service.

Only a trusted, separately authenticated root-owned broker may call run().
Do not expose this method directly to any untrusted Unix socket or HTTP client.
The signer callback must be provided by the root broker after independent
Owner verification. An unresolved reservation NEVER calls the signer again.
"""
import base64
import hashlib
import importlib.util
import re
import sqlite3
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("task183_custody", HERE / "task183-dormant-signature-custody.py")
CUSTODY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CUSTODY)
HEX = re.compile(r"^[0-9a-f]{64}$")
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
SIG = re.compile(r"^[A-Za-z0-9_-]{86}$")


def _fail(code):
    raise ValueError(code)


def _connection(path):
    db = sqlite3.connect(str(path), isolation_level=None, timeout=8)
    db.execute("PRAGMA busy_timeout=8000")
    db.execute("PRAGMA synchronous=FULL")
    db.execute("PRAGMA journal_mode=DELETE")
    return db


def run(*, approval_digest, request_id, evidence_sha256, owner_verified,
        signer_callback, verifier_callback, store=CUSTODY.STORE,
        operational=False, crash_after_sign=False):
    """Root-broker-internal synchronous API. No automatic retry under any failure."""
    path = CUSTODY._guard(store, operational)
    if (not isinstance(approval_digest, str) or not HEX.fullmatch(approval_digest)
        or not isinstance(evidence_sha256, str) or not HEX.fullmatch(evidence_sha256)
        or not isinstance(request_id, str) or not UUID.fullmatch(request_id)):
        _fail("TASK183_BINDING_INVALID")
    if owner_verified is not True or not callable(signer_callback) or not callable(verifier_callback):
        _fail("TASK183_INDEPENDENT_OWNER_AND_CALLBACKS_REQUIRED")
    if not CUSTODY.audit(path=path, operational=operational)["installed"]:
        _fail("TASK183_CUSTODY_NOT_INSTALLED")
    now = int(time.time() * 1000)
    db = _connection(path)
    try:
        db.execute("BEGIN IMMEDIATE")
        prior = db.execute(
            "SELECT request_id,evidence_sha256,state,signature_base64url,signature_sha256 "
            "FROM signature_receipts WHERE approval_digest=?", (approval_digest,)
        ).fetchone()
        if prior is not None:
            if prior[0] != request_id or prior[1] != evidence_sha256:
                _fail("TASK183_REPLAY_BINDING_MISMATCH")
            db.execute("COMMIT")
            if prior[2] == "RESERVED":
                return {"state": "UNRESOLVED_SIGNING", "signerCalled": False,
                        "issuerAuthorized": False, "dispatchPermitted": False}
            if prior[2] != "COMPLETED" or not SIG.fullmatch(prior[3] or "") or (
                hashlib.sha256(prior[3].encode()).hexdigest() != prior[4]
            ) or verifier_callback(prior[3]) is not True:
                _fail("TASK183_STORED_SIGNATURE_INVALID")
            return {"state": "COMPLETED", "signature": prior[3], "signerCalled": False,
                    "issuerAuthorized": False, "dispatchPermitted": False}
        conflicting = db.execute(
            "SELECT 1 FROM signature_receipts WHERE request_id=?", (request_id,)
        ).fetchone()
        if conflicting:
            _fail("TASK183_REQUEST_ALREADY_BOUND")
        db.execute(
            "INSERT INTO signature_receipts "
            "(approval_digest,request_id,evidence_sha256,state,reserved_at_ms) "
            "VALUES (?,?,?,?,?)",
            (approval_digest,request_id,evidence_sha256,"RESERVED",now),
        )
        db.execute("COMMIT")  # Persistent fence BEFORE signing.
        signature = signer_callback()
        if (not isinstance(signature,str) or not SIG.fullmatch(signature)
            or verifier_callback(signature) is not True):
            _fail("TASK183_SIGNATURE_VERIFICATION_FAILED")
        if crash_after_sign:
            raise RuntimeError("SYNTHETIC_CRASH_BEFORE_DURABLE_COMPLETION")
        db.execute("BEGIN IMMEDIATE")
        count = db.execute(
            "UPDATE signature_receipts SET state='COMPLETED',signed_at_ms=?, "
            "signature_base64url=?,signature_sha256=? "
            "WHERE approval_digest=? AND request_id=? AND evidence_sha256=? AND state='RESERVED'",
            (int(time.time() * 1000),signature,hashlib.sha256(signature.encode()).hexdigest(),
             approval_digest,request_id,evidence_sha256),
        ).rowcount
        if count != 1:
            _fail("TASK183_COMPLETION_RACE")
        db.execute("COMMIT")
        return {"state": "COMPLETED", "signature": signature, "signerCalled": True,
                "issuerAuthorized": False, "dispatchPermitted": False}
    except BaseException:
        if db.in_transaction:
            db.execute("ROLLBACK")
        raise
    finally:
        db.close()
