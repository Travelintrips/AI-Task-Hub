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
    return {'claims':claims, 'digest':digest, 'signature':signature, 'signedAt':signed}


def record_receipt(request_id):
    """Register a verified receipt through the separately provisioned DEV service."""
    proof = read_receipt(request_id)
    claims = proof['claims']
    import psycopg
    with psycopg.connect(service='cst_dev_task183_receipt_verifier', connect_timeout=5) as db:
        # An active, short-lived independent login is mandatory. Never use
        # the application's ordinary PostgreSQL role or a privileged fallback.
        role = db.execute("""
            SELECT session_user = 'gpt02_task183_verifier_login'
                AND current_user = 'gpt02_task183_verifier_login'
                AND rolcanlogin AND rolconnlimit = 1
                AND NOT (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb)
                AND pg_has_role(session_user, 'gpt02_task183_receipt_verifier', 'SET')
            FROM pg_roles WHERE rolname = session_user
        """).fetchone()
        if role != (True,):
            raise ValueError('DEDICATED_VERIFIER_LOGIN_REQUIRED')
        db.execute('SET LOCAL ROLE gpt02_task183_receipt_verifier')
        # Receipt insertion is DENIED until a separately approved DBA
        # provisioning step explicitly installs both column grants and RLS.
        permissions = db.execute("""
            SELECT current_user = 'gpt02_task183_receipt_verifier'
                AND has_schema_privilege(current_user, 'gpt02_stage', 'USAGE')
                -- Only the five explicitly approved INSERT columns are
                -- granted. Table-wide INSERT is intentionally forbidden.
                AND NOT has_table_privilege(
                    current_user, 'gpt02_stage.task183_verified_recovery_receipts', 'INSERT')
                AND has_column_privilege(
                    current_user, 'gpt02_stage.task183_verified_recovery_receipts', 'request_id', 'INSERT')
                AND has_column_privilege(
                    current_user, 'gpt02_stage.task183_verified_recovery_receipts', 'approval_sha256', 'INSERT')
                AND has_column_privilege(
                    current_user, 'gpt02_stage.task183_verified_recovery_receipts', 'predecessor_attempt_id', 'INSERT')
                AND has_column_privilege(
                    current_user, 'gpt02_stage.task183_verified_recovery_receipts', 'signed_at', 'INSERT')
                AND has_column_privilege(
                    current_user, 'gpt02_stage.task183_verified_recovery_receipts', 'expires_at', 'INSERT')
                AND NOT (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb)
            FROM pg_roles WHERE rolname = current_user
        """).fetchone()
        if permissions != (True,):
            raise ValueError('VERIFIER_RECEIPT_INSERT_NOT_GRANTED')
        # Repeat the approval-window test on the PostgreSQL server at the
        # actual INSERT statement, not only before opening the SQL session.
        # A 120-second decision may expire during TLS, login or role checks.
        # INSERT...SELECT uses exactly the existing five column grants;
        # RETURNING would require additional SELECT rights, so use rowcount.
        inserted = db.execute("""
            INSERT INTO gpt02_stage.task183_verified_recovery_receipts
                (request_id, approval_sha256, predecessor_attempt_id, signed_at, expires_at)
            SELECT %s, %s, %s,
                   to_timestamp(%s::bigint/1000.0),
                   to_timestamp(%s::bigint/1000.0)
             WHERE to_timestamp(%s::bigint/1000.0) <= clock_timestamp()
               AND clock_timestamp() < to_timestamp(%s::bigint/1000.0)
        """, (request_id, proof['digest'], claims['originalAttemptId'], proof['signedAt'],
              claims['expiresAt'], proof['signedAt'], claims['expiresAt']))
        if inserted.rowcount != 1:
            raise ValueError('OWNER_RECEIPT_EXPIRED_BEFORE_INSERT')


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('request_id')
    parser.add_argument('--record', action='store_true')
    args = parser.parse_args()
    try:
        if args.record:
            record_receipt(args.request_id)
        else:
            read_receipt(args.request_id)
    except ValueError as error:
        print(json.dumps({'eligible':False, 'reason':str(error)}))
        raise SystemExit(2)
    print(json.dumps({'eligible':True, 'receiptRecorded':args.record, 'issuerAuthorized':False}))
