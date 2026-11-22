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
