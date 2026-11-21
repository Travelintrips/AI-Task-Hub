#!/usr/bin/env python3
"""Task183 CST-DEV release-readiness audit: READ ONLY; never authorizes signing.

Checks exact installed source and backup, sealed broker service, absent release
token, Owner/outbox count, receipt custody, and disabled issuer/dispatch.
NO-GO is an expected outcome until legitimate Owner approval is persisted.
"""
from __future__ import annotations
import hashlib,os,sqlite3,subprocess
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
 check("ROOT_RECEIPTS_EMPTY",state["installed"] is True and state["total"]==0)
 check("ISSUER_DISPATCH_UNAUTHORIZED",state["issuerAuthorized"] is False and state["dispatchPermitted"] is False)
 c=sqlite3.connect("file:"+str(APPROVAL_DB)+"?mode=ro",uri=True,timeout=3)
 try:
  c.execute("PRAGMA query_only=ON")
  decision=c.execute("SELECT COUNT(*) FROM gpt02_task183_owner_recovery_decisions WHERE task_id=183").fetchone()[0]
  outbox=c.execute("SELECT COUNT(*) FROM gpt02_task183_owner_recovery_outbox WHERE task_id=183").fetchone()[0]
 finally:c.close()
 print("TASK183_OWNER_DECISIONS="+str(decision))
 print("TASK183_OWNER_OUTBOX="+str(outbox))
 if decision!=1 or outbox!=1:
  print("FINAL_RELEASE_STATUS=NO_GO_MISSING_LEGITIMATE_OWNER_DECISION")
  print("READONLY_AUDIT=PASS")
  return 2
 print("FINAL_RELEASE_STATUS=NO_GO_MANUAL_RELEASE_AND_OPERATIONAL_E2E_REQUIRED")
 print("READONLY_AUDIT=PASS")
 return 3
if __name__=="__main__":
 raise SystemExit(audit())
