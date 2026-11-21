#!/usr/bin/env python3
"""Dormant, isolated one-use signature envelope fence for Task183 DEV.

NOT a signer, an approval action or issuer dispatch. The callback is supplied
by a caller that independently validates actual signed Owner approval; no
real callback is wired here. This contract demonstrates one durable signature
per exact approval digest even under concurrent requests.
"""
import hashlib,json,re,sqlite3,time
from pathlib import Path

HEX=re.compile(r'^[0-9a-f]{64}$')
SIG=re.compile(r'^[A-Za-z0-9_-]{86}$')
STORE='/var/lib/cst-dev-task183-recovery/owner-signature-envelopes.sqlite3'
def fail(code):raise ValueError(code)

def issue_once(*,store,approval_digest,request_id,evidence_sha256,
               signer_callback,approval_verified,now_ms=None,fixture_only=True):
    if not fixture_only:fail('OPERATIONAL_SIGNING_NOT_WIRED')
    store=Path(store)
    if (not str(store).startswith('/tmp/') or
        not store.parent.name.startswith('task183-once-envelope-fixture-') or
        store.name!='synthetic-signatures.sqlite' or store.is_symlink()):
        fail('ISOLATED_SIGNER_OUTBOX_ONLY')
    if (not all(type(x) is str and HEX.fullmatch(x) for x in
        (approval_digest,evidence_sha256)) or
        type(request_id) is not str or not re.fullmatch(r'[a-f0-9]{36}',request_id)):
        fail('INVALID_SIGNING_SCOPE')
    if approval_verified is not True:fail('SIGNED_OWNER_DECISION_NOT_VERIFIED')
    if not callable(signer_callback):fail('SIGNER_CALLBACK_NOT_TRUSTED')
    now_ms=int(time.time()*1000) if now_ms is None else int(now_ms)
    db=sqlite3.connect(str(store),isolation_level=None,timeout=8,check_same_thread=False)
    try:
        db.execute('PRAGMA busy_timeout=8000')
        db.execute('BEGIN IMMEDIATE')
        db.execute("""CREATE TABLE IF NOT EXISTS signature_envelopes (
            approval_digest TEXT PRIMARY KEY,
            request_id TEXT NOT NULL UNIQUE,
            evidence_sha256 TEXT NOT NULL,
            signature TEXT NOT NULL,
            signature_sha256 TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            signer_verification TEXT NOT NULL CHECK(signer_verification='VERIFIED_TEST_ONLY'),
            issuer_authorized INTEGER NOT NULL DEFAULT 0 CHECK(issuer_authorized=0),
            dispatch_permitted INTEGER NOT NULL DEFAULT 0 CHECK(dispatch_permitted=0)
        )""")
        db.execute("""CREATE TRIGGER IF NOT EXISTS envelopes_immutable_update
            BEFORE UPDATE ON signature_envelopes
            BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SIGNATURE_ENVELOPE'); END""")
        db.execute("""CREATE TRIGGER IF NOT EXISTS envelopes_immutable_delete
            BEFORE DELETE ON signature_envelopes
            BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SIGNATURE_ENVELOPE'); END""")
        old=db.execute('SELECT request_id,evidence_sha256,signature,signature_sha256 FROM signature_envelopes WHERE approval_digest=?',
                       (approval_digest,)).fetchone()
        if old is not None:
            if old[0]!=request_id or old[1]!=evidence_sha256:fail('REPLAY_SCOPE_DRIFT')
            db.execute('COMMIT')
            return {'created':False,'approvalDigest':approval_digest,
                    'signature':old[2],'signatureSha256':old[3],
                    'issuerAuthorized':False,'dispatchPermitted':False}
        same_request=db.execute('SELECT approval_digest FROM signature_envelopes WHERE request_id=?',
                                (request_id,)).fetchone()
        if same_request is not None and same_request[0]!=approval_digest:
            fail('SAME_REQUEST_DIFFERENT_APPROVAL_DIGEST_DENIED')
        result=signer_callback()
        if (type(result) is not dict or set(result)!={'signature','verified'} or
            result['verified'] is not True or type(result['signature']) is not str
            or not SIG.fullmatch(result['signature'])):
            fail('SIGNATURE_CALLBACK_EVIDENCE_INVALID')
        signed=result['signature']
        sha=hashlib.sha256(signed.encode()).hexdigest()
        db.execute('INSERT INTO signature_envelopes VALUES(?,?,?,?,?,?,?,0,0)',
                   (approval_digest,request_id,evidence_sha256,signed,sha,
                    now_ms,'VERIFIED_TEST_ONLY'))
        db.execute('COMMIT')
        return {'created':True,'approvalDigest':approval_digest,
                'signature':signed,'signatureSha256':sha,
                'issuerAuthorized':False,'dispatchPermitted':False}
    except:
        if db.in_transaction:db.execute('ROLLBACK')
        raise
    finally:db.close()
