#!/usr/bin/env python3
"""CST-DEV Task183 root receipt broker runtime. NO implicit release.

This is a guarded *operational candidate*. It never loads a private key, never
creates Owner approval, and never grants issuer or dispatch. The service must
remain disabled until a separately reviewed release gate allows it.
"""
from __future__ import annotations

import grp
import importlib.util
import os
from pathlib import Path
import signal
import stat
import threading

ROOT=Path("/opt/ai-coding-standalone-dev/qa")
DB=Path("/var/lib/cst-dev-task183-recovery/signature-custody.sqlite3")
SOCKET_DIR=Path("/run/cst-task183-root-broker")
SOCKET=SOCKET_DIR/"broker.sock"
SENTINEL=Path("/etc/gpt02-dev/task183-broker-release.approved")
SIGNER_GROUP="gpt02-issue159-signers"

def fail(reason):
    raise RuntimeError(reason)

def load(name,filename):
    p=ROOT/filename
    st=os.lstat(p)
    if (not stat.S_ISREG(st.st_mode) or stat.S_ISLNK(st.st_mode)
        or st.st_uid!=0 or st.st_gid!=0
        or stat.S_IMODE(st.st_mode)!=0o400):
        fail("BROKER_MODULE_CUSTODY_INVALID")
    spec=importlib.util.spec_from_file_location(name,p)
    m=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m

MODULES={
 "bridge":"task183-two-phase-unix-bridge.candidate.py",
 "policy":"task183-systemd-peer-policy.candidate.py",
 "owner":"task183-reader-backed-broker-authorization.candidate.py",
 "verify":"task183-pinned-broker-verifier.candidate.py",
 "custody":"task183-dormant-signature-custody.py",
}

def preflight():
    if os.geteuid()!=0 or os.getegid()!=0:
        fail("ROOT_BROKER_CUSTODY_REQUIRED")
    if not SENTINEL.exists() or SENTINEL.is_symlink():
        fail("TASK183_RELEASE_SENTINEL_ABSENT")
    st=os.lstat(SENTINEL)
    if not stat.S_ISREG(st.st_mode) or st.st_uid!=0 or st.st_gid!=0 or stat.S_IMODE(st.st_mode)!=0o400:
        fail("TASK183_RELEASE_SENTINEL_CUSTODY_INVALID")
    # Sentinel contents are deliberately not interpreted as Owner approval.
    if SENTINEL.read_text().strip()!="CST_DEV_TASK183_BROKER_RELEASE_V1":
        fail("TASK183_RELEASE_SENTINEL_INVALID")
    modules={k:load(k,v) for k,v in MODULES.items()}
    state=modules["custody"].audit(operational=True)
    if not (state["installed"] is True and state["total"]==0 and
            state["unresolved"]==0 and state["completed"]==0 and
            state["issuerAuthorized"] is False and state["dispatchPermitted"] is False):
        fail("TASK183_LIVE_CUSTODY_NOT_PRISTINE")
    # Verify trust fingerprint up-front. Owner decisions remain read-only.
    verifier=modules["verify"].make_verifier(operational=True)
    trust=modules["verify"].v
    trust._key(trust.PINNED,operational=True)
    owner=modules["owner"].make_recovery_authorizer(operational=True)
    return modules,owner,verifier

def serve():
    modules,owner,verify=preflight()
    gid=grp.getgrnam(SIGNER_GROUP).gr_gid
    st=os.lstat(SOCKET_DIR)
    if not stat.S_ISDIR(st.st_mode) or stat.S_ISLNK(st.st_mode):
        fail("BROKER_RUNTIME_DIRECTORY_INVALID")
    if st.st_uid!=0 or stat.S_IMODE(st.st_mode)!=0o750:
        fail("BROKER_RUNTIME_DIRECTORY_PERMISSIONS_INVALID")
    os.chown(SOCKET_DIR,0,gid)
    if os.path.lexists(SOCKET):
        fail("BROKER_SOCKET_ALREADY_EXISTS")
    bridge=modules["bridge"]
    server=bridge.Server(str(SOCKET),bridge.Handler,bind_and_activate=True)
    try:
        os.chown(SOCKET,0,gid)
        os.chmod(SOCKET,0o660)
        server.store=DB
        server.operational=True
        server.peer_verifier=modules["policy"].authenticated_peer
        server.authorize=owner
        server.verify=verify
        server.allowed_uid=-1
        server.allowed_gid=-1
        stopped=threading.Event()
        def stop(*_):
            stopped.set()
        signal.signal(signal.SIGTERM,stop)
        signal.signal(signal.SIGINT,stop)
        server.timeout=0.5
        while not stopped.is_set():
            server.handle_request()
    finally:
        server.server_close()
        try:SOCKET.unlink()
        except FileNotFoundError:pass

if __name__=="__main__":
    serve()
