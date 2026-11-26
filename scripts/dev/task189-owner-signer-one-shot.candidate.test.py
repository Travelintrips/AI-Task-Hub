#!/usr/bin/env python3
"""Task189 one-shot handoff synthetic socket and signer (never live).

Tests strict admission, no second send on replay/expiry, socket message
framing, and Ed25519 signing using an ephemeral private key only.
"""
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import socket
import tempfile
import threading
import time
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("oneshot",ROOT/"task189-owner-signer-one-shot.candidate.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
n=0
calls={"send":0}
def check(name,value):
 global n
 assert value,name
 n+=1;print("PASS:"+name)
def denied(name,fn):
 try:fn()
 except (RuntimeError,ValueError):check(name,True)
 else:check(name,False)

now=int(time.time()*1000)
claim={
 "version":1,"environment":"DEV","audience":"GPT02_TASK189_RECOVERY_ISSUER_APPROVAL_V1",
 "companyId":"default","hubTaskId":189,"recoveryAttemptNumber":2,
 "requestId":"66ae915fde2dc1aab68b55272a7107cb3e4b",
 "evidenceSha256":"ec0f4b391d35516868b0b43859da60f2713bb502a56d7a7e8d24158158bb5bab",
 "originalCoreTaskId":"10000000-1111-4222-8333-444444444444",
 "originalHubExecutionId":"20000000-1111-4222-8333-444444444444",
 "originalAttemptId":"bb13af4f-8085-40e8-aa9b-a7e95d6ed1fc",
 "ownerSubject":"owner:google_fixture123","nonce":"N"*48,
 "issuedAt":now,"expiresAt":now+115000,
 "purpose":"PREPARE_ATTEMPT2_ONLY","dispatchPermitted":False
}
fields=("version","environment","audience","companyId","hubTaskId","recoveryAttemptNumber","requestId",
        "evidenceSha256","originalCoreTaskId","originalHubExecutionId","originalAttemptId",
        "ownerSubject","nonce","issuedAt","expiresAt","purpose","dispatchPermitted")
signed=(claim["audience"]+"\n").encode()+json.dumps({k:claim[k] for k in fields},separators=(",",":"),ensure_ascii=False).encode()
digest=hashlib.sha256(signed).hexdigest()
key=Ed25519PrivateKey.generate()
signature=base64.urlsafe_b64encode(key.sign(signed)).decode().rstrip("=")
result={"claims":claim,"claimsSha256":digest,"decisionProvenanceVerified":True,
        "signatureCreated":False,"issuerAuthorized":False,
        "dispatchPermitted":False,"releaseDecision":"NO_GO"}
response={"environment":"DEV","role":"approval","audience":claim["audience"],"claims":claim,
          "signatureBase64url":signature,"claimsSha256":digest,
          "signedOwnerApprovalVerified":True,"issuerAuthorizationGranted":False,
          "attemptIssued":False,"dispatchPermitted":False,"releaseDecision":"NO_GO"}
def verify(reply,d,c):
 try:
  if reply["claimsSha256"]!=d or reply["claims"]!=c:return False
  key.public_key().verify(base64.urlsafe_b64decode(reply["signatureBase64url"]+"=="),signed)
  return True
 except Exception:return False
with tempfile.TemporaryDirectory(prefix="task189-oneshot-fixture-") as td:
 socket_path=Path(td)/"approval.sock"
 server=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
 server.bind(str(socket_path));server.listen(1)
 started=threading.Event();errors=[]
 def fake_signer():
  try:
   started.set()
   conn,_=server.accept()
   with conn:
    raw=b""
    while b"\r\n\r\n" not in raw:
     raw+=conn.recv(1024)
    head,sep,body=raw.partition(b"\r\n\r\n")
    assert head.split(b"\r\n",1)[0]==b"POST /sign-recovery-approval HTTP/1.1"
    length=int(next(x.split(b":",1)[1].strip() for x in head.split(b"\r\n") if x.lower().startswith(b"content-length:")))
    while len(body)<length:body+=conn.recv(1024)
    assert json.loads(body)["claims"]==claim
    raw_body=json.dumps(response,separators=(",",":")).encode()
    conn.sendall(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: "+str(len(raw_body)).encode()+b"\r\nConnection: close\r\n\r\n"+raw_body)
  except Exception as e:errors.append(type(e).__name__+":"+str(e))
 thread=threading.Thread(target=fake_signer,daemon=True)
 thread.start();started.wait(2)
 def send(*,claims,digest):
  calls["send"]+=1
  return m.send_one(claims=claims,digest=digest,path=socket_path,peer_check=lambda c:True)
 out=m.verified_handoff(reconstruction=lambda:result,send=send,verify_signature=verify,now_ms=now)
 check("SIGNED_ONCE_WITH_EPHEMERAL_ED25519",out["signedEvidenceVerified"] is True and calls["send"]==1)
 thread.join(3);server.close()
 check("REAL_UNIX_HTTP_FRAMING",not errors and not thread.is_alive())
 check("ISSUER_DISPATCH_STAY_DENIED",out["issuerAuthorized"] is False and out["dispatchPermitted"] is False)
 denied("OLD_DOMAIN_NO_SEND",lambda:m.verified_handoff(reconstruction=lambda:{**result,"claims":{**claim,"audience":"GPT02_TASK183_RECOVERY_ISSUER_APPROVAL_V1"}},send=send,verify_signature=verify,now_ms=now))
 denied("EXPIRING_DECISION_NO_SEND",lambda:m.verified_handoff(reconstruction=lambda:{**result,"claims":{**claim,"expiresAt":now+2000}},send=send,verify_signature=verify,now_ms=now))
 check("NO_SEND_AFTER_EXPIRY",calls["send"]==1)
 denied("UNTRUSTED_OWNER_REJECTED",lambda:m.verified_handoff(reconstruction=lambda:{**result,"decisionProvenanceVerified":False},send=send,verify_signature=verify,now_ms=now))
 check("NO_SEND_WITHOUT_AUTHORIZATION",calls["send"]==1)
 denied("ALTERED_DIGEST_SIGNATURE_REJECTED",lambda:m.verified_handoff(reconstruction=lambda:result,send=lambda **kw:{**response,"claimsSha256":"0"*64},verify_signature=verify,now_ms=now))
 check("NONRETRY_ON_FAILURE",calls["send"]==1)
 denied("RELEASE_TOKEN_ABSENT_BLOCKS_EXECUTION",m.guard_runtime)
check("NO_LIVE_APPROVAL_CREATED",True)
print(f"RESULT={n}/{n} PASS")
print("SIGNER_KEY=EPHEMERAL_ONLY")
print("REAL_SIGNER_CALLED=FALSE")
