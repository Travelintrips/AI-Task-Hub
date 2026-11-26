#!/usr/bin/env python3
"""Task183 full Unix broker/temporary DynamicUser signer integration.

Only fixture receipts under /tmp and a temporary Unix socket under /run.
The ephemeral Ed25519 signing key exists only in temporary test fixtures.
No actual Owner session, operational signer service, release token or PROD.
"""
import base64
import grp
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import socket
import stat
import subprocess
import tempfile
import threading
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding,PublicFormat

ROOT=Path(__file__).resolve().parent
GOOD="cst-task183-full-signer-fixture.service"
BAD="cst-task183-full-impostor-fixture.service"
GROUP="gpt02-issue159-signers"
DOMAIN="GPT02_TASK183_RECOVERY_ISSUER_APPROVAL_V1"
FIELDS=("version","environment","audience","companyId","hubTaskId","recoveryAttemptNumber",
"requestId","evidenceSha256","originalCoreTaskId","originalHubExecutionId","originalAttemptId",
"ownerSubject","nonce","issuedAt","expiresAt","purpose","dispatchPermitted")
now=1800000000000
claims={k:"fixture" for k in FIELDS}
claims.update(version=1,environment="DEV",audience=DOMAIN,companyId="default",
hubTaskId=183,recoveryAttemptNumber=2,requestId="6bcd8419254dc21c0b149eb09e68a7b6da66",
evidenceSha256="89950d3b8ac91aac612810325c6a219cb898a6fa41b234a477f0dbe32d85eb7b",
ownerSubject="owner:google_fixture",nonce="N"*48,issuedAt=now,
expiresAt=now+60000,purpose="PREPARE_ATTEMPT2_ONLY",dispatchPermitted=False)
payload=(DOMAIN+"\n").encode()+json.dumps({k:claims[k] for k in FIELDS},ensure_ascii=False,separators=(",",":")).encode()
digest=hashlib.sha256(payload).hexdigest()
n=0
def check(label,ok):
 global n
 assert ok,label
 n+=1
 print("PASS:"+label,flush=True)
def load(file,tag):
 spec=importlib.util.spec_from_file_location(tag,ROOT/file)
 m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

