#!/usr/bin/env python3
"""Task183 TWO-PHASE signing admission candidate. Fixture only, never live.

Design: signer keeps its Ed25519 key; isolated trusted broker first durably
reserves one digest, then signer signs once, then broker verifies and completes.
If signer crashes after reservation, subsequent admission is UNRESOLVED_SIGNING.
No root broker access to a private signing key is required.
"""
import hashlib
import importlib.util
import re
import sqlite3
import time
from pathlib import Path

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("task183_custody",HERE/"task183-dormant-signature-custody.py")
custody=importlib.util.module_from_spec(spec);spec.loader.exec_module(custody)
HEX=re.compile(r"^[a-f0-9]{64}$")
REQ=re.compile(r"^(?:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|[a-f0-9]{36})$")
SIGNATURE=re.compile(r"^[A-Za-z0-9_-]{86}$")

def reject(reason):raise ValueError(reason)

class TwoPhase:
    def __init__(self, store, *, fixture_only=True):
        self.store=Path(store)
        self.operational=(fixture_only is False)
        if type(fixture_only) is not bool:
            reject("EXPLICIT_OPERATIONAL_OR_FIXTURE_MODE_REQUIRED")
        if self.operational:
            # Exact root-owned CST-DEV custody only; never user-chosen paths.
            if self.store!=custody.STORE:
                reject("PINNED_ROOT_CUSTODY_REQUIRED")
            custody._guard(self.store,operational=True)
        elif (not str(self.store).startswith("/tmp/task183-two-phase-fixture-")
              or self.store.is_symlink()):
            reject("FIXTURE_STORE_REQUIRED")
        if not custody.audit(path=self.store,operational=self.operational)["installed"]:
            reject("CUSTODY_NOT_INSTALLED")

    def _db(self):
        # Repeat root custody checks before EVERY database connection.
        if self.operational:
            custody._guard(self.store,operational=True)
            custody.audit(path=self.store,operational=True)
        db=sqlite3.connect(str(self.store), timeout=8, isolation_level=None)
        db.execute("PRAGMA busy_timeout=8000")
        db.execute("PRAGMA journal_mode=DELETE")
        db.execute("PRAGMA synchronous=FULL")
        return db

    @staticmethod
    def _validate(digest,request,evidence):
        if not isinstance(digest,str) or not HEX.fullmatch(digest):
            reject("INVALID_APPROVAL_DIGEST")
        if not isinstance(request,str) or not REQ.fullmatch(request):
            reject("INVALID_REQUEST_ID")
        if not isinstance(evidence,str) or not HEX.fullmatch(evidence):
            reject("INVALID_EVIDENCE_SHA256")

    def reserve(self, *, digest, request, evidence, independent_owner_readback):
        self._validate(digest,request,evidence)
        if independent_owner_readback is not True:
            reject("INDEPENDENT_SIGNED_OWNER_DECISION_REQUIRED")
        db=self._db()
        try:
            db.execute("BEGIN IMMEDIATE")
            prior=db.execute("SELECT request_id,evidence_sha256,state FROM signature_receipts WHERE approval_digest=?",(digest,)).fetchone()
            if prior:
                if (prior[0],prior[1])!=(request,evidence):
                    reject("REPLAY_BINDING_MUTATION")
                db.execute("COMMIT")
                return {"state": "UNRESOLVED_SIGNING" if prior[2]=="RESERVED" else "COMPLETED",
                        "signingPermitted":False,"issuerAuthorized":False,"dispatchPermitted":False}
            if db.execute("SELECT 1 FROM signature_receipts WHERE request_id=?",(request,)).fetchone():
                reject("REQUEST_ALREADY_BOUND_TO_OTHER_DIGEST")
            db.execute("INSERT INTO signature_receipts(approval_digest,request_id,evidence_sha256,state,reserved_at_ms) VALUES(?,?,?,?,?)",
                       (digest,request,evidence,"RESERVED",int(time.time()*1000)))
            db.execute("COMMIT")
            return {"state":"RESERVED","signingPermitted":True,"issuerAuthorized":False,"dispatchPermitted":False}
        except BaseException:
            if db.in_transaction:db.execute("ROLLBACK")
            raise
        finally:db.close()

    def complete(self, *, digest, request, evidence, signature, independent_signature_verify):
        self._validate(digest,request,evidence)
        if (not isinstance(signature,str) or not SIGNATURE.fullmatch(signature)
            or not callable(independent_signature_verify)
            or independent_signature_verify(signature) is not True):
            reject("SIGNED_EVIDENCE_NOT_INDEPENDENTLY_VERIFIED")
        db=self._db()
        try:
            db.execute("BEGIN IMMEDIATE")
            row=db.execute("SELECT request_id,evidence_sha256,state,signature_base64url,signature_sha256,reserved_at_ms FROM signature_receipts WHERE approval_digest=?",(digest,)).fetchone()
            if not row or (row[0],row[1])!=(request,evidence):
                reject("NO_MATCHING_DURABLE_RESERVATION")
            sha=hashlib.sha256(signature.encode()).hexdigest()
            if row[2]=="COMPLETED":
                if (row[3],row[4])!=(signature,sha):
                    reject("COMPLETED_SIGNATURE_IMMUTABLE")
                db.execute("COMMIT")
                return {"state":"COMPLETED","newCompletion":False,"issuerAuthorized":False,"dispatchPermitted":False}
            if row[2]!="RESERVED":
                reject("RESERVATION_STATE_INVALID")
            # WARNING: only a broker that binds the signer process to its single
            # in-flight reservation may invoke complete. This is a fixture API.
            done_at=max(int(time.time()*1000),row[5])
            cur=db.execute("UPDATE signature_receipts SET state='COMPLETED',signed_at_ms=?,signature_base64url=?,signature_sha256=? WHERE approval_digest=? AND state='RESERVED'",
                           (done_at,signature,sha,digest))
            if cur.rowcount!=1:reject("SIGNATURE_COMPLETION_CONFLICT")
            db.execute("COMMIT")
            return {"state":"COMPLETED","newCompletion":True,"issuerAuthorized":False,"dispatchPermitted":False}
        except BaseException:
            if db.in_transaction:db.execute("ROLLBACK")
            raise
        finally:db.close()
