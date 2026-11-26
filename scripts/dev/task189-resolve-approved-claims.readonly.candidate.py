#!/usr/bin/env python3
"""Read-only reconstruction of Task189 Owner-approved recovery claims.

No signing, owner approval creation, issuer or dispatch. Reconstructs exact
canonical claims from independently stored Owner decision/outbox and the
historical review evidence, then checks signed-byte digest and provenance.

Operational mode ONLY reads the pinned root-owned CST-DEV databases.
"""
from __future__ import annotations
import hashlib
import importlib.util
import json
import os
import sqlite3
import stat
import time
from pathlib import Path

ROOT=Path("/opt/ai-coding-standalone-dev/qa")
APPROVAL=Path("/opt/ai-coding-standalone-dev/tasks.db")
REVIEW=Path("/var/lib/cst-dev-task189-recovery/review-requests.sqlite3")
DOMAIN="GPT02_TASK189_RECOVERY_ISSUER_APPROVAL_V1"
REQUEST="66ae915fde2dc1aab68b55272a7107cb3e4b"
EVIDENCE="ec0f4b391d35516868b0b43859da60f2713bb502a56d7a7e8d24158158bb5bab"
FIELDS=("version","environment","audience","companyId","hubTaskId","recoveryAttemptNumber","requestId",
        "evidenceSha256","originalCoreTaskId","originalHubExecutionId","originalAttemptId",
        "ownerSubject","nonce","issuedAt","expiresAt","purpose","dispatchPermitted")
def fail(msg):raise ValueError(msg)
def checked_db(path,operational):
 p=Path(path)
 st=os.lstat(p)
 if (not stat.S_ISREG(st.st_mode) or stat.S_ISLNK(st.st_mode)
     or (operational and (st.st_uid!=0 or st.st_gid!=0 or stat.S_IMODE(st.st_mode)!=0o600))):
  fail("OWNER_RESOLVER_DB_CUSTODY_DENIED")
 return p
def read_sqlite(path,sql,args=()):
 conn=sqlite3.connect("file:"+str(path)+"?mode=ro",uri=True,timeout=3)
 try:
  conn.row_factory=sqlite3.Row
  conn.execute("PRAGMA query_only=ON")
  return conn.execute(sql,args).fetchall()
 finally:conn.close()
def load_checked(name):
 p=ROOT/name
 st=os.lstat(p)
 if not stat.S_ISREG(st.st_mode) or stat.S_ISLNK(st.st_mode) or st.st_uid!=0 or stat.S_IMODE(st.st_mode)!=0o400:
  fail("OWNER_RESOLVER_MODULE_CUSTODY_DENIED")
 spec=importlib.util.spec_from_file_location(name.replace("-","_").replace(".","_"),p)
 m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
 return m
def reconstruct(*,request_id=REQUEST,operational=True,approval_path=None,review_packet=None,now_ms=None):
 now=int(time.time()*1000) if now_ms is None else int(now_ms)
 if request_id!=REQUEST:fail("TASK189_REQUEST_MISMATCH")
 if operational:
  if approval_path is not None or review_packet is not None or now_ms is not None:
   fail("OWNER_RESOLVER_OPERATIONAL_OVERRIDES_DENIED")
  approval_path=APPROVAL
  review_module=load_checked("task189-recovery-review-intake-dev.py")
 else:
  if approval_path is None or review_packet is None:fail("ISOLATED_REVIEW_PACKET_REQUIRED")
 approval_db=checked_db(approval_path,operational)
 rows=read_sqlite(approval_db,"""
 SELECT d.task_id,d.request_id,d.company_id,d.evidence_sha256,d.claims_sha256,
        d.owner_subject,d.nonce,d.recorded_at_ms,d.expires_at_ms,
        d.auth_user_id,d.role_at_decision,d.decision,
        o.id AS outbox_id
 FROM gpt02_task189_owner_recovery_decisions d
 JOIN gpt02_task189_owner_recovery_outbox o
   ON o.decision_id=d.id AND o.task_id=d.task_id
   AND o.request_id=d.request_id AND o.company_id=d.company_id
   AND o.evidence_sha256=d.evidence_sha256 AND o.claims_sha256=d.claims_sha256
   AND o.owner_subject=d.owner_subject AND o.nonce=d.nonce
   AND o.auth_user_id=d.auth_user_id AND o.role_at_decision=d.role_at_decision
   AND o.recorded_at_ms=d.recorded_at_ms AND o.expires_at_ms=d.expires_at_ms
 WHERE d.task_id=189 AND d.request_id=? AND d.evidence_sha256=?
 """,(request_id,EVIDENCE))
 if len(rows)!=1:fail("OWNER_DECISION_MISSING_OR_NOT_UNIQUE")
 row=rows[0]
 if (row["company_id"]!="default" or row["role_at_decision"]!="super_admin" or
     row["decision"]!="APPROVE_RECOVERY_ATTEMPT2_ONLY" or
     row["recorded_at_ms"]>now or row["expires_at_ms"]<=now or
     row["expires_at_ms"]-row["recorded_at_ms"]>120000):
  fail("OWNER_DECISION_EXPIRED_OR_INVALID")
 owner=row["owner_subject"]
 if type(owner) is not str or not owner.startswith("owner:google_"):
  fail("OWNER_SUBJECT_INVALID")
 if operational:
  review_packet=review_module.review_evidence_packet({"id":owner[len("owner:"):],"role":"super_admin"})
 if (type(review_packet) is not dict or review_packet.get("readOnly") is not True or
     review_packet.get("evidenceSha256")!=EVIDENCE):
  fail("REVIEW_EVIDENCE_MISMATCH")
 ev=review_packet.get("evidence")
 if type(ev) is not dict or ev.get("requestId")!=REQUEST:
  fail("REVIEW_ID_MISMATCH")
 claims={
  "version":1,"environment":"DEV","audience":DOMAIN,"companyId":"default",
  "hubTaskId":189,"recoveryAttemptNumber":2,"requestId":request_id,"evidenceSha256":EVIDENCE,
  "originalCoreTaskId":ev.get("coreTaskId"),"originalHubExecutionId":ev.get("hubExecutionId"),
  "originalAttemptId":ev.get("originalAttemptId"),"ownerSubject":owner,
  "nonce":row["nonce"],"issuedAt":row["recorded_at_ms"],"expiresAt":row["expires_at_ms"],
  "purpose":"PREPARE_ATTEMPT2_ONLY","dispatchPermitted":False
 }
 if any(type(claims[k]) is not str for k in ("originalCoreTaskId","originalHubExecutionId","originalAttemptId")):
  fail("ORIGINAL_EVIDENCE_IDS_INVALID")
 raw=(DOMAIN+"\n").encode()+json.dumps({k:claims[k] for k in FIELDS},ensure_ascii=False,separators=(",",":")).encode()
 digest=hashlib.sha256(raw).hexdigest()
 if digest!=row["claims_sha256"]:fail("PERSISTED_CANONICAL_DIGEST_MISMATCH")
 adapter=load_checked("task189-independent-owner-adapter.candidate.py")
 proof=adapter.authorize_recovery(claims=claims,operational=operational,
     **({} if operational else {"db_path":approval_db,"now_ms":now}))
 if proof.get("decisionProvenanceVerified") is not True or proof.get("approvalDigest")!=digest:
  fail("INDEPENDENT_OWNER_READER_DENIED")
 return {"claims":claims,"claimsSha256":digest,"decisionProvenanceVerified":True,
         "signatureCreated":False,"issuerAuthorized":False,"dispatchPermitted":False,
         "releaseDecision":"NO_GO"}
