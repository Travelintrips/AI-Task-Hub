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

def get_status(actor,store_path=DB_PATH):
    if actor.get("role")!="super_admin":raise ValueError("SUPER_ADMIN_REQUIRED")
    loc=Path(store_path)
    if not loc.is_file():return {"requested":False,"status":"NOT_REQUESTED","approvalGranted":False,"dispatchPermitted":False}
    db=sqlite3.connect(f"file:{loc}?mode=ro",uri=True,timeout=3)
    try:
        row=db.execute("SELECT request_id,requested_by,status FROM reviews WHERE company_id='default' AND hub_task_id=183").fetchone()
        if not row:return {"requested":False,"status":"NOT_REQUESTED","approvalGranted":False,"dispatchPermitted":False}
        if row[1]!=actor.get("id"):raise ValueError("REQUEST_NOT_VISIBLE_TO_OTHER_USER")
        return {"requested":True,"requestId":row[0],"status":row[2],"approvalGranted":False,"dispatchPermitted":False}
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
