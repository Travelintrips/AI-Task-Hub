#!/usr/bin/env python3
"""CST-DEV Task183 guarded, operator-invoked release controller.

Default = no-mutation preflight. The explicit --activate path MUST verify
the independently installed root-only token BEFORE touching systemd, and
rolls back a partially started signer/broker on any failure. It does not
write an Owner decision, issue a signature, or start issuer/dispatch.

Not intended for boot. Requires explicit root invocation after release review.
"""
import argparse
import fcntl
import grp
import importlib.util
import os
import sqlite3
import re
import time
from pathlib import Path
import stat
import subprocess

ROOT=Path("/opt/ai-coding-standalone-dev/qa")
RELEASE=Path("/etc/gpt02-dev/task183-broker-release.approved")
LOCK=Path("/run/lock/cst-task183-owner-window-activation.lock")
BROKER="cst-task183-root-broker.service"
SIGNER="gpt02-issue159-operational-signer@approval.service"
ISSUER="gpt02-issue159-issuer-reader.service"
APP="cst-task183-oneclick-dev.service"
CUSTODY=Path("/var/lib/cst-dev-task183-recovery/signature-custody.sqlite3")
CONTROLLER="task183-owner-window-readiness.candidate.py"
LAUNCH="cst-task183-broker-activation-oneshot"

def deny(reason):raise RuntimeError(reason)

def systemctl(*args,check=True):
 return subprocess.run(["systemctl",*args],text=True,
    capture_output=True,timeout=12,check=check)

def active(unit):
 return systemctl("show",unit,"--property=ActiveState","--value").stdout.strip()=="active"

def verify_history(conn,successor,now):
 conn.execute("BEGIN")
 counts=[conn.execute("SELECT count(*) FROM "+table).fetchone()[0] for table in
         ("gpt02_task183_owner_recovery_decisions","gpt02_task183_owner_recovery_outbox")]
 ledger=conn.execute("SELECT type FROM sqlite_master WHERE name='task183_successor_requests'").fetchone()
 if successor is None:
  if counts!=[0,0] or (ledger and conn.execute("SELECT 1 FROM task183_successor_requests LIMIT 1").fetchone()):
   deny("OWNER_DECISION_ALREADY_RECORDED_NO_REOPEN")
  return
 if counts!=[1,1] or ledger!=("table",):
  deny("SUCCESSOR_HISTORY_MISMATCH")
 rows=conn.execute("""
 SELECT s.request_id FROM task183_successor_requests s
 JOIN gpt02_task183_owner_recovery_decisions d ON d.id=s.predecessor_id
 JOIN gpt02_task183_owner_recovery_outbox o ON o.decision_id=d.id
 WHERE d.task_id=183 AND d.company_id='default' AND d.request_id=?
 AND d.expires_at_ms<=s.created_at_ms AND s.created_at_ms<=?
 AND o.claims_sha256=d.claims_sha256 AND o.request_id=d.request_id
 AND o.nonce=d.nonce AND o.evidence_sha256=d.evidence_sha256
 AND (SELECT count(*) FROM task183_successor_requests)=1
 """,("6bcd8419254dc21c0b149eb09e68a7b6da66",now)).fetchall()
 if rows!=[(successor,)]:
  deny("SUCCESSOR_HISTORY_MISMATCH")

