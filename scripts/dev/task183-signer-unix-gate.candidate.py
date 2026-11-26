#!/usr/bin/env python3
"""Fail-closed Task183 signer-side Unix gate; signing key never leaves signer.

Requires same-connection durable RESERVED -> signer callback -> COMPLETED.
The actual broker path is pinned, but no operational service is enabled here.
"""
import base64,hashlib,json,os,socket,stat,struct
from pathlib import Path

DOMAIN="GPT02_TASK183_RECOVERY_ISSUER_APPROVAL_V1"
FIELDS=("version","environment","audience","companyId","hubTaskId","recoveryAttemptNumber","requestId","evidenceSha256","originalCoreTaskId","originalHubExecutionId","originalAttemptId","ownerSubject","nonce","issuedAt","expiresAt","purpose","dispatchPermitted")
LIVE_SOCKET=Path("/run/cst-task183-root-broker/broker.sock")
MAX=4096
def deny(reason):raise RuntimeError(reason)
def send(c,obj):
 raw=json.dumps(obj,separators=(",",":")).encode()
 if not 0<len(raw)<=MAX:deny("BROKER_FRAME_INVALID")
 c.sendall(struct.pack("!I",len(raw))+raw)
def recv(c):
 header=c.recv(4,socket.MSG_WAITALL)
 if len(header)!=4:deny("BROKER_REPLY_MISSING")
 length=struct.unpack("!I",header)[0]
 if not 0<length<=MAX:deny("BROKER_REPLY_LENGTH_INVALID")
 payload=c.recv(length,socket.MSG_WAITALL)
 if len(payload)!=length:deny("BROKER_REPLY_TRUNCATED")
 result=json.loads(payload)
 if type(result) is not dict:deny("BROKER_REPLY_SHAPE_INVALID")
 return result

class SignerGate:
 def __init__(self,socket_path=LIVE_SOCKET,*,fixture_only=False):
  self.path=Path(socket_path)
  self.fixture_only=fixture_only
  if type(fixture_only) is not bool:deny("BROKER_MODE_INVALID")
  if not fixture_only and self.path!=LIVE_SOCKET:deny("PINNED_BROKER_SOCKET_REQUIRED")
  if fixture_only and not str(self.path).startswith("/tmp/task183-two-phase-fixture-"):
   deny("FIXTURE_BROKER_SOCKET_REQUIRED")
 def sign_once(self,*,role,claims,approval_digest,request_id,evidence_sha256,signing_bytes,signer_callback):
  if role!="recovery-approval" or type(claims) is not dict or set(claims)!=set(FIELDS):
   deny("RECOVERY_SIGNER_SCOPE_ONLY")
  if claims["requestId"]!=request_id or claims["evidenceSha256"]!=evidence_sha256:
   deny("RECOVERY_EVIDENCE_NOT_BOUND")
  expected=(DOMAIN+"\n").encode()+json.dumps({k:claims[k] for k in FIELDS},ensure_ascii=False,separators=(",",":")).encode()
  if type(signing_bytes) is not bytes or signing_bytes!=expected:
   deny("CANONICAL_SIGNING_BYTES_MISMATCH")
  if hashlib.sha256(expected).hexdigest()!=approval_digest:
   deny("CANONICAL_DIGEST_MISMATCH")
  if not callable(signer_callback):deny("SIGNER_CALLBACK_REQUIRED")
  st=os.lstat(self.path)
  if not stat.S_ISSOCK(st.st_mode) or stat.S_ISLNK(st.st_mode):
   deny("BROKER_SOCKET_NOT_TRUSTED")
  if not self.fixture_only and (st.st_uid!=0 or stat.S_IMODE(st.st_mode)!=0o660):
   deny("BROKER_SOCKET_CUSTODY_INVALID")
  with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as c:
   c.settimeout(3)
   c.connect(str(self.path))
   if not self.fixture_only:
    if not hasattr(socket,"SO_PEERCRED"):deny("BROKER_PEERCRED_UNAVAILABLE")
    _,uid,_=struct.unpack("3i",c.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12))
    if uid!=0:deny("BROKER_PEER_NOT_ROOT")
   send(c,{"role":role,"claims":claims,"approvalDigest":approval_digest,
           "requestId":request_id,"evidenceSha256":evidence_sha256})
   first=recv(c)
   if first!={"status":"RESERVED","signingPermitted":True}:
    deny("TASK183_SIGNING_NOT_ADMITTED")
   # One and only one signer callback, after persistent broker reservation.
   raw=signer_callback()
   if type(raw) is not bytes or len(raw)!=64:
    deny("SIGNER_ED25519_BYTES_INVALID")
   sig=base64.urlsafe_b64encode(raw).decode().rstrip("=")
   send(c,{"signature":sig})
   final=recv(c)
   if final!={"status":"COMPLETED","newCompletion":True,
               "issuerAuthorized":False,"dispatchPermitted":False}:
    deny("TASK183_RECEIPT_NOT_DURABLE")
   return raw
