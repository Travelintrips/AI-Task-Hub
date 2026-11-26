#!/usr/bin/env python3
"""Task183 CST-DEV release-readiness audit: READ ONLY; never authorizes signing.

Checks exact installed source and backup, sealed broker service, absent release
token, Owner/outbox count, receipt custody, and disabled issuer/dispatch.
NO-GO remains mandatory for expired or unregistered historical signed receipts.
"""
from __future__ import annotations
import hashlib,os,sqlite3,subprocess,time
from pathlib import Path

LIVE=Path("/opt/ai-coding-standalone-dev/gpt02_issue159_operational_signer.py")
BACKUP=Path("/opt/ai-coding-standalone-dev/gpt02_issue159_operational_signer.before-task183-20261122.py")
ROOT=Path("/opt/ai-coding-standalone-dev/qa")
APPROVAL_DB=Path("/opt/ai-coding-standalone-dev/tasks.db")
RELEASE=Path("/etc/gpt02-dev/task183-broker-release.approved")
BROKER_SOCKET=Path("/run/cst-task183-root-broker/broker.sock")
EXPECTED_LIVE="242d66ebead3bdff69cc378899dc88610232170d571e32fb94dd81b608bb03d0"
EXPECTED_BACKUP="c004af2cffa54e834e4d40c33f5cdb947cbfbff63f72deae08c22c50411f9dce"

def fail(msg):raise RuntimeError(msg)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def field(unit,prop):
 p=subprocess.run(["systemctl","show",unit,"--property="+prop,"--value"],
                  text=True,capture_output=True,check=True)
 return p.stdout.strip()
def check(label,yes):
 if not yes:fail(label)
 print("PASS:"+label)
def classify(*,decisions,outbox,matched,receipts,completed,unresolved,last_expiry_ms,now_ms):
 if any(type(v) is not int or v<0 for v in
        (decisions,outbox,matched,receipts,completed,unresolved)):
  return "NO_GO_INVALID_READ_ONLY_EVIDENCE"
 if matched!=decisions or decisions!=outbox:
  return "NO_GO_OWNER_OUTBOX_LINEAGE_MISMATCH"
 if decisions==0 and receipts==0:
  return "NO_GO_OWNER_DECISION_NOT_RECORDED"
 if receipts>0:
  if unresolved>0:
   return "NO_GO_UNRESOLVED_SIGNATURE_REQUIRES_MANUAL_REVIEW"
  if completed>0 and last_expiry_ms is not None and last_expiry_ms<=now_ms:
   return "NO_GO_HISTORICAL_SIGNATURE_EXPIRED_REGISTRATION_UNVERIFIED"
  return "NO_GO_HISTORICAL_RECEIPT_REGISTRATION_UNVERIFIED"
 return "NO_GO_OWNER_DECISION_EXISTS_WITHOUT_COMPLETED_RECEIPT"

def audit():
 if os.geteuid()!=0:fail("ROOT_READONLY_AUDIT_REQUIRED")
 check("LIVE_SIGNER_SOURCE_PINNED",sha(LIVE)==EXPECTED_LIVE)
 check("ROLLBACK_BACKUP_PINNED",sha(BACKUP)==EXPECTED_BACKUP)
 check("BROKER_DISABLED",field("cst-task183-root-broker.service","UnitFileState")=="disabled")
 check("BROKER_INACTIVE",field("cst-task183-root-broker.service","ActiveState")=="inactive")
 check("BROKER_MANUAL_START_REFUSED",field("cst-task183-root-broker.service","RefuseManualStart")=="yes")
 check("SIGNER_INACTIVE",field("gpt02-issue159-operational-signer@approval.service","ActiveState")=="inactive")
 check("ISSUER_INACTIVE",field("gpt02-issue159-issuer-reader.service","ActiveState")=="inactive")
 check("RELEASE_TOKEN_ABSENT",not RELEASE.exists() and not RELEASE.is_symlink())
 check("BROKER_SOCKET_ABSENT",not BROKER_SOCKET.exists() and not BROKER_SOCKET.is_symlink())
 import importlib.util
 p=ROOT/"task183-dormant-signature-custody.py"
 spec=importlib.util.spec_from_file_location("custody",p)
 m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
 state=m.audit(operational=True)
 check("ROOT_RECEIPT_STORE_AUDITED",state["installed"] is True and
       all(type(state.get(k)) is int and state[k]>=0 for k in
           ("total","unresolved","completed")))
 check("ISSUER_DISPATCH_UNAUTHORIZED",state["issuerAuthorized"] is False and state["dispatchPermitted"] is False)
 c=sqlite3.connect("file:"+str(APPROVAL_DB)+"?mode=ro",uri=True,timeout=3)
 try:
  c.execute("PRAGMA query_only=ON")
  c.execute("BEGIN")
  decision=c.execute("SELECT COUNT(*) FROM gpt02_task183_owner_recovery_decisions WHERE task_id=183").fetchone()[0]
  outbox=c.execute("SELECT COUNT(*) FROM gpt02_task183_owner_recovery_outbox WHERE task_id=183").fetchone()[0]
  matched=c.execute("""SELECT COUNT(*)
    FROM gpt02_task183_owner_recovery_decisions d
    JOIN gpt02_task183_owner_recovery_outbox o
      ON o.decision_id=d.id AND o.task_id=d.task_id
     AND o.request_id=d.request_id AND o.company_id=d.company_id
     AND o.claims_sha256=d.claims_sha256 AND o.evidence_sha256=d.evidence_sha256
     AND o.owner_subject=d.owner_subject AND o.nonce=d.nonce
     AND o.auth_user_id=d.auth_user_id AND o.auth_method=d.auth_method
     AND o.role_at_decision=d.role_at_decision
     AND o.recorded_at_ms=d.recorded_at_ms AND o.expires_at_ms=d.expires_at_ms
    WHERE d.task_id=183""").fetchone()[0]
  latest=c.execute("SELECT MAX(expires_at_ms) FROM gpt02_task183_owner_recovery_decisions WHERE task_id=183").fetchone()[0]
 finally:c.close()
 print("TASK183_OWNER_DECISIONS="+str(decision))
 print("TASK183_OWNER_OUTBOX="+str(outbox))
 print("TASK183_OWNER_OUTBOX_MATCHED="+str(matched))
 print("ROOT_RECEIPTS_TOTAL="+str(state["total"]))
 print("ROOT_RECEIPTS_COMPLETED="+str(state["completed"]))
 print("ROOT_RECEIPTS_UNRESOLVED="+str(state["unresolved"]))
 print("LATEST_OWNER_DECISION_EXPIRED="+str(latest is not None and latest<=int(time.time()*1000)).lower())
 status=classify(decisions=decision,outbox=outbox,matched=matched,
                 receipts=state["total"],completed=state["completed"],
                 unresolved=state["unresolved"],last_expiry_ms=latest,
                 now_ms=int(time.time()*1000))
 print("FINAL_RELEASE_STATUS="+status)
 print("POSTGRESQL_RECEIPT_REGISTERED=NOT_CHECKED_BY_THIS_AUDIT")
 print("READONLY_AUDIT=PASS")
 return 2 if decision==0 or matched!=decision else 3
if __name__=="__main__":
 raise SystemExit(audit())
