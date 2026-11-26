#!/usr/bin/env python3
"""Task183 crash-safe signer admission candidate: isolated fixture only.

A durable RESERVED row is committed before the signing callback. Any crash,
timeout or callback failure leaves that row UNRESOLVED and a retry NEVER signs.
Only an independently verified callback can advance it to COMPLETED.
This sacrifices automatic retry in favor of signer-at-most-once semantics.
No real signer, keys, approval, issuer or worker are ever activated here.
"""
from __future__ import annotations
import hashlib,re,sqlite3,time
from pathlib import Path

HEX=re.compile(r'^[a-f0-9]{64}$')
REQ=re.compile(r'^[a-f0-9]{36}$')
SIG=re.compile(r'^[A-Za-z0-9_-]{86}$')
TABLE='task183_signing_outbox'
def deny(reason):raise ValueError(reason)

def _guard_path(path):
    p=Path(path)
    if (not str(p).startswith('/tmp/') or
        not p.parent.name.startswith('task183-crash-fence-fixture-') or
        p.name!='synthetic-durable-signatures.sqlite' or p.is_symlink()):
        deny('LIVE_SIGNER_OUTBOX_NOT_AUTHORIZED')
    return p

def _connect(path):
    c=sqlite3.connect(str(path),timeout=8,isolation_level=None,check_same_thread=False)
    c.execute('PRAGMA busy_timeout=8000')
    c.execute('PRAGMA synchronous=FULL')
    c.execute('PRAGMA journal_mode=DELETE')
    c.execute('PRAGMA foreign_keys=ON')
    return c

