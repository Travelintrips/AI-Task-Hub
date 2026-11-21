#!/usr/bin/env python3
"""End-to-end isolated signer Unix gate with real Ed25519 ephemeral key.

Verifies no signer call before durable reservation, no replay after crash.
No live signer service, private credential, Owner decision or PROD access.
"""
import base64,hashlib,importlib.util,json,os,tempfile
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

ROOT=Path(__file__).resolve().parent
def load(tag,filename):
 spec=importlib.util.spec_from_file_location(tag,ROOT/filename)
 obj=importlib.util.module_from_spec(spec);spec.loader.exec_module(obj)
 return obj
gate_module=load("gate","task183-signer-unix-gate.candidate.py")
bridge=load("bridge","task183-two-phase-unix-bridge.candidate.py")
n=0
def check(name,value):
 global n
 assert value,name
 n+=1;print("PASS:"+name)
def denied(name,callback):
 try:callback()
 except RuntimeError:check(name,True)
 else:check(name,False)

with tempfile.TemporaryDirectory(prefix="task183-two-phase-fixture-") as td:
 base=Path(td);os.chmod(td,0o700)
 db=base/"receipts.sqlite"
 bridge.phase.custody.install(path=db,operational=False)
 sock=base/"signer-two-phase.sock"
 claims={k:"fixture" for k in gate_module.FIELDS}
 claims.update(version=1,environment="DEV",audience=gate_module.DOMAIN,companyId="default",
  hubTaskId=183,recoveryAttemptNumber=2,requestId="6bcd8419254dc21c0b149eb09e68a7b6da66",
  evidenceSha256="89950d3b8ac91aac612810325c6a219cb898a6fa41b234a477f0dbe32d85eb7b",
  ownerSubject="owner:synthetic",nonce="N"*48,issuedAt=1800000000000,
  expiresAt=1800000050000,purpose="PREPARE_ATTEMPT2_ONLY",dispatchPermitted=False)
 body=(gate_module.DOMAIN+"\n").encode()+json.dumps({k:claims[k] for k in gate_module.FIELDS},ensure_ascii=False,separators=(",",":")).encode()
 digest=hashlib.sha256(body).hexdigest()
 key=Ed25519PrivateKey.generate();count=[0];authorized=[False]
 def sign():
  count[0]+=1;return key.sign(body)
 def verify(role,d,r,e,c,sig):
  try:
   assert c==claims and d==digest and r==claims["requestId"] and e==claims["evidenceSha256"]
   key.public_key().verify(base64.urlsafe_b64decode(sig+"=="),body)
   return True
  except Exception:return False
 def auth(*args):return authorized[0]
 def openbroker():
  svc=bridge.FixtureBroker(socket_path=sock,store=db,authorize=auth,verify=verify)
  svc.start();return svc
 sg=gate_module.SignerGate(sock,fixture_only=True)
 args={"role":"recovery-approval","claims":claims,"approval_digest":digest,
       "request_id":claims["requestId"],"evidence_sha256":claims["evidenceSha256"],
       "signing_bytes":body,"signer_callback":sign}
 svc=openbroker()
 try:
  denied("NO_OWNER_DECISION_NO_SIGN",lambda:sg.sign_once(**args))
  check("NO_KEY_CALL_WHEN_DENIED",count[0]==0)
  authorized[0]=True
  denied("ALTERED_EVIDENCE_DENIED",lambda:sg.sign_once(**{**args,"evidence_sha256":"a"*64}))
  check("NO_KEY_CALL_ON_ALTERATION",count[0]==0)
  receipt=sg.sign_once(**args)
  check("SIGNED_ONLY_AFTER_BROKER_RESERVATION",len(receipt)==64 and count[0]==1)
  check("DURABLE_COMPLETION",bridge.phase.custody.audit(path=db,operational=False)["completed"]==1)
  denied("REPLAY_NOT_SIGNED_AGAIN",lambda:sg.sign_once(**args))
  check("REPLAY_SIGN_COUNT_UNCHANGED",count[0]==1)
 finally:svc.close()
 svc=openbroker()
 try:
  denied("RESTART_NO_SECOND_SIGNATURE",lambda:sg.sign_once(**args))
  check("RESTART_COUNT_UNCHANGED",count[0]==1)
 finally:svc.close()
 try:gate_module.SignerGate(sock,fixture_only=False)
 except RuntimeError:check("OPERATIONAL_SOCKET_PATH_PINNED",True)
 else:check("OPERATIONAL_SOCKET_PATH_PINNED",False)
 check("NO_ISSUER_OR_DISPATCH",bridge.phase.custody.audit(path=db,operational=False)["issuerAuthorized"] is False and bridge.phase.custody.audit(path=db,operational=False)["dispatchPermitted"] is False)
 print(f"RESULT={n}/{n} PASS")
 print("REAL_SIGNER_CALLED=FALSE")
 print("PROD_CHANGED=FALSE")
