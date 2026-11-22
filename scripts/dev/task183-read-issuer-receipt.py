"""Read a currently usable, verified Task 183 receipt. Never grants issuer rights."""
import hashlib
import json
import re
import runpy
import sqlite3
import stat
import time
from pathlib import Path

ROOT = Path('/opt/ai-coding-standalone-dev/qa')
CUSTODY = Path('/var/lib/cst-dev-task183-recovery/signature-custody.sqlite3')


def checked_module(name):
    path = ROOT / name
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid or info.st_gid or stat.S_IMODE(info.st_mode) != 0o400:
        raise ValueError('UNTRUSTED_MODULE')
    return runpy.run_path(str(path))


def read_receipt(request_id):
    if not re.fullmatch('[a-f0-9]{36}', request_id):
        raise ValueError('INVALID_REQUEST')
    proof = checked_module('task183-resolve-approved-claims.readonly.candidate.py')['reconstruct'](request_id=request_id)
    claims, digest = proof['claims'], proof['claimsSha256']
    if proof['decisionProvenanceVerified'] is not True or claims['requestId'] != request_id:
        raise ValueError('OWNER_PROVENANCE_REQUIRED')
    info = CUSTODY.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid or info.st_mode & 0o022:
        raise ValueError('UNTRUSTED_RECEIPT_STORE')
    db = sqlite3.connect(CUSTODY.as_uri()+'?mode=ro', uri=True, timeout=2)
    try:
        rows = db.execute("""SELECT signature_base64url, signed_at_ms FROM signature_receipts
            WHERE request_id=? AND evidence_sha256=? AND approval_digest=? AND state='COMPLETED'
            AND issuer_authorized=0 AND dispatch_permitted=0""",
            (request_id, claims['evidenceSha256'], hashlib.sha256(('recovery-approval\n'+digest).encode()).hexdigest())).fetchall()
    finally:
        db.close()
    if len(rows) != 1:
        raise ValueError('COMPLETED_MATCHING_RECEIPT_REQUIRED')
    signature, signed = rows[0]
    verify = checked_module('task183-pinned-approval-verifier.candidate.py')['verify']
    if not verify(role='recovery-approval', digest=digest, request_id=request_id,
                  evidence_sha256=claims['evidenceSha256'], claims=claims, signature=signature):
        raise ValueError('INVALID_OWNER_SIGNATURE')
    if not claims['issuedAt'] <= signed <= time.time_ns()//1000000 < claims['expiresAt']:
        raise ValueError('OWNER_RECEIPT_EXPIRED_OR_INVALID')
    return {'claims':claims, 'digest':digest, 'signature':signature}


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('request_id')
    args = parser.parse_args()
    try:
        read_receipt(args.request_id)
    except ValueError as error:
        print(json.dumps({'eligible':False, 'reason':str(error)}))
        raise SystemExit(2)
    print(json.dumps({'eligible':True, 'issuerAuthorized':False}))
