#!/usr/bin/env python3
"""DEV Task183 append-only *request for review*, not recovery authorization.

The record is not an Owner approval, does not sign or create an attempt,
and cannot be used as issuer consent. The active CST-DEV PostgreSQL database
is queried READ ONLY; requests are held in a separate root-owned queue and
must be independently examined before any future release design.
"""
import hashlib
import json
import os
import re
import sqlite3
import stat
import subprocess
import time
from pathlib import Path

DB_PATH = Path("/var/lib/cst-dev-task183-recovery/review-requests.sqlite3")
UUID = re.compile(r"^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$")
REVIEW_STATUS = "PENDING_INDEPENDENT_OWNER_REVIEW"
SOURCE_QUERY = r"""
const {Client}=require('/app/artifacts/api-server/node_modules/pg');
const c=new Client({connectionString:process.env.SUPABASE_DATABASE_URL_DEV,connectionTimeoutMillis:7000,query_timeout:6500,application_name:'task183-recovery-review-intake-readonly'});
(async()=>{
try{
 await c.connect();await c.query('BEGIN READ ONLY');
 await c.query('SET LOCAL statement_timeout=6000');
 const q=await c.query(`
 SELECT p.company_id,p.hub_task_id,p.core_task_id::text,p.hub_execution_id::text,
        p.attempt_id::text,p.command_candidate_id::text,
        (extract(epoch from p.expires_at)*1000)::float8 AS expires_at_ms,
        p.expires_at<clock_timestamp() AS expired,
        (SELECT count(*)::integer FROM gpt02_stage.core_preparations WHERE hub_task_id=183) AS prep_count,
        (SELECT count(*)::integer FROM public.ai_execution_jobs WHERE task_id=183) AS job_count,
        (SELECT count(*)::integer FROM public.ai_execution_jobs e WHERE e.id=p.hub_execution_id AND e.status='prepared' AND e.task_id=183) AS matching_job,
        (SELECT count(*)::integer FROM ai_platform.ai_coding_tasks t WHERE t.id=p.core_task_id AND t.status='PENDING') AS matching_core,
        (SELECT count(*)::integer FROM ai_platform.ai_coding_bridge_commands b WHERE b.task_id=p.core_task_id) AS command_count,
        (SELECT count(*)::integer FROM ai_platform.dev_gpt02_task_attempt_binding_claims b WHERE b.hub_ai_task_id=183) AS binding_count,
        (SELECT count(*)::integer FROM pg_stat_activity WHERE usename='gpt02_core_prep_login') AS preparer_sessions,
        (SELECT NOT rolcanlogin AND rolconnlimit=0 FROM pg_roles WHERE rolname='gpt02_core_prep_login') AS preparer_locked
 FROM gpt02_stage.core_preparations p WHERE p.hub_task_id=183
 `);
 await c.query('ROLLBACK');
 console.log(JSON.stringify(q.rows));
}catch(e){
 console.log(JSON.stringify({error:e.code||'QUERY_FAILED'}));process.exitCode=3;
}finally{await c.end().catch(()=>{})}
})();
"""

def source_readback():
    p=subprocess.run(
      ["docker","exec","ai-task-dev-main-directdb-qa-20261121","node","-e",SOURCE_QUERY],
      capture_output=True,text=True,timeout=24)
    if p.returncode!=0:raise RuntimeError("SOURCE_READ_UNAVAILABLE")
    rows=json.loads(p.stdout)
    if not isinstance(rows,list) or len(rows)!=1:
        raise ValueError("SOURCE_CARDINALITY_MISMATCH")
    return rows[0]

