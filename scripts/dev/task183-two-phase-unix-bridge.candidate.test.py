#!/usr/bin/env python3
"""Synthetic Unix bridge proof: no real signer, owner account, or credential."""
import importlib.util,os,tempfile,uuid,base64,json,hashlib
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
 def auth(role,digest,rid,evidence,claims=None):return authorized[0]
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
  recovery_claims={k:"fixture" for k in ("version","environment","audience","companyId","hubTaskId","recoveryAttemptNumber","requestId","evidenceSha256","originalCoreTaskId","originalHubExecutionId","originalAttemptId","ownerSubject","nonce","issuedAt","expiresAt","purpose","dispatchPermitted")}
  recovery_claims.update(version=1,environment="DEV",audience=b.RECOVERY_DOMAIN,companyId="default",hubTaskId=183,recoveryAttemptNumber=2,requestId="6bcd8419254dc21c0b149eb09e68a7b6da66",evidenceSha256="b"*64,ownerSubject="owner:synthetic",nonce="N"*48,issuedAt=1800000000000,expiresAt=1800000050000,purpose="PREPARE_ATTEMPT2_ONLY",dispatchPermitted=False)
  keys=("version","environment","audience","companyId","hubTaskId","recoveryAttemptNumber","requestId","evidenceSha256","originalCoreTaskId","originalHubExecutionId","originalAttemptId","ownerSubject","nonce","issuedAt","expiresAt","purpose","dispatchPermitted")
  recovery_digest=hashlib.sha256((b.RECOVERY_DOMAIN+"\n").encode()+json.dumps({k:recovery_claims[k] for k in keys},ensure_ascii=False,separators=(",",":")).encode()).hexdigest()
  recovery={**request,"role":"recovery-approval","approvalDigest":recovery_digest,"requestId":recovery_claims["requestId"],"claims":recovery_claims}
  check("RECOVERY_MISSING_COMPLETE_CLAIMS_DENIED",ask({k:v for k,v in recovery.items() if k!="claims"},sign_callback=sign)["status"]=="DENIED")
  check("RECOVERY_CANONICAL_MUTATION_DENIED",ask({**recovery,"claims":{**recovery_claims,"nonce":"Z"*48}},sign_callback=sign)["status"]=="DENIED")
  check("RECOVERY_UUID_FORMAT_DENIED",ask({**recovery,"requestId":str(uuid.uuid4())},sign_callback=sign)["status"]=="DENIED")
  check("APPROVAL_UNHYPHENATED_FORMAT_DENIED",ask({**request,"requestId":"a"*36},sign_callback=sign)["status"]=="DENIED")
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
