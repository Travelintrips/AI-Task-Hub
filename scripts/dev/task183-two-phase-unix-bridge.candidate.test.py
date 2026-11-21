#!/usr/bin/env python3
"""Synthetic Unix bridge proof: no real signer, owner account, or credential."""
import importlib.util,os,tempfile,uuid,base64
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
HERE=Path(__file__).resolve().parent
sp=importlib.util.spec_from_file_location("bridge",HERE/"task183-two-phase-unix-bridge.candidate.py")
b=importlib.util.module_from_spec(sp);sp.loader.exec_module(b)
n=0
def check(name,value):
 global n
 assert value,name
 n+=1
 print("PASS:"+name,flush=True)
with tempfile.TemporaryDirectory(prefix="task183-two-phase-fixture-") as td:
 root=Path(td);os.chmod(root,0o700)
 store=root/"custody.sqlite"
 b.phase.custody.install(path=store,operational=False)
 key=Ed25519PrivateKey.generate()
 calls=[0];authorized=[True]
 def sign():
  calls[0]+=1
  return base64.urlsafe_b64encode(key.sign(b"fixture-task183-signing-payload")).decode().rstrip("=")
 def verify(role,digest,rid,evidence,sig):
  try:key.public_key().verify(base64.urlsafe_b64decode(sig+"=="),b"fixture-task183-signing-payload");return True
  except Exception:return False
 def auth(role,digest,rid,evidence):return authorized[0]
 path=root/"signer-two-phase.sock"
 service=b.FixtureBroker(socket_path=path,store=store,authorize=auth,verify=verify)
 service.start()
 request={"role":"approval","approvalDigest":"a"*64,"requestId":str(uuid.uuid4()),"evidenceSha256":"b"*64}
 ask=lambda data=request,**kw:b.client(path,data,**kw)
 try:
  check("SOCKET_0600",(path.stat().st_mode&0o777)==0o600)
  authorized[0]=False
  check("INDEPENDENT_AUTH_REQUIRED",ask(sign_callback=sign)["status"]=="DENIED")
  check("NO_SIGN_ON_AUTH_DENIAL",calls[0]==0)
  authorized[0]=True
  check("FIRST_COMPLETE",ask(sign_callback=sign)["status"]=="COMPLETED")
  check("ONE_SIGNER_CALL",calls[0]==1)
  check("REPLAY_DOES_NOT_INVITE_SIGN",ask(sign_callback=sign)["signingPermitted"] is False and calls[0]==1)
  check("MUTATED_EVIDENCE_DENIED",ask({**request,"evidenceSha256":"c"*64},sign_callback=sign)["status"]=="DENIED")
  check("SPOOFED_OWNER_FIELD_DENIED",ask({**request,"ownerVerified":True},sign_callback=sign)["status"]=="DENIED")
  recovery={**request,"role":"recovery-approval","approvalDigest":"c"*64,"requestId":str(uuid.uuid4())}
  check("CRASH_SIMULATED_AFTER_RESERVE",ask(recovery,interrupt_after_reserve=True)["status"]=="SIMULATED_PROCESS_CRASH")
  check("CRASH_NO_SIGNATURE",calls[0]==1)
  check("CRASH_REPLAY_UNRESOLVED",ask(recovery,sign_callback=sign)["status"]=="UNRESOLVED_SIGNING")
  check("NO_RE_SIGN_ON_CRASH",calls[0]==1)
  check("PERSISTED_UNRESOLVED",b.phase.custody.audit(path=store,operational=False)["unresolved"]==1)
 finally:service.close()
 check("SOCKET_REMOVED",not path.exists())
 service=b.FixtureBroker(socket_path=path,store=store,authorize=auth,verify=verify,allowed_uid=os.geteuid()+1)
 service.start()
 try:check("REAL_PEER_UID_REJECT",ask(sign_callback=sign)["reason"]=="PEER_CREDENTIAL_MISMATCH")
 finally:service.close()
 service=b.FixtureBroker(socket_path=path,store=store,authorize=auth,verify=verify)
 service.start()
 try:
  check("RESTART_COMPLETED_REPLAY",ask(sign_callback=sign)["status"]=="COMPLETED")
  check("RESTART_UNRESOLVED_NO_RE_SIGN",ask(recovery,sign_callback=sign)["status"]=="UNRESOLVED_SIGNING" and calls[0]==1)
 finally:service.close()
 check("LIVE_CUSTODY_NOT_USED",store!=b.phase.custody.STORE)
print(f"RESULT={n}/{n} PASS")
print("SIGNING_KEY=EPHEMERAL_ONLY")
print("PROD_CHANGED=FALSE")
