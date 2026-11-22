#!/usr/bin/env python3
"""Task183 guarded activation script: synthetic systemd ordering only.

Mocks all systemd commands. Temporary root-only release token is a fixture
and never installed under /etc/gpt02-dev; no real units are started.
"""
import importlib.util, os, tempfile
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
 finally:
  m.subprocess.run=original_run
  m.RELEASE=real_token
print(f"RESULT={n}/{n} PASS")
print("REAL_SYSTEMD_UNITS_STARTED=FALSE")
print("REAL_RELEASE_TOKEN_CREATED=FALSE")
print("PROD_CHANGED=FALSE")