def validate_source(row,now_ms=None):
    now_ms=int(time.time()*1000) if now_ms is None else int(now_ms)
    if not isinstance(row,dict) or set(row)!={
       "company_id","hub_task_id","core_task_id","hub_execution_id",
       "attempt_id","command_candidate_id","expires_at_ms","expired",
       "prep_count","job_count","matching_job","matching_core",
       "command_count","binding_count","preparer_sessions","preparer_locked"}:
        raise ValueError("SOURCE_SHAPE_MISMATCH")
    if row["company_id"]!="default" or row["hub_task_id"]!=183:
        raise ValueError("FOREIGN_SCOPE")
    for k in ("core_task_id","hub_execution_id","attempt_id","command_candidate_id"):
        if not isinstance(row[k],str) or not UUID.fullmatch(row[k]):
            raise ValueError("SOURCE_UUID_INVALID")
    if len({row[k] for k in ("core_task_id","hub_execution_id","attempt_id","command_candidate_id")})!=4:
        raise ValueError("SOURCE_UUID_COLLISION")
    if not isinstance(row["expires_at_ms"],(int,float)) or isinstance(row["expires_at_ms"],bool):
        raise ValueError("SOURCE_EXPIRY_INVALID")
    if not row["expired"] or row["expires_at_ms"]>=now_ms:
        raise ValueError("SOURCE_RESERVATION_STILL_ACTIVE")
    for k in ("prep_count","job_count","matching_job","matching_core"):
        if row[k]!=1 or type(row[k]) is not int:
            raise ValueError("SOURCE_LINEAGE_MISMATCH")
    for k in ("command_count","binding_count","preparer_sessions"):
        if row[k]!=0 or type(row[k]) is not int:
            raise ValueError("SOURCE_ALREADY_CONTINUED_OR_NOT_RELOCKED")
    if row["preparer_locked"] is not True:
        raise ValueError("SOURCE_PREPARER_NOT_RELOCKED")
    return {k:row[k] for k in ("company_id","hub_task_id","core_task_id",
        "hub_execution_id","attempt_id","command_candidate_id","expires_at_ms")}

