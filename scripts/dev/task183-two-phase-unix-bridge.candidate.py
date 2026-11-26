#!/usr/bin/env python3
"""Task183 same-connection two-phase Unix protocol. ISOLATED FIXTURE ONLY.

Broker never handles private keys. Independent authorization and Ed25519
verification are server callbacks supplied by trusted code, NOT client claims.
One connection owns reserve -> signature -> durable completion. A broken
connection after reserve leaves UNRESOLVED_SIGNING; no automatic re-sign.
This module refuses operational paths and is not installed as a service.
"""
import hashlib
import importlib.util
import json
import os
import re
import socket
import socketserver
import stat
import struct
import threading
from pathlib import Path

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("phase",HERE/"task183-two-phase-signing.candidate.py")
phase=importlib.util.module_from_spec(spec);spec.loader.exec_module(phase)
MAX=4096
CREDENTIAL=getattr(socket,"SO_PEERCRED",17)
FIELDS={"role","approvalDigest","requestId","evidenceSha256"}
ROLES={"approval","recovery-approval"}
RECOVERY_FIELDS={"version","environment","audience","companyId","hubTaskId","recoveryAttemptNumber","requestId","evidenceSha256","originalCoreTaskId","originalHubExecutionId","originalAttemptId","ownerSubject","nonce","issuedAt","expiresAt","purpose","dispatchPermitted"}
RECOVERY_DOMAIN="GPT02_TASK183_RECOVERY_ISSUER_APPROVAL_V1"
APPROVAL_ID=re.compile(r"^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$")
RECOVERY_ID=re.compile(r"^[a-f0-9]{36}$")

def frame(conn,obj):
    b=json.dumps(obj,separators=(",",":")).encode()
    if len(b)>MAX:raise ValueError("FRAME_TOO_LARGE")
    conn.sendall(struct.pack("!I",len(b))+b)

def readframe(conn):
    head=conn.recv(4,socket.MSG_WAITALL)
    if len(head)!=4:raise ValueError("FRAME_HEADER_MISSING")
    n=struct.unpack("!I",head)[0]
    if n<1 or n>MAX:raise ValueError("FRAME_LENGTH_INVALID")
    body=conn.recv(n,socket.MSG_WAITALL)
    if len(body)!=n:raise ValueError("FRAME_BODY_MISSING")
    obj=json.loads(body)
    if type(obj) is not dict:raise ValueError("OBJECT_REQUIRED")
    return obj

class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        c=self.request
        c.settimeout(2)
        service=self.server
        # Operational candidate: an injected exact-systemd-unit policy is checked
        # before parsing claims, calling Owner reader, or touching receipt store.
        # The static UID/GID fallback exists ONLY for /tmp fixture tests.
        policy=getattr(service,"peer_verifier",None)
        if policy is not None:
            allowed=(callable(policy) and policy(c) is True)
        else:
            cred=c.getsockopt(socket.SOL_SOCKET,CREDENTIAL,12)
            _,uid,gid=struct.unpack("3i",cred)
            allowed=(uid,gid)==(service.allowed_uid,service.allowed_gid)
        if not allowed:
            frame(c,{"status":"DENIED","reason":"PEER_CREDENTIAL_MISMATCH"})
            return
        try:
            request=readframe(c)
            if request.get("role") not in ROLES:
                raise ValueError("UNTRUSTED_REQUEST_SHAPE")
            if set(request)!=(FIELDS|{"claims"} if request["role"]=="recovery-approval" else FIELDS):
                raise ValueError("UNTRUSTED_REQUEST_SHAPE")
            role=request["role"]; digest=request["approvalDigest"]
            rid=request["requestId"]; evidence=request["evidenceSha256"]
            expected=RECOVERY_ID if role=="recovery-approval" else APPROVAL_ID
            if type(rid) is not str or not expected.fullmatch(rid):
                raise ValueError("ROLE_SPECIFIC_REQUEST_ID_REQUIRED")
            # Recovery must bind FULL claims to the canonical signed payload.
            if role=="recovery-approval":
                claims=request["claims"]
                if type(claims) is not dict or set(claims)!=RECOVERY_FIELDS:
                    raise ValueError("COMPLETE_RECOVERY_CLAIMS_REQUIRED")
                canonical=json.dumps({k:claims[k] for k in ("version","environment","audience","companyId","hubTaskId","recoveryAttemptNumber","requestId","evidenceSha256","originalCoreTaskId","originalHubExecutionId","originalAttemptId","ownerSubject","nonce","issuedAt","expiresAt","purpose","dispatchPermitted")},ensure_ascii=False,separators=(",",":")).encode()
                expected_digest=hashlib.sha256((RECOVERY_DOMAIN+"\n").encode()+canonical).hexdigest()
                if (claims["requestId"]!=rid or claims["evidenceSha256"]!=evidence
                    or claims["audience"]!=RECOVERY_DOMAIN
                    or expected_digest!=digest):
                    raise ValueError("RECOVERY_CANONICAL_BINDING_MISMATCH")
                owner_ok=service.authorize(role,digest,rid,evidence,claims) is True
            else:
                owner_ok=service.authorize(role,digest,rid,evidence) is True
            domain_digest=hashlib.sha256((role+"\n"+digest).encode()).hexdigest()
            engine=phase.TwoPhase(service.store,fixture_only=(getattr(service,"operational",False) is not True))
            answer=engine.reserve(
                digest=domain_digest,request=rid,evidence=evidence,
                independent_owner_readback=owner_ok)
            if not answer["signingPermitted"]:
                # Never invite a second signer call, even on completed replay.
                frame(c,{"status":answer["state"],"signingPermitted":False})
                return
            frame(c,{"status":"RESERVED","signingPermitted":True})
            # The private-key holder signs, then sends its signature on SAME socket.
            signed=readframe(c)
            if set(signed)!={"signature"}:
                raise ValueError("SIGNATURE_FRAME_INVALID")
            # Recovery verifier receives exact canonical claims, preventing
            # a callback from validating an unrelated signed payload.
            if role=="recovery-approval":
                verify=lambda sig:service.verify(role,digest,rid,evidence,claims,sig) is True
            else:
                verify=lambda sig:service.verify(role,digest,rid,evidence,sig) is True
            result=engine.complete(
                digest=domain_digest,request=rid,evidence=evidence,
                signature=signed["signature"],independent_signature_verify=verify)
            frame(c,{"status":result["state"],"newCompletion":result["newCompletion"],
                     "issuerAuthorized":False,"dispatchPermitted":False})
        except (Exception,BaseException):
            # An admitted but disconnected signer leaves a permanent RESERVED row.
            try:frame(c,{"status":"DENIED","reason":"UNRESOLVED_SIGNING_OR_BAD_REQUEST"})
            except (OSError,ValueError):pass