def create_fixture_schema(path):
    path=_guard_path(path)
    c=_connect(path)
    try:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS task183_signing_outbox (
         approval_digest TEXT PRIMARY KEY CHECK(length(approval_digest)=64),
         request_id TEXT NOT NULL UNIQUE CHECK(length(request_id)=36),
         evidence_sha256 TEXT NOT NULL CHECK(length(evidence_sha256)=64),
         signer_state TEXT NOT NULL CHECK(signer_state IN ('RESERVED','COMPLETED')),
         reserved_at_ms INTEGER NOT NULL,
         signed_at_ms INTEGER,
         signature TEXT,
         signature_sha256 TEXT,
         issuer_authorized INTEGER NOT NULL DEFAULT 0 CHECK(issuer_authorized=0),
         dispatch_permitted INTEGER NOT NULL DEFAULT 0 CHECK(dispatch_permitted=0),
         CHECK ((signer_state='RESERVED' AND signed_at_ms IS NULL
              AND signature IS NULL AND signature_sha256 IS NULL)
             OR (signer_state='COMPLETED' AND signed_at_ms IS NOT NULL
              AND signature IS NOT NULL AND signature_sha256 IS NOT NULL))
        );
        CREATE TRIGGER IF NOT EXISTS signing_no_delete
          BEFORE DELETE ON task183_signing_outbox
          BEGIN SELECT RAISE(ABORT,'SIGNING_OUTBOX_APPEND_ONLY'); END;
        CREATE TRIGGER IF NOT EXISTS signing_no_illegal_update
          BEFORE UPDATE ON task183_signing_outbox
          WHEN NOT (
            OLD.signer_state='RESERVED' AND NEW.signer_state='COMPLETED'
            AND OLD.approval_digest=NEW.approval_digest
            AND OLD.request_id=NEW.request_id
            AND OLD.evidence_sha256=NEW.evidence_sha256
            AND OLD.reserved_at_ms=NEW.reserved_at_ms
            AND NEW.signature IS NOT NULL AND NEW.signature_sha256 IS NOT NULL
            AND NEW.signed_at_ms>=OLD.reserved_at_ms
            AND NEW.issuer_authorized=0 AND NEW.dispatch_permitted=0)
          BEGIN SELECT RAISE(ABORT,'INVALID_SIGNING_STATE_TRANSITION'); END;
        """)
    finally:c.close()

def _read(c,digest,request_id,evidence_sha256):
    row=c.execute('SELECT request_id,evidence_sha256,signer_state,signature,signature_sha256 '
                  'FROM task183_signing_outbox WHERE approval_digest=?',(digest,)).fetchone()
    if row is None:
        other=c.execute('SELECT approval_digest FROM task183_signing_outbox WHERE request_id=?',
                        (request_id,)).fetchone()
        if other is not None:deny('REQUEST_ALREADY_BOUND_TO_ANOTHER_DIGEST')
        return None
    if row[0]!=request_id or row[1]!=evidence_sha256:
        deny('SIGNER_OUTBOX_REPLAY_BINDING_MISMATCH')
    return row

def _receipt(row):
    if row[2]=='RESERVED':
        return {'state':'UNRESOLVED_SIGNING','signed':False,'replaySafe':True,
                'issuerAuthorized':False,'dispatchPermitted':False}
    return {'state':'COMPLETED','signed':True,'signature':row[3],
            'signatureSha256':row[4],'replaySafe':True,
            'issuerAuthorized':False,'dispatchPermitted':False}

def sign_at_most_once(*,store,approval_digest,request_id,evidence_sha256,
                      signed_owner_decision,signer_callback,
                      verify_callback,now_ms=None,fixture_only=True,
                      simulate_crash_after_signature=False):
    if fixture_only is not True:deny('OPERATIONAL_SIGNER_IS_NOT_WIRED')
    path=_guard_path(store)
    now_ms=int(time.time()*1000) if now_ms is None else now_ms
    if (not all(type(v) is str and HEX.fullmatch(v) for v in
                (approval_digest,evidence_sha256))
        or type(request_id) is not str or not REQ.fullmatch(request_id)):
        deny('INVALID_SIGNER_SCOPE')
    if signed_owner_decision is not True:deny('PERSISTED_EXPLICIT_OWNER_DECISION_REQUIRED')
    if not callable(signer_callback) or not callable(verify_callback):
        deny('INDEPENDENT_SIGN_AND_VERIFY_CALLBACKS_REQUIRED')
    c=_connect(path)
    try:
        c.execute('BEGIN IMMEDIATE')
        state=_read(c,approval_digest,request_id,evidence_sha256)
        if state is not None:
            c.execute('COMMIT')
            return _receipt(state)
        c.execute('INSERT INTO task183_signing_outbox '
                  '(approval_digest,request_id,evidence_sha256,signer_state,reserved_at_ms) '
                  'VALUES (?,?,?,?,?)',
                  (approval_digest,request_id,evidence_sha256,'RESERVED',now_ms))
        c.execute('COMMIT')  # Durable write-ahead before ANY signer invocation.
        # Never sign again if an earlier attempt crashed between signing and
        # recording the signature. The unresolved row needs manual review.
        result=signer_callback()
        if type(result) is not dict or set(result)!={'signature'} or not isinstance(result['signature'],str):
            deny('SIGNER_CALLBACK_RESPONSE_INVALID')
        signed=result['signature']
        if not SIG.fullmatch(signed) or verify_callback(signed) is not True:
            deny('INDEPENDENT_SIGNATURE_VERIFICATION_FAILED')
        if simulate_crash_after_signature:
            raise RuntimeError('SYNTHETIC_CRASH_AFTER_SIGNING_BEFORE_RECEIPT')
        sha=hashlib.sha256(signed.encode()).hexdigest()
        c.execute('BEGIN IMMEDIATE')
        cur=c.execute("UPDATE task183_signing_outbox SET signer_state='COMPLETED', "
                      "signed_at_ms=?, signature=?, signature_sha256=? "
                      "WHERE approval_digest=? AND signer_state='RESERVED'",
                      (now_ms,signed,sha,approval_digest))
        if cur.rowcount!=1:deny('SIGNER_RECEIPT_RACE_DENIED')
        c.execute('COMMIT')
        return {'state':'COMPLETED','signed':True,'signature':signed,
                'signatureSha256':sha,'replaySafe':True,
                'issuerAuthorized':False,'dispatchPermitted':False}
    except:
        if c.in_transaction:c.execute('ROLLBACK')
        raise
    finally:c.close()

def status(*,store,approval_digest,request_id,evidence_sha256):
    path=_guard_path(store)
    c=_connect(path)
    try:
        state=_read(c,approval_digest,request_id,evidence_sha256)
        if state is None:return {'state':'NO_SIGNING_ATTEMPT','signed':False,
                                 'issuerAuthorized':False,'dispatchPermitted':False}
        return _receipt(state)
    finally:c.close()
