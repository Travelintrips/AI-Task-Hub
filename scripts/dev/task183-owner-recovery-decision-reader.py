#!/usr/bin/env python3
"""Task183 independent Owner recovery decision reader, read-only.

NOT a signer or approval writer. Operational mode pins the existing
root-owned GPT02 approval SQLite database. No tables are created. Missing
decision/outbox is NO-GO. Never trust the human review/intent queue as
a signed Owner approval.
"""
from __future__ import annotations
import re,sqlite3,os,stat,time

DB='/opt/ai-coding-standalone-dev/tasks.db'
REQUEST='6bcd8419254dc21c0b149eb09e68a7b6da66'
EVIDENCE='89950d3b8ac91aac612810325c6a219cb898a6fa41b234a477f0dbe32d85eb7b'
SHA=re.compile(r'^[a-f0-9]{64}$')
NONCE=re.compile(r'^[A-Za-z0-9_-]{32,128}$')
SUBJECT=re.compile(r'^owner:[A-Za-z0-9_-]{4,120}$')

def denied(reason):
    return {'ok':False,'environment':'DEV','source':
      'task183-independent-recovery-approval-reader','reason':reason,
      'readOnly':True,'releaseDecision':'NO_GO',
      'signatureVerified':False,'persistedIndependentOwnerDecision':False,
      'issuerAuthorizationGranted':False,'dispatchPermitted':False}

def verify_lookup(x,now):
    return (type(x) is dict and set(x)=={
      'claimsSha256','taskId','requestId','evidenceSha256',
      'ownerSubject','nonce','observedAt'} and
      type(x['claimsSha256']) is str and SHA.fullmatch(x['claimsSha256']) and
      x['taskId']==183 and type(x['taskId']) is int and
      x['requestId']==REQUEST and x['evidenceSha256']==EVIDENCE and
      type(x['ownerSubject']) is str and SUBJECT.fullmatch(x['ownerSubject']) and
      type(x['nonce']) is str and NONCE.fullmatch(x['nonce']) and
      type(x['observedAt']) is int and abs(now-x['observedAt'])<=5000)

def read_decision(lookup, *, db_path=DB, operational=True, now=None):
    now=int(time.time()*1000) if now is None else now
    if operational and db_path!=DB:return denied('PINNED_APPROVAL_DB_REQUIRED')
    if not verify_lookup(lookup,now):return denied('TASK183_EXACT_LOOKUP_REQUIRED')
    try:
        st=os.lstat(db_path)
        if (not stat.S_ISREG(st.st_mode) or stat.S_ISLNK(st.st_mode) or
            (operational and (st.st_uid!=0 or st.st_gid!=0 or stat.S_IMODE(st.st_mode)!=0o600))):
            return denied('APPROVAL_DB_CUSTODY_DENIED')
    except OSError:
        return denied('APPROVAL_DB_MISSING')
    connection=None
    try:
        connection=sqlite3.connect('file:'+db_path+'?mode=ro',uri=True,timeout=2)
        connection.row_factory=sqlite3.Row
        connection.execute('PRAGMA query_only=ON')
        # Both decision and immutable outbox must exist IN SAME DB SNAPSHOT.
        # A signed-in Super Admin *intent* from another queue cannot match.
        rows=connection.execute("""
        SELECT d.id,d.task_id,d.request_id,d.company_id,
               d.evidence_sha256,d.claims_sha256,d.owner_subject,
               d.nonce,d.auth_user_id,d.role_at_decision,d.auth_method,
               d.decision,d.recorded_at_ms,d.expires_at_ms,
               a.enabled AS admin_enabled,a.role AS admin_role,
               l.enabled AS operator_enabled,
               o.id AS outbox_id
          FROM gpt02_task183_owner_recovery_decisions d
          JOIN gpt02_task183_owner_recovery_outbox o
            ON o.decision_id=d.id AND o.task_id=d.task_id
           AND o.request_id=d.request_id AND o.company_id=d.company_id
           AND o.evidence_sha256=d.evidence_sha256
           AND o.claims_sha256=d.claims_sha256
           AND o.owner_subject=d.owner_subject AND o.nonce=d.nonce
           AND o.auth_user_id=d.auth_user_id
           AND o.role_at_decision=d.role_at_decision
           AND o.auth_method=d.auth_method
           AND o.recorded_at_ms=d.recorded_at_ms
           AND o.expires_at_ms=d.expires_at_ms
          JOIN admin_identities a ON a.user_id=d.auth_user_id
          JOIN gpt02_issue159_admin_operator_links l
            ON l.auth_user_id=d.auth_user_id
         WHERE d.task_id=? AND d.company_id='default'
           AND d.request_id=? AND d.evidence_sha256=?
           AND d.claims_sha256=? AND d.owner_subject=?
           AND d.nonce=?
           AND l.hub_operator_id=substr(d.owner_subject,7)
        """, (183,REQUEST,EVIDENCE,lookup['claimsSha256'],
                lookup['ownerSubject'],lookup['nonce'])).fetchall()
        if len(rows)!=1:return denied('PERSISTED_OWNER_DECISION_MISSING_OR_NOT_UNIQUE')
        r=rows[0]
        if (r['decision']!='APPROVE_RECOVERY_ATTEMPT2_ONLY' or
            r['role_at_decision']!='super_admin' or
            r['auth_method']!='supabase_admin_session' or
            r['admin_enabled']!=1 or r['admin_role']!='super_admin' or
            r['operator_enabled']!=1 or r['expires_at_ms']<=now or
            r['recorded_at_ms']>now or
            r['expires_at_ms']-r['recorded_at_ms']>300000):
            return denied('PERSISTED_OWNER_PROVENANCE_OR_EXPIRY_INVALID')
        # Authenticated explicit decision provenance is independently proven,
        # but this reader does NOT sign. The existing delegated signer signs
        # only after receipt of this exact trusted read-back.
        return {'ok':True,'environment':'DEV',
          'reason':'INDEPENDENT_OWNER_SIGNATURE_NOT_VERIFIED',
          'source':'task183-independent-recovery-approval-reader',
          'readOnly':True,'releaseDecision':'NO_GO',
          'claimsSha256':r['claims_sha256'],'requestId':r['request_id'],
          'ownerSubject':r['owner_subject'],'evidenceSha256':r['evidence_sha256'],
          'signatureVerified':False,'persistedIndependentOwnerDecision':True,
          'issuerAuthorizationGranted':False,'dispatchPermitted':False}
    except sqlite3.Error:
        return denied('TASK183_APPROVAL_SCHEMA_OR_READ_UNAVAILABLE')
    finally:
        if connection is not None:connection.close()
