#!/usr/bin/env python3
"""Fail-closed broker peer gate before Owner reader and persistent reservation."""
import importlib.util,os,socket,tempfile,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("bridge",ROOT/"task183-two-phase-unix-bridge.candidate.py")
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
ps=importlib.util.spec_from_file_location("policy",ROOT/"task183-systemd-peer-policy.candidate.py")
policy=importlib.util.module_from_spec(ps);ps.loader.exec_module(policy)
n=0
def check(label,result):
 global n
 assert result,label
 n+=1;print("PASS:"+label)
with tempfile.TemporaryDirectory(prefix="task183-two-phase-fixture-") as td:
 p=Path(td);os.chmod(td,0o700)
 store=p/"custody.sqlite";b.phase.custody.install(path=store,operational=False)
 calls={"auth":0,"verify":0,"peer":0}
 def owner(*args):
  calls["auth"]+=1;return False
 def verify(*args):
  calls["verify"]+=1;return False
 def deny_peer(conn):
  calls["peer"]+=1;return False
 socket_path=p/"signer-two-phase.sock"
 broker=b.FixtureBroker(socket_path=socket_path,store=store,authorize=owner,verify=verify,peer_verifier=deny_peer)
 broker.start()
 req={"role":"approval","approvalDigest":"a"*64,"requestId":str(uuid.uuid4()),"evidenceSha256":"b"*64}
 try:
  response=b.client(socket_path,req)
  check("POLICY_REJECTS_BEFORE_OWNER_LOOKUP",response.get("reason")=="PEER_CREDENTIAL_MISMATCH")
  check("POLICY_INVOKED",calls["peer"]==1)
  check("OWNER_READER_NOT_CALLED",calls["auth"]==0)
  check("SIGNATURE_VERIFIER_NOT_CALLED",calls["verify"]==0)
  check("NO_RECEIPT_RESERVATION",b.phase.custody.audit(path=store,operational=False)["total"]==0)
 finally:broker.close()
 check("SOCKET_REMOVED",not socket_path.exists())
 # Use the actual exact systemd peer policy, not a synthetic deny callback.
 broker=b.FixtureBroker(socket_path=socket_path,store=store,authorize=owner,verify=verify,peer_verifier=policy.authenticated_peer)
 broker.start()
 try:
  resp=b.client(socket_path,req)
  check("ACTUAL_SYSTEMD_POLICY_REJECTS_ROOT_CALLER",resp.get("reason")=="PEER_CREDENTIAL_MISMATCH")
  check("ACTUAL_POLICY_NEVER_REACHES_OWNER",calls["auth"]==0)
  check("ACTUAL_POLICY_NEVER_RESERVES",b.phase.custody.audit(path=store,operational=False)["total"]==0)
 finally:broker.close()
 try:
  b.FixtureBroker(socket_path=socket_path,store=store,authorize=owner,verify=verify,peer_verifier=True)
 except ValueError:check("NONCALLABLE_POLICY_REFUSED",True)
 else:check("NONCALLABLE_POLICY_REFUSED",False)
print(f"RESULT={n}/{n} PASS")
print("LIVE_SIGNER_CALLED=FALSE")
print("PROD_CHANGED=FALSE")