bridge=load("task183-two-phase-unix-bridge.candidate.py","task183_live_fixture_bridge")
policy=load("task183-systemd-peer-policy.candidate.py","task183_live_fixture_policy")
custody=bridge.phase.custody
gid=grp.getgrnam(GROUP).gr_gid
assert os.geteuid()==0
with tempfile.TemporaryDirectory(prefix="task183-full-unix-fixture-",dir="/run") as root:
 base=Path(root)
 os.chown(base,0,gid);os.chmod(base,0o750)
 socket_path=base/"broker.sock"
 key_file=base/"fixture-ed25519.key"
 private=Ed25519PrivateKey.generate()
 seed=private.private_bytes_raw()
 key_file.write_bytes(seed)
 os.chown(key_file,0,gid);os.chmod(key_file,0o440)
 pub=private.public_key()
 with tempfile.TemporaryDirectory(prefix="task183-two-phase-fixture-") as td:
  store=Path(td)/"receipt.sqlite"
  custody.install(path=store,operational=False)
  reader_calls=[0]
  def authorize(role,d,r,e,c):
   reader_calls[0]+=1
   return role=="recovery-approval" and d==digest and r==claims["requestId"] and e==claims["evidenceSha256"] and c==claims
  def verify(role,d,r,e,c,sig):
   if role!="recovery-approval" or d!=digest or c!=claims:return False
   try:
    pub.verify(base64.urlsafe_b64decode(sig+"=="),payload)
    return True
   except Exception:return False
  srv=bridge.Server(str(socket_path),bridge.Handler,bind_and_activate=True)
  try:
   srv.store=store
   srv.operational=False
   srv.authorize=authorize
   srv.verify=verify
   srv.peer_verifier=lambda conn:policy.authenticated_peer(conn,unit=GOOD,group=GROUP)
   srv.allowed_uid=-1;srv.allowed_gid=-1
   os.chown(socket_path,0,gid);os.chmod(socket_path,0o660)
   thread=threading.Thread(target=srv.serve_forever,daemon=True)
   thread.start()
   client_source=r'''
import base64,hashlib,importlib.util,json,os,socket,struct,sys
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
socket_path=Path(sys.argv[1])
key_path=Path(sys.argv[2])
mode=sys.argv[3]
domain="GPT02_TASK183_RECOVERY_ISSUER_APPROVAL_V1"
fields=("version","environment","audience","companyId","hubTaskId","recoveryAttemptNumber",
"requestId","evidenceSha256","originalCoreTaskId","originalHubExecutionId","originalAttemptId",
"ownerSubject","nonce","issuedAt","expiresAt","purpose","dispatchPermitted")
claims={k:"fixture" for k in fields}
claims.update(version=1,environment="DEV",audience=domain,companyId="default",
hubTaskId=183,recoveryAttemptNumber=2,requestId="6bcd8419254dc21c0b149eb09e68a7b6da66",
evidenceSha256="89950d3b8ac91aac612810325c6a219cb898a6fa41b234a477f0dbe32d85eb7b",
ownerSubject="owner:google_fixture",nonce="N"*48,issuedAt=1800000000000,
expiresAt=1800000060000,purpose="PREPARE_ATTEMPT2_ONLY",dispatchPermitted=False)
raw=(domain+"\n").encode()+json.dumps({k:claims[k] for k in fields},ensure_ascii=False,separators=(",",":")).encode()
digest=hashlib.sha256(raw).hexdigest()
if mode=="impostor":
 with socket.socket(socket.AF_UNIX) as conn:
  conn.settimeout(3)
  conn.connect(str(socket_path))
  h=conn.recv(4,socket.MSG_WAITALL)
  n=struct.unpack("!I",h)[0]
  response=json.loads(conn.recv(n,socket.MSG_WAITALL))
  assert response=={"status":"DENIED","reason":"PEER_CREDENTIAL_MISMATCH"},response
 print("IMPOSTOR_DENIED_BEFORE_CLAIMS=PASS",flush=True)
elif mode=="crash":
 with socket.socket(socket.AF_UNIX) as conn:
  conn.settimeout(3)
  conn.connect(str(socket_path))
  message=json.dumps({"role":"recovery-approval","approvalDigest":digest,
      "requestId":claims["requestId"],"evidenceSha256":claims["evidenceSha256"],
      "claims":claims},separators=(",",":")).encode()
  conn.sendall(struct.pack("!I",len(message))+message)
  h=conn.recv(4,socket.MSG_WAITALL)
  length=struct.unpack("!I",h)[0]
  reply=json.loads(conn.recv(length,socket.MSG_WAITALL))
  assert reply=={"status":"RESERVED","signingPermitted":True},reply
 # Intentionally disconnect before any key.sign operation.
 print("DISCONNECTED_AFTER_DURABLE_RESERVATION=PASS",flush=True)
else:
 p=Path("/opt/ai-coding-standalone-dev/task183_signer_unix_gate.py")
 spec=importlib.util.spec_from_file_location("gate",p)
 m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
 m.LIVE_SOCKET=socket_path # Isolated fixture path; never modifies installed file
 gate=m.SignerGate(socket_path=socket_path,fixture_only=False)
 key=Ed25519PrivateKey.from_private_bytes(key_path.read_bytes())
 calls=[0]
 def sign():
  calls[0]+=1
  return key.sign(raw)
 kw=dict(role="recovery-approval",claims=claims,approval_digest=digest,
 request_id=claims["requestId"],evidence_sha256=claims["evidenceSha256"],
 signing_bytes=raw,signer_callback=sign)
 if mode=="replay":
  try:gate.sign_once(**kw)
  except RuntimeError:pass
  else:raise AssertionError("SIGNER_RESTART_AUTOSIGNED")
  assert calls[0]==0
  print("SAME_UNIT_RESTART_NO_NEW_SIGNATURE=PASS",flush=True)
 else:
  result=gate.sign_once(**kw)
  assert isinstance(result,bytes) and len(result)==64 and calls[0]==1
  print("DYNAMIC_SIGNER_FIRST_SIGNATURE=PASS",flush=True)
  try:gate.sign_once(**kw)
  except RuntimeError:pass
  else:raise AssertionError("DUPLICATE_SIGNING_ALLOWED")
  assert calls[0]==1
  print("DYNAMIC_SIGNER_NO_SECOND_SIGNATURE=PASS",flush=True)
'''
   def launch(unit,mode):
    cmd=["systemd-run","--quiet","--wait","--collect","--unit="+unit,
     "-p","DynamicUser=yes","-p","SupplementaryGroups="+GROUP,
     "-p","PrivateNetwork=yes","-p","PrivateTmp=yes",
     "-p","NoNewPrivileges=yes","-p","ProtectSystem=strict",
     "-p","RestrictAddressFamilies=AF_UNIX",
     "/usr/bin/python3","-c",client_source,str(socket_path),str(key_file),mode]
    return subprocess.run(cmd,text=True,capture_output=True,timeout=30)
   before=reader_calls[0]
   impostor=launch(BAD,"impostor")
   check("IMPOSTOR_UNIT_PROCESS_SUCCEEDS",impostor.returncode==0)
   check("IMPOSTOR_CANNOT_READ_OWNER",reader_calls[0]==before)
   good=launch(GOOD,"real")
   check("DYNAMIC_SIGNER_UNIT_PROCESS_SUCCEEDS",good.returncode==0)
   audit=custody.audit(path=store,operational=False)
   check("SYNTHETIC_SIGNATURE_DURABLE",audit["total"]==1 and audit["completed"]==1)
   check("NO_UNRESOLVED_AFTER_SUCCESS",audit["unresolved"]==0)
   check("NO_ISSUER_DISPATCH",not audit["issuerAuthorized"] and not audit["dispatchPermitted"])
   check("READER_ONLY_CALLED_FOR_VALID_SIGNER",reader_calls[0]==2)
   restarted=launch(GOOD,"replay")
   check("SAME_SYSTEMD_UNIT_RESTART_SUCCEEDS",restarted.returncode==0)
   check("RESTART_DID_NOT_RE_SIGN",reader_calls[0]==3)
   check("COMPLETED_RECEIPT_IMMUTABLE",custody.audit(path=store,operational=False)==audit)
   # Simulate an actual systemd signer process closing immediately after
   # the broker durably reserves, before the first key.sign is reached.
   crash_store=Path(td)/"crash-receipt.sqlite"
   custody.install(path=crash_store,operational=False)
   srv.store=crash_store
   crash=launch(GOOD,"crash")
   check("DYNAMIC_UNIT_DISCONNECT_AFTER_RESERVE",crash.returncode==0)
   interrupted=custody.audit(path=crash_store,operational=False)
   check("CRASH_RESERVATION_UNRESOLVED",interrupted["total"]==1 and interrupted["unresolved"]==1 and interrupted["completed"]==0)
   restarted_crash=launch(GOOD,"replay")
   check("DYNAMIC_UNIT_RESTART_AFTER_CRASH_DENIED",restarted_crash.returncode==0)
   check("CRASH_DOES_NOT_RESIGN",custody.audit(path=crash_store,operational=False)==interrupted)
   check("CRASH_REPLAY_OWNER_READ_ONLY",reader_calls[0]==5)
   print("RESULT="+str(n)+"/"+str(n)+" PASS",flush=True)
   print("SIGNER_KEY=TEMPORARY_ED25519_ONLY",flush=True)
   print("OPERATIONAL_SIGNER_STARTED=FALSE",flush=True)
  finally:
   srv.shutdown();srv.server_close()
   thread.join(3)
print("PROD_CHANGED=FALSE")
