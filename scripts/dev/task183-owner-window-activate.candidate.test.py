#!/usr/bin/env python3
"""Task183 guarded activation script: synthetic systemd ordering only.

Mocks all systemd commands. Temporary root-only release token is a fixture
and never installed under /etc/gpt02-dev; no real units are started.
"""
import importlib.util, os, tempfile,fcntl
from pathlib import Path
from types import SimpleNamespace

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("controller",HERE/"task183-owner-window-activate.candidate.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
n=0
def check(name,yes):
 global n
 assert yes,name
 n+=1
 print("PASS:"+name,flush=True)
def denied(label,fn):
 try:fn()
 except (RuntimeError,ValueError):check(label,True)
 else:check(label,False)
assert os.geteuid()==0
real_token=m.RELEASE
count={"start":0}
original_sys=m.systemctl
def never_started(*args,**kwargs):
 if args[0]=="start":count["start"]+=1
 raise RuntimeError("SYSTEMCTL_NOT_ALLOWED_WHEN_TOKEN_MISSING")
m.systemctl=never_started
denied("NO_ACTIVATION_WITHOUT_OFFICIAL_TOKEN",m.activate)
check("ZERO_SYSTEMD_START_CALLS_WITHOUT_TOKEN",count["start"]==0)
m.systemctl=original_sys
with tempfile.TemporaryDirectory(prefix="task183-release-controller-fixture-") as td:
 root=Path(td)
 token=root/"fake-release.approved"
 token.write_text("CST_DEV_TASK183_BROKER_RELEASE_V1\n")
 token.chmod(0o400)
 m.RELEASE=token
 m.CUSTODY=root/"fixture-receipts.sqlite"
 m.CUSTODY.write_text("fake but never read")
 m.LOCK=root/"activation.lock"
 m.one_shot_state_pristine=lambda successor=None:True
 state={"signer":False,"broker":False,"issuer":False,"app":True}
 calls=[]
 def fake_systemctl(*args,**kwargs):
  calls.append(("systemctl",)+args)
  if args[0]=="show":
   if args[1]==m.BROKER and args[2]=="--property=RefuseManualStart":
    return SimpleNamespace(stdout="yes\n",returncode=0)
   raise RuntimeError("unexpected read")
  if args==("start",m.SIGNER):
   state["signer"]=True
  elif args==("stop",m.SIGNER):
   state["signer"]=False
  elif args==("kill","--signal=SIGTERM",m.BROKER):
   state["broker"]=False
  else:raise RuntimeError("unapproved service command")
  return SimpleNamespace(stdout="",returncode=0)
 def fake_active(unit):
  return {m.SIGNER:state["signer"],m.BROKER:state["broker"],
          m.ISSUER:state["issuer"],m.APP:state["app"]}[unit]
 original_run=m.subprocess.run
 def fake_run(cmd,*args,**kwargs):
  calls.append(("transient",)+tuple(cmd))
  assert cmd[0]=="systemd-run"
  assert "-p" in cmd and "Requires="+m.BROKER in cmd
  state["broker"]=True
  return SimpleNamespace(returncode=0,stdout="",stderr="")
 m.systemctl=fake_systemctl
 m.active=fake_active
 m.subprocess.run=fake_run
 m.guarded_source=lambda: SimpleNamespace(check=lambda:True)
 try:
  check("TOKEN_AUTHENTICATED_BEFORE_START",m.validate_release() is True)
  # A previously approved Task183 must never open another release window.
  m.one_shot_state_pristine=lambda successor=None:False
  before=len(calls)
  denied("NONPRISTINE_OWNER_OR_RECEIPT_DENIED",m.activate)
  check("NONPRISTINE_RELEASE_STARTED_NO_UNITS",len(calls)==before)
  m.one_shot_state_pristine=lambda successor=None:True
  result=m.activate()
  check("CONTROLLED_START_SUCCEEDED",result==0)
  start_calls=[c for c in calls if c[0]=="systemctl" and c[1]=="start"]
  check("ONLY_APPROVAL_SIGNER_EXPLICITLY_STARTED",len(start_calls)==1 and start_calls[0][2]==m.SIGNER)
  check("BROKER_LAUNCHED_AFTER_SIGNER",next(i for i,c in enumerate(calls) if c[0]=="transient")>next(i for i,c in enumerate(calls) if c[:2]==("systemctl","start")))
  check("NO_ISSUER_OR_DISPATCH_MUTATION",state["issuer"] is False)
  # Never start a second release window over an existing active signer.
  before=len(calls)
  denied("DUPLICATE_WINDOW_REFUSED",m.activate)
  check("DUPLICATE_WINDOW_DOES_NOT_CALL_SYSTEMD_START",len(calls)==before+0 or all(c[1]!="start" for c in calls[before:] if c[0]=="systemctl"))
  # Rollback a post-start runtime readiness failure without any approval.
  state["signer"]=False;state["broker"]=False
  m.guarded_source=lambda: SimpleNamespace(check=lambda:False)
  denied("POST_START_FAILED_READINESS_DENIED",m.activate)
  check("BROKER_ROLLBACK_SIGNAL_SENT",("systemctl","kill","--signal=SIGTERM",m.BROKER) in calls)
  check("SIGNER_ROLLBACK_STOP_SENT",("systemctl","stop",m.SIGNER) in calls)
  check("ROLLBACK_LEAVES_BOTH_OFF",not state["signer"] and not state["broker"])
  # Two contenders: one process already holds lock and owns a live signing
  # window. The losing contender must NEVER SIGTERM/stop winner's resources.
  state["signer"]=True;state["broker"]=True
  previous=len(calls)
  held=os.open(m.LOCK,os.O_CREAT|os.O_RDWR,0o600)
  try:
   fcntl.flock(held,fcntl.LOCK_EX|fcntl.LOCK_NB)
   # Match the race: both callers validated while services were OFF,
   # then the winner started them before the loser attempted the lock.
   existing_validate=m.validate_release
   m.validate_release=lambda:True
   try:
    try:m.activate()
    except BlockingIOError:check("CONCURRENT_ACTIVATION_LOCK_DENIED",True)
    else:check("CONCURRENT_ACTIVATION_LOCK_DENIED",False)
   finally:m.validate_release=existing_validate
   check("LOCK_LOSER_DOES_NOT_STOP_ACTIVE_SIGNER",state["signer"] is True)
   check("LOCK_LOSER_DOES_NOT_KILL_ACTIVE_BROKER",state["broker"] is True)
   check("LOCK_LOSER_ISSUES_ZERO_SYSTEMD_MUTATIONS",len(calls)==previous)
  finally:
   fcntl.flock(held,fcntl.LOCK_UN);os.close(held)
  # Signer start can fail AFTER systemd spawned a process.
  state["signer"]=False;state["broker"]=False
  previous=len(calls)
  def failing_signer_start(*args,**kwargs):
   if args==("start",m.SIGNER):
    calls.append(("systemctl",)+args)
    state["signer"]=True
    raise RuntimeError("SYSTEMCTL_TIMED_OUT_AFTER_START")
   return fake_systemctl(*args,**kwargs)
  m.systemctl=failing_signer_start
  denied("PARTIALLY_STARTED_SIGNER_FAILURE_DENIED",m.activate)
  check("PARTIAL_SIGNER_STARTED_THEN_ROLLED_BACK",not state["signer"])
  check("PARTIAL_SIGNER_ROLLBACK_RECORDED",("systemctl","stop",m.SIGNER) in calls[previous:])
  m.systemctl=fake_systemctl
  # Likewise a transient broker dependency may start before systemd-run
  # reports failure. The same lock holder must clean up both components.
  def failing_broker_start(cmd,*args,**kwargs):
   calls.append(("transient",)+tuple(cmd))
   state["broker"]=True
   return SimpleNamespace(returncode=1,stdout="",stderr="failed after start")
  m.subprocess.run=failing_broker_start
  previous=len(calls)
  denied("PARTIALLY_STARTED_BROKER_FAILURE_DENIED",m.activate)
  check("PARTIAL_BROKER_AND_SIGNER_ROLLED_BACK",not state["broker"] and not state["signer"])
  check("BROKER_SIGTERM_ISSUED_BY_LOCK_OWNER",("systemctl","kill","--signal=SIGTERM",m.BROKER) in calls[previous:])
 finally:
  m.subprocess.run=original_run
  m.RELEASE=real_token
print(f"RESULT={n}/{n} PASS")
print("REAL_SYSTEMD_UNITS_STARTED=FALSE")
print("REAL_RELEASE_TOKEN_CREATED=FALSE")
print("PROD_CHANGED=FALSE")