def record_pending_request(*,actor,source,store_path=DB_PATH,now_ms=None):
    now_ms=int(time.time()*1000) if now_ms is None else int(now_ms)
    if not isinstance(actor,dict) or actor.get("role")!="super_admin" or actor.get("companyId") not in (None,"default") or not isinstance(actor.get("id"),str) or not actor["id"].startswith("google_") or len(actor["id"])>150:
        raise ValueError("SIGNED_GOOGLE_SUPERADMIN_REQUIRED")
    evidence=validate_source(source,now_ms)
    location=Path(store_path)
    if location.exists() and (location.is_symlink() or not location.is_file()):
        raise ValueError("REVIEW_STORE_FILE_UNSAFE")
    if location.parent.is_symlink():raise ValueError("REVIEW_STORE_DIR_UNSAFE")
    # Production path must be root-owned 0700. Test directory is injected
    # directly by the trusted test caller only; request JSON never sets paths.
    if location==DB_PATH:
        location.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
        mode=location.parent.stat()
        if mode.st_uid!=0 or stat.S_IMODE(mode.st_mode)!=0o700:
            raise ValueError("REVIEW_DIR_CUSTODY_INVALID")
    oldmask=os.umask(0o077)
    try:
        db=sqlite3.connect(str(location),timeout=5,isolation_level=None)
    finally:os.umask(oldmask)
    try:
        db.execute("PRAGMA busy_timeout=5000")
        db.execute("PRAGMA journal_mode=DELETE")
        db.execute("""CREATE TABLE IF NOT EXISTS reviews(
          request_id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL CHECK(company_id='default'),
          hub_task_id INTEGER NOT NULL CHECK(hub_task_id=183),
          original_core_task_id TEXT NOT NULL,
          original_hub_job_id TEXT NOT NULL,
          original_attempt_id TEXT NOT NULL,
          original_command_candidate TEXT NOT NULL,
          original_expired_at_ms INTEGER NOT NULL,
          requested_by TEXT NOT NULL,
          requested_at_ms INTEGER NOT NULL,
          status TEXT NOT NULL CHECK(status='PENDING_INDEPENDENT_OWNER_REVIEW'),
          owner_approval_granted INTEGER NOT NULL DEFAULT 0 CHECK(owner_approval_granted=0),
          issuer_grant INTEGER NOT NULL DEFAULT 0 CHECK(issuer_grant=0),
          dispatch_permitted INTEGER NOT NULL DEFAULT 0 CHECK(dispatch_permitted=0),
          UNIQUE(company_id,hub_task_id,original_attempt_id)
        )""")
        db.execute("""CREATE TRIGGER IF NOT EXISTS immutable_reviews_update
          BEFORE UPDATE ON reviews BEGIN SELECT RAISE(ABORT,'IMMUTABLE_REVIEW'); END""")
        db.execute("""CREATE TRIGGER IF NOT EXISTS immutable_reviews_delete
          BEFORE DELETE ON reviews BEGIN SELECT RAISE(ABORT,'IMMUTABLE_REVIEW'); END""")
        if location==DB_PATH:
            os.chmod(location,0o600)
            fstat=location.stat()
            if fstat.st_uid!=0 or stat.S_IMODE(fstat.st_mode)!=0o600:
                raise ValueError("REVIEW_FILE_CUSTODY_INVALID")
        digest=json.dumps({"task":183,"original":evidence["attempt_id"],"purpose":"REVIEW_REQUEST_ONLY"},sort_keys=True,separators=(",",":"))
        request_id=hashlib.sha256(digest.encode()).hexdigest()[:36]
        db.execute("BEGIN IMMEDIATE")
        row=db.execute("SELECT request_id,requested_by,status FROM reviews WHERE company_id='default' AND hub_task_id=183 AND original_attempt_id=?",(evidence["attempt_id"],)).fetchone()
        if row:
            db.execute("ROLLBACK")
            if row[1]!=actor["id"]:raise ValueError("REVIEW_ALREADY_OWNED_BY_ANOTHER_OPERATOR")
            return {"requestId":row[0],"status":row[2],"created":False,"approvalGranted":False,"dispatchPermitted":False,"attemptIssued":False}
        db.execute("""INSERT INTO reviews(
          request_id,company_id,hub_task_id,original_core_task_id,original_hub_job_id,
          original_attempt_id,original_command_candidate,original_expired_at_ms,
          requested_by,requested_at_ms,status)
          VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
          (request_id,"default",183,evidence["core_task_id"],evidence["hub_execution_id"],
           evidence["attempt_id"],evidence["command_candidate_id"],
           int(evidence["expires_at_ms"]),actor["id"],now_ms,REVIEW_STATUS))
        db.execute("COMMIT")
        return {"requestId":request_id,"status":REVIEW_STATUS,"created":True,"approvalGranted":False,"dispatchPermitted":False,"attemptIssued":False}
    except:
        if db.in_transaction:db.execute("ROLLBACK")
        raise
    finally:db.close()

def reserve_renewal_review(db, original_request, expired_request, now_ms):
    """Stage an independent review after a signed successor expires. Grants no authority."""
    db.execute("BEGIN IMMEDIATE")
    try:
        previous = db.execute("""
            SELECT child.id FROM history.task183_successor_requests s
            JOIN history.gpt02_task183_owner_recovery_decisions parent ON parent.id=s.predecessor_id
            JOIN history.gpt02_task183_owner_recovery_decisions child ON child.request_id=s.request_id
            JOIN history.gpt02_task183_owner_recovery_outbox o ON o.decision_id=child.id
            JOIN custody.signature_receipts c ON c.request_id=child.request_id
            JOIN main.reviews r ON r.request_id=parent.request_id
            WHERE parent.request_id=? AND child.request_id=? AND parent.task_id=183
              AND child.task_id=r.hub_task_id AND r.hub_task_id=183
              AND parent.company_id=r.company_id AND child.company_id=r.company_id
              AND r.company_id='default' AND r.owner_approval_granted=0 AND r.issuer_grant=0
              AND r.dispatch_permitted=0 AND child.expires_at_ms<=?
              AND o.request_id=child.request_id AND o.claims_sha256=child.claims_sha256
              AND c.evidence_sha256=child.evidence_sha256 AND c.state='COMPLETED'
              AND c.issuer_authorized=0 AND c.dispatch_permitted=0
              AND NOT EXISTS (SELECT 1 FROM history.task183_successor_requests n
                              WHERE n.predecessor_id=child.id)
        """, (original_request,expired_request,now_ms)).fetchall()
        if len(previous)!=1:
            raise ValueError("EXPIRED_SIGNED_SUCCESSOR_REQUIRED")
        db.execute("""CREATE TABLE IF NOT EXISTS renewal_reviews (
            parent_request TEXT NOT NULL REFERENCES reviews(request_id),
            expired_request TEXT PRIMARY KEY NOT NULL,
            request_id TEXT UNIQUE NOT NULL,
            created_at_ms INTEGER NOT NULL,
            status TEXT NOT NULL CHECK(status='PENDING_INDEPENDENT_OWNER_REVIEW'))""")
        db.execute("""INSERT INTO renewal_reviews VALUES(?,?,lower(hex(randomblob(18))),?,?)
                      ON CONFLICT(expired_request) DO NOTHING""",
                   (original_request,expired_request,now_ms,REVIEW_STATUS))
        row=db.execute("SELECT request_id FROM renewal_reviews WHERE expired_request=?",
                       (expired_request,)).fetchone()
        db.commit()
        return row[0]
    except BaseException:
        db.rollback()
        raise


def get_pending_renewal(actor,expired_request,store_path=DB_PATH):
    """Return the review visible to this Super Admin for the exact expired successor."""
    if actor.get("role")!="super_admin" or not actor.get("id") or actor.get("companyId") not in (None,"default"):
        raise ValueError("SUPER_ADMIN_REQUIRED")
    with sqlite3.connect(Path(store_path).as_uri()+"?mode=ro",uri=True,timeout=3) as db:
        if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='renewal_reviews'").fetchone():
            return None
        row=db.execute("""SELECT n.request_id FROM renewal_reviews n
            JOIN reviews r ON r.request_id=n.parent_request
            WHERE r.hub_task_id=183 AND r.company_id='default' AND r.requested_by=?
            AND n.expired_request=? AND n.status=?""",
            (actor["id"],expired_request,REVIEW_STATUS)).fetchone()
        return row[0] if row else None


def get_status(actor,store_path=DB_PATH):
    if actor.get("role")!="super_admin":raise ValueError("SUPER_ADMIN_REQUIRED")
    loc=Path(store_path)
    if not loc.is_file():return {"requested":False,"status":"NOT_REQUESTED","approvalGranted":False,"dispatchPermitted":False}
    db=sqlite3.connect(f"file:{loc}?mode=ro",uri=True,timeout=3)
    try:
        row=db.execute("SELECT request_id,requested_by,status FROM reviews WHERE company_id='default' AND hub_task_id=183").fetchone()
        if not row:return {"requested":False,"status":"NOT_REQUESTED","approvalGranted":False,"dispatchPermitted":False}
        if row[1]!=actor.get("id"):raise ValueError("REQUEST_NOT_VISIBLE_TO_OTHER_USER")
        result={"requested":True,"requestId":row[0],"status":row[2],"approvalGranted":False,"dispatchPermitted":False}
        if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='renewal_reviews'").fetchone():
            renewal=db.execute("SELECT request_id,status FROM renewal_reviews WHERE parent_request=? ORDER BY created_at_ms DESC LIMIT 1",(row[0],)).fetchone()
            if renewal:
                result["renewalReview"]={"requestId":renewal[0],"status":renewal[1]}
        return result
    finally:db.close()

def review_evidence_packet(actor, store_path=DB_PATH, actual_source=None, now_ms=None):
    """Independent read-only evidence for human review; no approval authority.

    A packet is available only for an existing authenticated request and
    only when the current authoritative DEV source still matches its saved
    immutable identifiers. No signing, nonce consumption or mutations.
    """
    if not isinstance(actor,dict) or actor.get("role")!="super_admin" or not str(actor.get("id","")).startswith("google_"):
        raise ValueError("SUPERADMIN_NOT_VERIFIED")
    path=Path(store_path)
    if not path.is_file() or path.is_symlink():
        raise ValueError("REVIEW_REQUEST_NOT_FOUND")
    conn=sqlite3.connect(f"file:{path}?mode=ro",uri=True,timeout=3)
    try:
        conn.row_factory=sqlite3.Row
        row=conn.execute("""SELECT request_id,company_id,hub_task_id,
          original_core_task_id,original_hub_job_id,original_attempt_id,
          original_command_candidate,original_expired_at_ms,requested_by,
          requested_at_ms,status,owner_approval_granted,issuer_grant,dispatch_permitted
          FROM reviews WHERE company_id='default' AND hub_task_id=183""").fetchone()
        if row is None:raise ValueError("REVIEW_REQUEST_NOT_FOUND")
        saved=dict(row)
    finally:conn.close()
    if saved["requested_by"]!=actor["id"]:raise ValueError("REVIEW_REQUEST_ACTOR_MISMATCH")
    if (saved["status"]!=REVIEW_STATUS or saved["owner_approval_granted"]!=0 or
        saved["issuer_grant"]!=0 or saved["dispatch_permitted"]!=0):
        raise ValueError("REVIEW_STATE_UNTRUSTED")
    source=validate_source(source_readback() if actual_source is None else actual_source, now_ms)
    compare={
     "company_id":"company_id","hub_task_id":"hub_task_id",
     "original_core_task_id":"core_task_id","original_hub_job_id":"hub_execution_id",
     "original_attempt_id":"attempt_id",
     "original_command_candidate":"command_candidate_id",
     "original_expired_at_ms":"expires_at_ms"
    }
    for saved_key,source_key in compare.items():
        expected=(int(source[source_key]) if saved_key=="original_expired_at_ms"
                  else source[source_key])
        if saved[saved_key]!=expected:
            raise ValueError("ORIGINAL_PREPARATION_EVIDENCE_MISMATCH")
    proof={
        "version":1,"environment":"CST-DEV",
        "purpose":"INDEPENDENT_OWNER_RECOVERY_REVIEW_ONLY",
        "requestId":saved["request_id"],"taskId":183,"companyId":"default",
        "coreTaskId":saved["original_core_task_id"],
        "hubExecutionId":saved["original_hub_job_id"],
        "originalAttemptId":saved["original_attempt_id"],
        "commandCandidateId":saved["original_command_candidate"],
        "originalExpiryMs":saved["original_expired_at_ms"],
        "requestedAtMs":saved["requested_at_ms"],
        "status":saved["status"]
    }
    digest=hashlib.sha256(json.dumps(proof,separators=(",",":"),sort_keys=True).encode()).hexdigest()
    return {"evidence":proof,"evidenceSha256":digest,
            "readOnly":True,"ownerApprovalGranted":False,
            "signedApprovalReceived":False,"nonceConsumed":False,
            "issuerGrant":False,"commandIssued":False,
            "dispatchPermitted":False,"attemptIssued":False}

def attest_review_evidence(*,actor,evidence_sha256,store_path=DB_PATH,actual_source=None,now_ms=None):
    """Authenticated, immutable human evidence review ACK, NEVER Owner approval.

    Requires explicit authenticated Super Admin action bound to the current
    canonical evidence SHA-256. Does not sign, issue, approve or dispatch.
    """
    if not isinstance(evidence_sha256,str) or not re.fullmatch(r"[0-9a-f]{64}",evidence_sha256):
        raise ValueError("EVIDENCE_DIGEST_INVALID")
    if not isinstance(actor,dict) or actor.get("role")!="super_admin" or actor.get("companyId") not in (None,"default") or not str(actor.get("id","")).startswith("google_"):
        raise ValueError("SIGNED_GOOGLE_SUPERADMIN_REQUIRED")
    packet=review_evidence_packet(actor,store_path=store_path,actual_source=actual_source,now_ms=now_ms)
    if packet["evidenceSha256"]!=evidence_sha256 or packet["evidence"]["requestId"] is None:
        raise ValueError("EVIDENCE_DIGEST_CHANGED")
    path=Path(store_path)
    if path.is_symlink() or not path.is_file():raise ValueError("REVIEW_STORE_UNAVAILABLE")
    if path==DB_PATH:
        st=path.stat()
        if st.st_uid!=0 or stat.S_IMODE(st.st_mode)!=0o600:
            raise ValueError("REVIEW_STORE_CUSTODY_INVALID")
    stamp=int(time.time()*1000) if now_ms is None else int(now_ms)
    db=sqlite3.connect(str(path),timeout=5,isolation_level=None)
    try:
        db.execute("PRAGMA busy_timeout=5000")
        db.execute("""CREATE TABLE IF NOT EXISTS evidence_acknowledgements (
            request_id TEXT PRIMARY KEY REFERENCES reviews(request_id),
            reviewer_id TEXT NOT NULL,
            evidence_sha256 TEXT NOT NULL CHECK(length(evidence_sha256)=64),
            reviewed_at_ms INTEGER NOT NULL,
            decision TEXT NOT NULL CHECK(decision='REVIEWED_ONLY_NO_AUTHORIZATION'),
            owner_approval_granted INTEGER NOT NULL DEFAULT 0 CHECK(owner_approval_granted=0),
            nonce_consumed INTEGER NOT NULL DEFAULT 0 CHECK(nonce_consumed=0),
            issuer_grant INTEGER NOT NULL DEFAULT 0 CHECK(issuer_grant=0),
            attempt_issued INTEGER NOT NULL DEFAULT 0 CHECK(attempt_issued=0),
            dispatch_permitted INTEGER NOT NULL DEFAULT 0 CHECK(dispatch_permitted=0)
        )""")
        db.execute("""CREATE TRIGGER IF NOT EXISTS acknowledgement_immutable_update
            BEFORE UPDATE ON evidence_acknowledgements
            BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ACKNOWLEDGEMENT'); END""")
        db.execute("""CREATE TRIGGER IF NOT EXISTS acknowledgement_immutable_delete
            BEFORE DELETE ON evidence_acknowledgements
            BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ACKNOWLEDGEMENT'); END""")
        db.execute("BEGIN IMMEDIATE")
        existing=db.execute("""SELECT reviewer_id,evidence_sha256,decision
           FROM evidence_acknowledgements WHERE request_id=?""",
           (packet["evidence"]["requestId"],)).fetchone()
        if existing:
            db.execute("ROLLBACK")
            if existing!=(actor["id"],evidence_sha256,"REVIEWED_ONLY_NO_AUTHORIZATION"):
                raise ValueError("ACKNOWLEDGEMENT_CONFLICT")
            return {"recorded":True,"created":False,"status":existing[2],
                "requestId":packet["evidence"]["requestId"],"evidenceSha256":evidence_sha256,
                "ownerApprovalGranted":False,"nonceConsumed":False,"issuerGrant":False,
                "attemptIssued":False,"dispatchPermitted":False}
        db.execute("""INSERT INTO evidence_acknowledgements
           (request_id,reviewer_id,evidence_sha256,reviewed_at_ms,decision)
           VALUES(?,?,?,?,?)""",
           (packet["evidence"]["requestId"],actor["id"],evidence_sha256,
             stamp,"REVIEWED_ONLY_NO_AUTHORIZATION"))
        db.execute("COMMIT")
        return {"recorded":True,"created":True,"status":"REVIEWED_ONLY_NO_AUTHORIZATION",
           "requestId":packet["evidence"]["requestId"],"evidenceSha256":evidence_sha256,
           "ownerApprovalGranted":False,"nonceConsumed":False,"issuerGrant":False,
           "attemptIssued":False,"dispatchPermitted":False}
    except:
        if db.in_transaction:db.execute("ROLLBACK")
        raise
    finally:db.close()

def get_review_acknowledgement(actor,store_path=DB_PATH):
    if actor.get("role")!="super_admin" or not str(actor.get("id","")).startswith("google_"):
        raise ValueError("SUPER_ADMIN_REQUIRED")
    p=Path(store_path)
    if not p.is_file():return {"recorded":False,"status":"NOT_REVIEWED","ownerApprovalGranted":False}
    db=sqlite3.connect(f"file:{p}?mode=ro",uri=True,timeout=4)
    try:
        request=db.execute("""SELECT request_id,requested_by FROM reviews
            WHERE hub_task_id=183 AND company_id='default'""").fetchone()
        if not request or request[1]!=actor["id"]:
            raise ValueError("REVIEW_REQUEST_NOT_OWNED_BY_ACTOR")
        row=db.execute("""SELECT reviewer_id,evidence_sha256,decision
            FROM evidence_acknowledgements WHERE request_id=?""",(request[0],)).fetchone()
        if not row:return {"recorded":False,"status":"NOT_REVIEWED","ownerApprovalGranted":False}
        if row[0]!=actor["id"] or row[2]!="REVIEWED_ONLY_NO_AUTHORIZATION":
            raise ValueError("ACKNOWLEDGEMENT_TRUST_MISMATCH")
        return {"recorded":True,"status":row[2],"evidenceSha256":row[1],
          "ownerApprovalGranted":False,"nonceConsumed":False,"dispatchPermitted":False}
    except sqlite3.OperationalError as exc:
        if "no such table" in str(exc):return {"recorded":False,"status":"NOT_REVIEWED","ownerApprovalGranted":False}
        raise
    finally:db.close()

# Reviewer's signed Google session is a human recovery *intent*, NOT an
# Ed25519 owner/issuer signature. The independent issuer must not trust this
# local queue as dispatch authorization or consume it as a command approval.
RECOVERY_CONSENT_STATE="SUPERADMIN_RECOVERY_INTENT_PENDING_INDEPENDENT_ISSUER"
CHALLENGE_TTL_MS=5*60*1000

def _check_signed_recovery_actor(actor,now_ms):
    if (not isinstance(actor,dict) or actor.get("role")!="super_admin"
        or actor.get("companyId") not in (None,"default")
        or not isinstance(actor.get("id"),str)
        or not actor["id"].startswith("google_")
        or actor.get("authSource")!="supabase_google_identity"
        or type(actor.get("authVerifiedAt")) is not int
        or actor["authVerifiedAt"]>now_ms+30000
        or actor["authVerifiedAt"]<now_ms-8*86400*1000):
        raise ValueError("SIGNED_SUPERADMIN_SESSION_REQUIRED")

def _review_ack_ready(db,request_id,actor_id,evidence_sha):
    row=db.execute("""SELECT r.requested_by,a.reviewer_id,a.evidence_sha256,a.decision
        FROM reviews r JOIN evidence_acknowledgements a
          ON a.request_id=r.request_id
        WHERE r.request_id=?""",(request_id,)).fetchone()
    if row!=(actor_id,actor_id,evidence_sha,"REVIEWED_ONLY_NO_AUTHORIZATION"):
        raise ValueError("REVIEW_ACK_NOT_AUTHORITATIVE")
    return True

def _create_consent_tables(db):
    db.execute("""CREATE TABLE IF NOT EXISTS recovery_consent_challenges(
      challenge_id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL REFERENCES reviews(request_id),
      actor_id TEXT NOT NULL,
      evidence_sha256 TEXT NOT NULL,
      nonce_hash TEXT NOT NULL UNIQUE,
      created_at_ms INTEGER NOT NULL,
      expires_at_ms INTEGER NOT NULL,
      consumed_at_ms INTEGER,
      CHECK(expires_at_ms-created_at_ms<=300000),
      CHECK(consumed_at_ms IS NULL OR
         (consumed_at_ms>=created_at_ms AND consumed_at_ms<=expires_at_ms))
    )""")
    db.execute("""CREATE TABLE IF NOT EXISTS recovery_consent_intents(
      request_id TEXT PRIMARY KEY REFERENCES reviews(request_id),
      challenge_id TEXT NOT NULL UNIQUE REFERENCES recovery_consent_challenges(challenge_id),
      actor_id TEXT NOT NULL,
      evidence_sha256 TEXT NOT NULL,
      consented_at_ms INTEGER NOT NULL,
      auth_source TEXT NOT NULL CHECK(auth_source='supabase_google_identity'),
      state TEXT NOT NULL CHECK(state='SUPERADMIN_RECOVERY_INTENT_PENDING_INDEPENDENT_ISSUER'),
      issuer_authority INTEGER NOT NULL DEFAULT 0 CHECK(issuer_authority=0),
      signed_owner_approval INTEGER NOT NULL DEFAULT 0 CHECK(signed_owner_approval=0),
      nonce_issuer_consumed INTEGER NOT NULL DEFAULT 0 CHECK(nonce_issuer_consumed=0),
      attempt_issued INTEGER NOT NULL DEFAULT 0 CHECK(attempt_issued=0),
      dispatch_permitted INTEGER NOT NULL DEFAULT 0 CHECK(dispatch_permitted=0)
    )""")
    db.execute("""CREATE TRIGGER IF NOT EXISTS recovery_consent_immutable_update
      BEFORE UPDATE ON recovery_consent_intents
      BEGIN SELECT RAISE(ABORT,'IMMUTABLE_RECOVERY_CONSENT'); END""")
    db.execute("""CREATE TRIGGER IF NOT EXISTS recovery_consent_immutable_delete
      BEFORE DELETE ON recovery_consent_intents
      BEGIN SELECT RAISE(ABORT,'IMMUTABLE_RECOVERY_CONSENT'); END""")

def issue_recovery_consent_challenge(*,actor,store_path=DB_PATH,actual_source=None,now_ms=None):
    import secrets
    now_ms=int(time.time()*1000) if now_ms is None else int(now_ms)
    _check_signed_recovery_actor(actor,now_ms)
    proof=review_evidence_packet(actor,store_path=store_path,actual_source=actual_source,now_ms=now_ms)
    path=Path(store_path)
    challenge=secrets.token_urlsafe(36)
    digest=hashlib.sha256(challenge.encode()).hexdigest()
    challenge_id=secrets.token_hex(16)
    db=sqlite3.connect(str(path),timeout=5,isolation_level=None)
    try:
        db.execute("PRAGMA busy_timeout=5000")
        _create_consent_tables(db)
        db.execute("BEGIN IMMEDIATE")
        request_id=proof["evidence"]["requestId"]
        sha=proof["evidenceSha256"]
        _review_ack_ready(db,request_id,actor["id"],sha)
        already=db.execute("SELECT request_id FROM recovery_consent_intents WHERE request_id=?",(request_id,)).fetchone()
        if already:raise ValueError("RECOVERY_INTENT_ALREADY_RECORDED")
        db.execute("""INSERT INTO recovery_consent_challenges
           (challenge_id,request_id,actor_id,evidence_sha256,nonce_hash,
             created_at_ms,expires_at_ms)
           VALUES(?,?,?,?,?,?,?)""",
           (challenge_id,request_id,actor["id"],sha,digest,now_ms,now_ms+CHALLENGE_TTL_MS))
        db.execute("COMMIT")
        return {"challengeId":challenge_id,"nonce":challenge,"evidenceSha256":sha,
           "expiresAtMs":now_ms+CHALLENGE_TTL_MS,
           "purpose":"ONE_SHOT_RECOVERY_INTENT_ONLY",
           "ownerApprovalGranted":False,"dispatchPermitted":False}
    except:
        if db.in_transaction:db.execute("ROLLBACK")
        raise
    finally:db.close()

def consent_to_recovery_review(*,actor,challenge_id,nonce,evidence_sha256,
                               store_path=DB_PATH,actual_source=None,now_ms=None):
    now_ms=int(time.time()*1000) if now_ms is None else int(now_ms)
    _check_signed_recovery_actor(actor,now_ms)
    if (not isinstance(challenge_id,str) or not re.fullmatch(r"[0-9a-f]{32}",challenge_id)
        or not isinstance(nonce,str) or not re.fullmatch(r"[A-Za-z0-9_-]{48}",nonce)
        or not isinstance(evidence_sha256,str) or not re.fullmatch(r"[0-9a-f]{64}",evidence_sha256)):
        raise ValueError("CONSENT_FIELDS_INVALID")
    proof=review_evidence_packet(actor,store_path=store_path,actual_source=actual_source,now_ms=now_ms)
    if evidence_sha256!=proof["evidenceSha256"]:
        raise ValueError("CONSENT_EVIDENCE_MISMATCH")
    db=sqlite3.connect(str(Path(store_path)),timeout=5,isolation_level=None)
    try:
        db.execute("PRAGMA busy_timeout=5000")
        db.execute("BEGIN IMMEDIATE")
        req=proof["evidence"]["requestId"]
        _review_ack_ready(db,req,actor["id"],evidence_sha256)
        challenge=db.execute("""SELECT request_id,actor_id,evidence_sha256,nonce_hash,
            created_at_ms,expires_at_ms,consumed_at_ms
            FROM recovery_consent_challenges WHERE challenge_id=?""",
            (challenge_id,)).fetchone()
        nonce_digest=hashlib.sha256(nonce.encode()).hexdigest()
        if (challenge is None or challenge[0]!=req or challenge[1]!=actor["id"]
            or challenge[2]!=evidence_sha256
            or challenge[3]!=nonce_digest
            or challenge[4]>now_ms or challenge[5]<=now_ms
            or challenge[6] is not None):
            raise ValueError("CONSENT_NONCE_EXPIRED_REUSED_OR_MISMATCHED")
        if db.execute("SELECT 1 FROM recovery_consent_intents WHERE request_id=?",(req,)).fetchone():
            raise ValueError("CONSENT_ALREADY_RECORDED")
        update=db.execute("""UPDATE recovery_consent_challenges SET consumed_at_ms=?
          WHERE challenge_id=? AND consumed_at_ms IS NULL AND expires_at_ms>?""",
          (now_ms,challenge_id,now_ms))
        if update.rowcount!=1:raise ValueError("CONSENT_NONCE_REPLAY")
        db.execute("""INSERT INTO recovery_consent_intents
          (request_id,challenge_id,actor_id,evidence_sha256,consented_at_ms,auth_source,state)
          VALUES(?,?,?,?,?,?,?)""",
          (req,challenge_id,actor["id"],evidence_sha256,now_ms,
           "supabase_google_identity",RECOVERY_CONSENT_STATE))
        db.execute("COMMIT")
        return {"requestId":req,"state":RECOVERY_CONSENT_STATE,"recorded":True,
          "signedOwnerApproval":False,"issuerAuthority":False,
          "issuerNonceConsumed":False,"attemptIssued":False,
          "dispatchPermitted":False}
    except:
        if db.in_transaction:db.execute("ROLLBACK")
        raise
    finally:db.close()

def get_recovery_consent_state(actor,store_path=DB_PATH):
    if not isinstance(actor,dict) or actor.get("role")!="super_admin":
        raise ValueError("SUPERADMIN_REQUIRED")
    path=Path(store_path)
    if not path.is_file():return {"recorded":False,"state":"NOT_RECORDED","dispatchPermitted":False}
    db=sqlite3.connect(f"file:{path}?mode=ro",uri=True,timeout=4)
    try:
        try:
            rows=db.execute("""SELECT c.request_id,c.actor_id,c.state
              FROM recovery_consent_intents c
              JOIN reviews r ON r.request_id=c.request_id
              WHERE r.company_id='default' AND r.hub_task_id=183""").fetchall()
        except sqlite3.OperationalError as err:
            if "no such table" in str(err):return {"recorded":False,"state":"NOT_RECORDED","dispatchPermitted":False}
            raise
        if not rows:return {"recorded":False,"state":"NOT_RECORDED","dispatchPermitted":False}
        if len(rows)!=1 or rows[0][1]!=actor.get("id") or rows[0][2]!=RECOVERY_CONSENT_STATE:
            raise ValueError("RECOVERY_CONSENT_NOT_OWNED")
        return {"recorded":True,"requestId":rows[0][0],"state":RECOVERY_CONSENT_STATE,
          "signedOwnerApproval":False,"issuerAuthority":False,
          "attemptIssued":False,"dispatchPermitted":False}
    finally:db.close()