def one_shot_state_pristine(successor=None):
 db=Path("/opt/ai-coding-standalone-dev/tasks.db")
 st=db.lstat()
 if (not stat.S_ISREG(st.st_mode) or db.is_symlink() or
     st.st_uid!=0 or st.st_gid!=0 or stat.S_IMODE(st.st_mode)!=0o600):
  deny("OWNER_DB_CUSTODY_INVALID")
 conn=sqlite3.connect("file:"+str(db)+"?mode=ro",uri=True,timeout=3)
 try:
  conn.execute("PRAGMA query_only=ON")
  verify_history(conn,successor,time.time_ns()//1_000_000)
 finally:conn.close()
 source=ROOT/"task183-dormant-signature-custody.py"
 st=source.lstat()
 if (not stat.S_ISREG(st.st_mode) or source.is_symlink() or
     st.st_uid!=0 or st.st_gid!=0 or stat.S_IMODE(st.st_mode)!=0o400):
  deny("CUSTODY_AUDITOR_SOURCE_UNTRUSTED")
 spec=importlib.util.spec_from_file_location("task183_approval_custody",source)
 m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
 state=m.audit(operational=True)
 if (state.get("installed") is not True or
     state.get("total")!=0 or state.get("unresolved")!=0 or
     state.get("completed")!=0 or
     state.get("issuerAuthorized") is not False or
     state.get("dispatchPermitted") is not False):
  deny("EXISTING_SIGNING_RECEIPT_NO_REOPEN")
 return True

def validate_release():
 if os.geteuid()!=0:deny("ROOT_RELEASE_OPERATOR_REQUIRED")
 if not RELEASE.is_file() or RELEASE.is_symlink():
  deny("INDEPENDENT_RELEASE_TOKEN_ABSENT")
 st=RELEASE.lstat()
 if (not stat.S_ISREG(st.st_mode) or st.st_uid!=0 or st.st_gid!=0
  or stat.S_IMODE(st.st_mode)!=0o400
  or RELEASE.read_text().strip()!="CST_DEV_TASK183_BROKER_RELEASE_V1"):
  deny("INDEPENDENT_RELEASE_TOKEN_INVALID")
 if not CUSTODY.is_file() or CUSTODY.is_symlink():
  deny("ROOT_RECEIPT_STORE_MISSING")
 successor_release=RELEASE.with_name("task183-successor-release.approved")
 successor=None
 if os.path.lexists(successor_release):
  st=successor_release.lstat()
  if not stat.S_ISREG(st.st_mode) or st.st_uid!=0 or st.st_gid!=0 or stat.S_IMODE(st.st_mode)!=0o400:
   deny("SUCCESSOR_RELEASE_CUSTODY_INVALID")
  successor=successor_release.read_text().strip()
  if not re.fullmatch("[0-9a-f]{36}",successor):
   deny("SUCCESSOR_RELEASE_REFERENCE_INVALID")
 if one_shot_state_pristine(successor) is not True:
  deny("ONE_SHOT_STATE_NOT_PRISTINE")
 if not active(APP) or active(ISSUER):
  deny("DEV_SESSION_OR_ISSUER_STATE_UNSAFE")
 # This is a single deliberate release window. Never co-opt a signer
 # already running for another task or disturb an active broker.
 if active(BROKER) or active(SIGNER):
  deny("ALREADY_ACTIVE_REQUIRES_INDEPENDENT_REVIEW")
 if systemctl("show",BROKER,"--property=RefuseManualStart","--value").stdout.strip()!="yes":
  deny("BROKER_MANUAL_START_PROTECTION_MISSING")
 return True

def guarded_source():
 p=ROOT/CONTROLLER
 st=p.lstat()
 if (not stat.S_ISREG(st.st_mode) or p.is_symlink() or
     st.st_uid!=0 or st.st_gid!=0 or stat.S_IMODE(st.st_mode)!=0o400):
  deny("CONTROLLER_SOURCE_CUSTODY_INVALID")
 spec=importlib.util.spec_from_file_location("task183_window_ready",p)
 m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
 return m

def preflight():
 validate_release()
 guarded_source()
 print("TASK183_RELEASE_PREFLIGHT=PASS")
 print("OWNER_APPROVAL_CREATED=FALSE")
 print("SIGNER_STARTED=FALSE")
 return 0

def activate():
 # Run the no-mutation gates before taking the interprocess lock or
 # submitting any systemd job. Token creation is a separate authority.
 validate_release()
 controller=guarded_source()
 fd=os.open(LOCK,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
 lock_acquired=False
 signer_start_attempted=False
 broker_launch_attempted=False
 try:
  fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
  lock_acquired=True
  validate_release()  # Recheck inside lock, still before first service start.
  # Existing detached signer service is not modified, only started as DEV.
  # Mark attempted before dispatching systemd: a failing start command may
  # still have partially activated the unit.
  signer_start_attempted=True
  systemctl("start",SIGNER)
  if not active(SIGNER):deny("DETACHED_SIGNER_NOT_READY")
  # RefuseManualStart=yes on the broker; systemd can only start it as
  # a dependency of the isolated transient one-shot activation job.
  cmd=["systemd-run","--quiet","--wait","--collect","--unit="+LAUNCH,
       "-p","Type=oneshot",
       "-p","Requires="+BROKER,
       "-p","After="+BROKER,
       "/usr/bin/true"]
  # systemd-run can return a failure/timeout AFTER its required unit started.
  broker_launch_attempted=True
  result=subprocess.run(cmd,capture_output=True,text=True,timeout=22)
  if result.returncode!=0:deny("ROOT_BROKER_DEPENDENCY_START_FAILED")
  if not controller.check():deny("BROKER_SIGNER_RUNTIME_READINESS_FAILED")
  print("TASK183_SIGNING_WINDOW=READY_FOR_AUTHENTICATED_OWNER_ACTION")
  print("SIGNED_OWNER_DECISION_CREATED=FALSE")
  print("ISSUER_AUTHORIZED=FALSE")
  print("DISPATCH_PERMITTED=FALSE")
  return 0
 except Exception:
  # Even RefuseManualStop=yes cannot block process SIGTERM. The broker's
  # registered signal handler removes its socket and exits cleanly.
  # NEVER touch someone else's active signing window when LOCK_NB failed.
  # Roll back only resources our lock-holding attempt could have started.
  if lock_acquired:
   if broker_launch_attempted and active(BROKER):
    systemctl("kill","--signal=SIGTERM",BROKER,check=False)
   if signer_start_attempted:
    systemctl("stop",SIGNER,check=False)
  raise
 finally:
  if lock_acquired:fcntl.flock(fd,fcntl.LOCK_UN)
  os.close(fd)

if __name__=="__main__":
 ap=argparse.ArgumentParser()
 group=ap.add_mutually_exclusive_group()
 group.add_argument("--preflight",action="store_true")
 group.add_argument("--activate",action="store_true")
 a=ap.parse_args()
 # Default is strictly read-only and explicitly rejects absent authorization.
 if a.activate:raise SystemExit(activate())
 raise SystemExit(preflight())
