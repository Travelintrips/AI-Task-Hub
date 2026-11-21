#!/usr/bin/env python3
"""DEV-only read-only Super Admin approval-intent Unix-socket adapter.

The adapter exposes the existing pinned SQLite reader; it does not create or
modify approval decisions, load keys, sign, access PostgreSQL or dispatch.
"""
from __future__ import annotations

import argparse
import grp
import json
import os
import signal
import socketserver
import stat
import time
from pathlib import Path
from typing import Any, Callable

LIVE_READER_DIR = "/opt/ai-coding-standalone-dev"
DEFAULT_SOCKET = "/run/gpt02-approval-reader/approval.sock"
MAX_BODY = 8192
MAX_HEADER = 2048
LOOKUP_FIELDS = (
    "claimsSha256", "taskId", "commandId", "attemptId",
    "companyId", "superAdminId",
)


def _load_reader():
    import sys
    if LIVE_READER_DIR not in sys.path:
        sys.path.insert(0, LIVE_READER_DIR)
    from gpt02_issue159_approval_intent_reader import read_approval_intent
    return read_approval_intent


def _response(status: int, payload: dict[str, Any]) -> bytes:
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    reason = {200:"OK",400:"Bad Request",404:"Not Found",
              413:"Payload Too Large",503:"Service Unavailable"}.get(status,"Error")
    return (f"HTTP/1.1 {status} {reason}\r\n"
            "Content-Type: application/json\r\nCache-Control: no-store\r\n"
            "Connection: close\r\n"
            f"Content-Length: {len(body)}\r\n\r\n").encode("ascii")+body


def _read_request(conn):
    conn.settimeout(3.0)
    data=b""
    while b"\r\n\r\n" not in data:
        chunk=conn.recv(1024)
        if not chunk: raise ValueError("HEADER_INCOMPLETE")
        data+=chunk
        if len(data)>MAX_HEADER: raise OverflowError("HEADER_TOO_LARGE")
    header,_,body=data.partition(b"\r\n\r\n")
    lines=header.split(b"\r\n")
    if not lines:
        raise LookupError("NOT_FOUND")
    routes={
        b"POST /approval-intent HTTP/1.1":False,
        b"POST /owner-outbox-intent HTTP/1.1":True,
    }
    if lines[0] not in routes:
        raise LookupError("NOT_FOUND")
    require_owner_outbox=routes[lines[0]]
    headers={}
    for line in lines[1:]:
        if b":" not in line: raise ValueError("HEADER_INVALID")
        key,value=line.split(b":",1);key=key.strip().lower()
        if key in headers: raise ValueError("DUPLICATE_HEADER")
        headers[key]=value.strip()
    if b"transfer-encoding" in headers or headers.get(b"content-type")!=b"application/json":
        raise ValueError("HEADER_UNSUPPORTED")
    length=headers.get(b"content-length",b"")
    if not length.isdigit() or int(length)<=0: raise ValueError("CONTENT_LENGTH_INVALID")
    size=int(length)
    if size>MAX_BODY: raise OverflowError("BODY_TOO_LARGE")
    while len(body)<size:
        chunk=conn.recv(min(2048,size-len(body)))
        if not chunk: raise ValueError("BODY_INCOMPLETE")
        body+=chunk
    if len(body)!=size: raise ValueError("BODY_LENGTH_MISMATCH")
    return require_owner_outbox,body


