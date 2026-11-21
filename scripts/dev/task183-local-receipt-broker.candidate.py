#!/usr/bin/env python3
"""Task183 isolated Unix receipt broker candidate (NOT a live service).

Never expose this broker directly to the operational signer. A future root-owned
supervisor must own the only signer invocation and independently authenticate
Owner decisions. In particular, a client cannot assert owner_verified.
"""
import json
import os
import socket
import struct
import stat
import threading
from pathlib import Path
import importlib.util

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("task183_supervisor",HERE/"task183-root-sign-once-supervisor.candidate.py")
supervisor=importlib.util.module_from_spec(spec)
spec.loader.exec_module(supervisor)
MAX=4096
ALLOWED={"approvalDigest","requestId","evidenceSha256"}
SO_PEERCRED=getattr(socket,"SO_PEERCRED",17)

class Broker:
    def __init__(self,*,path,store,authorize,sign,verify,operational=False,allowed_uid=None):
        self.path=Path(path)
        self.store=Path(store)
        if operational is not False:
            raise ValueError("OPERATIONAL_BROKER_NOT_APPROVED")
        if not str(self.path).startswith("/tmp/task183-root-broker-fixture-"):
            raise ValueError("BROKER_FIXTURE_PATH_REQUIRED")
        if self.path.name!="root-broker.sock":
            raise ValueError("BROKER_SOCKET_BASENAME_INVALID")
        if not all(callable(x) for x in (authorize,sign,verify)):
            raise ValueError("TRUSTED_INTERNAL_CALLBACKS_REQUIRED")
        self.authorize=authorize
        self.sign=sign
        self.verify=verify
        self.allowed_uid=os.geteuid() if allowed_uid is None else allowed_uid
        self.listener=None

    def start(self):
        parent=self.path.parent
        st=parent.lstat()
        if not stat.S_ISDIR(st.st_mode) or stat.S_ISLNK(st.st_mode):
            raise ValueError("BROKER_DIRECTORY_INVALID")
        if st.st_uid!=os.geteuid() or stat.S_IMODE(st.st_mode)!=0o700:
            raise ValueError("BROKER_DIRECTORY_OWNER_OR_MODE_INVALID")
        if self.path.exists() or self.path.is_symlink():
            raise ValueError("EXISTING_SOCKET_WILL_NOT_BE_REMOVED")
        listener=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
        try:
            listener.bind(str(self.path))
            os.chmod(self.path,0o600)
            listener.listen(8)
            listener.settimeout(0.2)
        except BaseException:
            listener.close()
            raise
        self.listener=listener

    def close(self):
        if self.listener:
            self.listener.close()
            self.listener=None
        if self.path.is_socket():
            self.path.unlink()

    def serve_until(self,stop):
        while not stop.is_set():
            try:
                conn,_=self.listener.accept()
            except socket.timeout:
                continue
            except OSError:
                if stop.is_set():return
                raise
            with conn:
                self.handle(conn)

    def handle(self,conn):
        conn.settimeout(3)
        cred=conn.getsockopt(socket.SOL_SOCKET,SO_PEERCRED,12)
        _,uid,_=struct.unpack("3i",cred)
        if uid!=self.allowed_uid:
            self._reply(conn,{"ok":False,"error":"UNTRUSTED_PEER"})
            return
        try:
            length=conn.recv(4,socket.MSG_WAITALL)
            if len(length)!=4:
                raise ValueError("INVALID_FRAME")
            size=struct.unpack("!I",length)[0]
            if size==0 or size>MAX:
                raise ValueError("FRAME_TOO_LARGE")
            raw=conn.recv(size,socket.MSG_WAITALL)
            if len(raw)!=size:
                raise ValueError("TRUNCATED_FRAME")
            request=json.loads(raw)
            if type(request) is not dict or set(request)!=ALLOWED:
                raise ValueError("REQUEST_SHAPE_DENIED")
            digest=request["approvalDigest"]
            request_id=request["requestId"]
            evidence=request["evidenceSha256"]
            # Trusted, root-owned callback MUST do fresh independent readback.
            verified=self.authorize(digest,request_id,evidence) is True
            result=supervisor.run(
                approval_digest=digest,request_id=request_id,
                evidence_sha256=evidence,owner_verified=verified,
                signer_callback=lambda:self.sign(digest,request_id,evidence),
                verifier_callback=lambda sig:self.verify(digest,request_id,evidence,sig),
                store=self.store,operational=False)
            self._reply(conn,{"ok":True,"receipt":result})
        except (ValueError,TypeError,UnicodeError,json.JSONDecodeError) as exc:
            self._reply(conn,{"ok":False,"error":str(exc)})
        except BaseException:
            # Error or uncertain signing outcome fails closed; never retry here.
            self._reply(conn,{"ok":False,"error":"UNRESOLVED_SIGNING_REQUIRES_REVIEW"})

    @staticmethod
    def _reply(conn,data):
        body=json.dumps(data,separators=(",",":")).encode()
        conn.sendall(struct.pack("!I",len(body))+body)

def request(socket_path,data):
    raw=json.dumps(data,separators=(",",":")).encode()
    if len(raw)>MAX:raise ValueError("CLIENT_FRAME_TOO_LARGE")
    with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as c:
        c.settimeout(3)
        c.connect(str(socket_path))
        c.sendall(struct.pack("!I",len(raw))+raw)
        header=c.recv(4,socket.MSG_WAITALL)
        if len(header)!=4:raise ValueError("BROKER_REPLY_MISSING")
        size=struct.unpack("!I",header)[0]
        if size>MAX:raise ValueError("BROKER_REPLY_TOO_LARGE")
        return json.loads(c.recv(size,socket.MSG_WAITALL))