class Server(socketserver.ThreadingMixIn,socketserver.UnixStreamServer):
    daemon_threads=True
    allow_reuse_address=False

class FixtureBroker:
    def __init__(self,*,socket_path,store,authorize,verify,allowed_uid=None,allowed_gid=None,peer_verifier=None):
        path=Path(socket_path)
        if (not str(path).startswith("/tmp/task183-two-phase-fixture-") or
            path.name!="signer-two-phase.sock" or path.exists() or path.is_symlink()):
            raise ValueError("OPERATIONAL_BROKER_PATH_NOT_AUTHORIZED")
        if not callable(authorize) or not callable(verify):
            raise ValueError("INDEPENDENT_AUTH_AND_VERIFY_REQUIRED")
        self.path=path
        self.store=Path(store)
        self.authorize=authorize
        self.verify=verify
        self.allowed_uid=os.geteuid() if allowed_uid is None else allowed_uid
        self.allowed_gid=os.getegid() if allowed_gid is None else allowed_gid
        s=path.parent.lstat()
        if not stat.S_ISDIR(s.st_mode) or s.st_uid!=os.geteuid() or stat.S_IMODE(s.st_mode)!=0o700:
            raise ValueError("FIXTURE_PARENT_NOT_0700_OWNER")
        self.server=Server(str(path),Handler,bind_and_activate=True)
        self.server.store=self.store
        self.server.operational=False
        self.server.authorize=authorize
        self.server.verify=verify
        self.server.allowed_uid=self.allowed_uid
        self.server.allowed_gid=self.allowed_gid
        if peer_verifier is not None and not callable(peer_verifier):
            self.server.server_close()
            raise ValueError("PEER_VERIFIER_MUST_BE_CALLABLE")
        self.server.peer_verifier=peer_verifier
        os.chmod(path,0o600)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True)
    def start(self):self.thread.start()
    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(3)
        if self.path.is_socket():self.path.unlink()

def client(path,request,sign_callback=None,interrupt_after_reserve=False):
    with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as c:
        c.settimeout(3)
        c.connect(str(path))
        frame(c,request)
        first=readframe(c)
        if first.get("status")!="RESERVED" or first.get("signingPermitted") is not True:
            return first
        if interrupt_after_reserve:return {"status":"SIMULATED_PROCESS_CRASH"}
        if not callable(sign_callback):raise ValueError("SIGNING_CALLBACK_REQUIRED")
        frame(c,{"signature":sign_callback()})
        return readframe(c)