class _Handler(socketserver.StreamRequestHandler):
    approval_reader_fn: Callable[...,dict] | None = None
    db_path = "/opt/ai-coding-standalone-dev/tasks.db"
    operational = True

    def handle(self):
        try:
            require_outbox,raw=_read_request(self.request)
            req=json.loads(raw.decode("utf-8"))
            if not isinstance(req,dict) or set(req)!={"lookup","observedAt"}:
                raise ValueError("REQUEST_SHAPE_INVALID")
            lookup=req["lookup"]
            if not isinstance(lookup,dict) or set(lookup)!=set(LOOKUP_FIELDS):
                raise ValueError("LOOKUP_SHAPE_INVALID")
            # Do not let the requester backdate approval expiry checks.
            server_now_ms = int(time.time() * 1000)
            client_now_ms = req["observedAt"]
            if (type(client_now_ms) is not int
                    or abs(client_now_ms - server_now_ms) > 5000):
                raise ValueError("UNTRUSTED_APPROVAL_OBSERVATION_TIME")
            reader=type(self).approval_reader_fn or _load_reader()
            result=reader(
                self.db_path,lookup,server_now_ms,
                operational=self.operational,
                **({"require_owner_outbox":True} if require_outbox else {}),
            )
            proven=(
                result.get("persistedTrustedReadProven") is True
                and (not require_outbox or
                     result.get("sourceOutboxMatched") is True)
            )
            self.wfile.write(_response(200 if proven else 404,{
                "ok":proven,"environment":"DEV","result":result,
                "approvalReadOnly":True,"decisionCreated":False,
                "signingPermitted":False,"authorizationGranted":False,
                "dispatchPermitted":False,"releaseDecision":"NO_GO",
            }))
        except LookupError:
            self.wfile.write(_response(404,{"ok":False,"reason":"NOT_FOUND","releaseDecision":"NO_GO"}))
        except OverflowError:
            self.wfile.write(_response(413,{"ok":False,"reason":"REQUEST_TOO_LARGE","releaseDecision":"NO_GO"}))
        except (ValueError,UnicodeError,json.JSONDecodeError):
            self.wfile.write(_response(400,{"ok":False,"reason":"APPROVAL_LOOKUP_REJECTED","releaseDecision":"NO_GO"}))
        except Exception:
            self.wfile.write(_response(503,{"ok":False,"reason":"APPROVAL_READER_UNAVAILABLE","releaseDecision":"NO_GO"}))


class _UnixServer(socketserver.UnixStreamServer):
    allow_reuse_address=False
    daemon_threads=True


def serve(socket_path:str,group_name:str,once:bool=False)->int:
    reader=_load_reader()
    if once:
        # Metadata-only file security check; no approval row is fetched.
        st=os.lstat("/opt/ai-coding-standalone-dev/tasks.db")
        if stat.S_ISLNK(st.st_mode) or not stat.S_ISREG(st.st_mode) or st.st_uid!=0 or st.st_gid!=0 or stat.S_IMODE(st.st_mode)!=0o600:
            raise RuntimeError("APPROVAL_DB_FILE_SECURITY_INVALID")
        print(json.dumps({"environment":"DEV","approvalReaderLoaded":True,
          "databaseFileSecurityVerified":True,"databaseMutation":False,
          "signingPermitted":False,"dispatchPermitted":False,"releaseDecision":"NO_GO"},sort_keys=True))
        return 0
    parent=Path(socket_path).parent
    # systemd RuntimeDirectory=gpt02-approval-reader owns this directory and
    # sets mode 0750 so members of the signer group can traverse to the socket.
    # Refuse 0700 (unusable for signers) and any world-accessible directory.
    parent.mkdir(mode=0o750,parents=True,exist_ok=True)
    pst=os.lstat(parent)
    expected_gid=grp.getgrnam(group_name).gr_gid
    if (stat.S_ISLNK(pst.st_mode) or not stat.S_ISDIR(pst.st_mode)
            or pst.st_uid!=os.getuid() or pst.st_gid!=expected_gid
            or stat.S_IMODE(pst.st_mode)!=0o750):
        raise RuntimeError("SOCKET_DIRECTORY_INVALID")
    if os.path.lexists(socket_path): raise RuntimeError("SOCKET_PATH_ALREADY_EXISTS")
    _Handler.approval_reader_fn=reader
    server=_UnixServer(socket_path,_Handler)
    gid=grp.getgrnam(group_name).gr_gid
    os.chown(socket_path,os.getuid(),gid);os.chmod(socket_path,0o660)
    st=os.lstat(socket_path)
    if not stat.S_ISSOCK(st.st_mode) or st.st_uid!=os.getuid() or st.st_gid!=gid or stat.S_IMODE(st.st_mode)!=0o660:
        server.server_close();raise RuntimeError("SOCKET_PERMISSION_VERIFICATION_FAILED")
    stopped=False
    def stop(_sig,_frame):
        nonlocal stopped
        stopped=True
    signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
    server.timeout=0.5
    try:
        while not stopped: server.handle_request()
    finally:
        server.server_close()
        try:os.unlink(socket_path)
        except FileNotFoundError:pass
    return 0


def main():
    p=argparse.ArgumentParser()
    p.add_argument("--once",action="store_true")
    p.add_argument("--socket",default=os.environ.get("GPT02_APPROVAL_READER_SOCKET",DEFAULT_SOCKET))
    p.add_argument("--socket-group",default="gpt02-issue159-signers")
    a=p.parse_args()
    return serve(a.socket,a.socket_group,a.once)


if __name__=="__main__":
    raise SystemExit(main())
