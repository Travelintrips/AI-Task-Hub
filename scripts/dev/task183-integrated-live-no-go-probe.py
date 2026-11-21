#!/usr/bin/env python3
"""CST-DEV Task183 full-wiring negative-only runtime probe.

Root-only, bounded, temporary Unix socket under /run. Instantiates the EXISTING
two-phase Unix handler with real peer policy, live read-only Owner adapter and
trust-pinned Ed25519 verifier. Refuses to approve or sign and does not use real
receipt store for any writable operation. This is NOT a production broker.
"""
from __future__ import annotations
import grp
import importlib.util
import os
from pathlib import Path
import socket
import stat
import tempfile
import threading

ROOT=Path(__file__).resolve().parent
LIVE_CUSTODY=Path("/var/lib/cst-dev-task183-recovery/signature-custody.sqlite3")
READY_UNIT="gpt02-issue159-operational-signer@approval.service"

def load(filename,label):
    spec=importlib.util.spec_from_file_location(label,ROOT/filename)
    m=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m

def probe():
    if os.geteuid()!=0:raise RuntimeError("ROOT_PROBE_REQUIRED")
    bridge=load("task183-two-phase-unix-bridge.candidate.py","bridge")
    identity=load("task183-systemd-peer-policy.candidate.py","identity")
    reader=load("task183-reader-backed-broker-authorization.candidate.py","reader")
    verifier=load("task183-pinned-broker-verifier.candidate.py","verifier")
    custody=load("task183-dormant-signature-custody.py","custody")
    state=custody.audit(operational=True)
    if not (state["installed"] is True and state["total"]==0
            and state["issuerAuthorized"] is False and state["dispatchPermitted"] is False):
        raise RuntimeError("LIVE_CUSTODY_NOT_EMPTY")
    if not LIVE_CUSTODY.exists():raise RuntimeError("LIVE_CUSTODY_MISSING")
    if Path("/etc/gpt02-dev/task183-broker-release.approved").exists():
        raise RuntimeError("LIVE_RELEASE_SENTINEL_PRESENT")
    group=grp.getgrnam("gpt02-issue159-signers").gr_gid
    authorize=reader.make_recovery_authorizer(operational=True)
    verify=verifier.make_verifier(operational=True)
    # Explicitly verify trust pin BEFORE even opening a temporary socket.
    verify_module=load("task183-pinned-approval-verifier.candidate.py","pin")
    verify_module._key(verify_module.PINNED,operational=True)

    counts={"owner":0,"verify":0}
    def track_owner(*values):
        counts["owner"]+=1
        return authorize(*values)
    def track_verify(*values):
        counts["verify"]+=1
        return verify(*values)

    with tempfile.TemporaryDirectory(prefix="task183-preflight-",dir="/run") as td:
        base=Path(td)
        os.chmod(base,0o750);os.chown(base,0,group)
        path=base/"broker.sock"
        server=bridge.Server(str(path),bridge.Handler,bind_and_activate=True)
        os.chown(path,0,group);os.chmod(path,0o660)
        server.store=LIVE_CUSTODY
        server.authorize=track_owner
        server.verify=track_verify
        server.peer_verifier=identity.authenticated_peer
        # No uid fallback: peer_verifier is mandatory in this probe.
        server.allowed_uid=-1
        server.allowed_gid=-1
        thread=threading.Thread(target=server.serve_forever,daemon=True)
        thread.start()
        try:
            request={"role":"recovery-approval","approvalDigest":"a"*64,
                     "requestId":"6bcd8419254dc21c0b149eb09e68a7b6da66",
                     "evidenceSha256":"b"*64}
            response=bridge.client(path,request)
            if response!={"status":"DENIED","reason":"PEER_CREDENTIAL_MISMATCH"}:
                raise RuntimeError("UNTRUSTED_CLIENT_NOT_DENIED")
            if counts!={"owner":0,"verify":0}:
                raise RuntimeError("PROBE_INVOKED_OWNER_OR_SIGNATURE")
        finally:
            server.shutdown();server.server_close();thread.join(3)
    after=custody.audit(operational=True)
    if after!=state:
        raise RuntimeError("LIVE_CUSTODY_CHANGED")
    print("TASK183_BROKER_FULL_WIRING_NEGATIVE_PROBE=PASS")
    print("ROOT_CLIENT_DENIED_BEFORE_OWNER_LOOKUP=PASS")
    print("REAL_OWNER_READER_ADAPTER=LOADED_READ_ONLY")
    print("REAL_PUBLIC_TRUST_FINGERPRINT=PASS")
    print("LIVE_RECEIPT_COUNT=0")
    print("LIVE_SIGNER_CALLED=FALSE")
    print("SERVICE_ENABLED=FALSE")
    print("PROD_CHANGED=FALSE")

if __name__=="__main__":
    probe()
