#!/usr/bin/env python3
"""CST-DEV Task189 root broker + detached signer release window readiness.

Read-only, exact systemd and socket ownership checks. Never signs,
starts units, generates approval records or opens a TCP listener.
"""
import grp
import os
from pathlib import Path
import socket
import stat
import subprocess

RELEASE=Path("/etc/gpt02-dev/task189-broker-release.approved")
BROKER=Path("/run/cst-task189-root-broker/broker.sock")
SIGNER=Path("/run/gpt02-issue159-operational-signer-approval/signer.sock")
SIGNER_UNIT="gpt02-issue159-operational-signer@approval.service"
BROKER_UNIT="cst-task189-root-broker.service"
ISSUER_UNIT="gpt02-issue159-issuer-reader.service"
GROUP="gpt02-issue159-signers"

def fail(msg):raise RuntimeError(msg)
def systemd_value(unit,property):
 return subprocess.check_output(
  ["systemctl","show",unit,"--property="+property,"--value"],
  timeout=4,text=True).strip()
def check():
 if os.geteuid()!=0:fail("ROOT_READINESS_REQUIRED")
 if RELEASE.is_symlink() or not RELEASE.is_file():fail("RELEASE_TOKEN_ABSENT")
 st=os.lstat(RELEASE)
 if (not stat.S_ISREG(st.st_mode) or st.st_uid!=0 or st.st_gid!=0
  or stat.S_IMODE(st.st_mode)!=0o400
  or RELEASE.read_text().strip()!="CST_DEV_TASK189_BROKER_RELEASE_V1"):
  fail("RELEASE_TOKEN_INVALID")
 for unit in (BROKER_UNIT,SIGNER_UNIT):
  if systemd_value(unit,"ActiveState")!="active":fail("SIGNING_COMPONENT_NOT_ACTIVE")
 if systemd_value(ISSUER_UNIT,"ActiveState")=="active":
  fail("ISSUER_MUST_STAY_OFF")
 gid=grp.getgrnam(GROUP).gr_gid
 bp=os.lstat(BROKER)
 if (not stat.S_ISSOCK(bp.st_mode) or BROKER.is_symlink() or bp.st_uid!=0
  or bp.st_gid!=gid or stat.S_IMODE(bp.st_mode)!=0o660):
  fail("ROOT_BROKER_SOCKET_CUSTODY_INVALID")
 # Do not traverse the detached signer's DynamicUser 0700 private
 # directory here. This no-capabilities controller validates the unit's
 # actual process/cgroup; the authenticated HTTP readiness endpoint owns
 # the root-capable socket inode verification.
 pid_text=systemd_value(SIGNER_UNIT,"MainPID")
 if not pid_text.isdigit() or int(pid_text)<2:fail("SIGNER_UNIT_PID_INVALID")
 pid=int(pid_text)
 status=Path(f"/proc/{pid}/status").read_text()
 cgroup=Path(f"/proc/{pid}/cgroup").read_text()
 attrs=dict(line.split(":",1) for line in status.splitlines() if ":" in line)
 uids=attrs.get("Uid","").split()
 groups=attrs.get("Groups","").split()
 if (len(uids)<2 or int(uids[1])==0
     or str(gid) not in groups
     or not any(SIGNER_UNIT in row.split("/") for row in cgroup.splitlines())):
  fail("DYNAMIC_SIGNER_PROCESS_IDENTITY_INVALID")
 return True
if __name__=="__main__":
 check()
 print("CST_DEV_TASK189_BROKER_AND_SIGNER_READINESS=PASS")
 print("SIGNER_CALLED=FALSE")
 print("ISSUER_AUTHORIZED=FALSE")
 print("DISPATCH_PERMITTED=FALSE")
