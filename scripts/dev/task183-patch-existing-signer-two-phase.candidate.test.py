#!/usr/bin/env python3
"""Test both actual signer methods in an isolated source clone and ephemeral Ed25519 key.

Read-only source clone: no live systemd service, PostgreSQL, keys or approvals.
"""
import base64
import hashlib
import importlib.util
import sqlite3
import tempfile
import time
import types
import uuid
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

HERE=Path(__file__).resolve().parent
LIVE=HERE/"task183-exact-live-operational-signer.snapshot.py.txt"
def load(name,filename):
    spec=importlib.util.spec_from_file_location(name,HERE/filename)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module
patcher=load("task183_patcher","task183-patch-existing-signer-two-phase.candidate.py")
phase=load("task183_phase","task183-two-phase-signing.candidate.py")
n=0
def check(label,condition):
    global n
    assert condition,label
    n+=1
    print("PASS:"+label)
def denied(label,fn):
    try:fn()
    except (ValueError,RuntimeError):check(label,True)
    else:check(label,False)

class CountingKey:
    def __init__(self):
        self.key=Ed25519PrivateKey.generate()
        self.calls=0
    def sign(self,payload):
        self.calls+=1
        return self.key.sign(payload)
    def public_key(self):
        return self.key.public_key()

with tempfile.TemporaryDirectory(prefix="task183-two-phase-fixture-") as td:
    store=Path(td)/"receipts.sqlite"
    phase.custody.install(path=store,operational=False)
    fixture=types.ModuleType("task183_operational_signer_isolated_clone")
    exec(compile(patcher.patch(LIVE.read_text()),"<isolated-signer-clone>","exec"),fixture.__dict__)
    fixture._validate_approval=lambda c,now:None
    fixture._approval_readback=lambda c,now:("a"*64,{"fixture":True})
    fixture._presign=lambda c:{"fixture":True}
    fixture.recovery_signed_owner_readback=lambda c,now:"b"*64
    key=CountingKey()

    class FixtureGate:
        def __init__(self):
            self.crash=False
        def sign_once(self,*,role,claims,approval_digest,request_id,evidence_sha256,signing_bytes,signer_callback):
            db=phase.TwoPhase(store)
            receipt_digest=hashlib.sha256((role+":"+approval_digest).encode()).hexdigest()
            args=dict(digest=receipt_digest,request=request_id,evidence=evidence_sha256)
            reserved=db.reserve(**args,independent_owner_readback=True)
            if reserved["state"]=="UNRESOLVED_SIGNING":
                raise RuntimeError("UNRESOLVED_SIGNING")
            if reserved["state"]=="COMPLETED":
                with sqlite3.connect(store) as c:
                    signed=c.execute("SELECT signature_base64url FROM signature_receipts WHERE approval_digest=?",(receipt_digest,)).fetchone()[0]
                raw=base64.urlsafe_b64decode(signed+"==")
                key.public_key().verify(raw,signing_bytes)
                return raw
            raw=signer_callback()
            key.public_key().verify(raw,signing_bytes)
            if self.crash:
                raise RuntimeError("SYNTHETIC_CRASH_AFTER_SIGN_BEFORE_RECEIPT")
            b64=base64.urlsafe_b64encode(raw).decode().rstrip("=")
            db.complete(**args,signature=b64,
                independent_signature_verify=lambda v:key.public_key().verify(base64.urlsafe_b64decode(v+"=="),signing_bytes) is None)
            return raw

    claims={name:("fixture" if name not in ("commandId","attemptId") else str(uuid.uuid4()))
            for name in fixture.APPROVAL_FIELDS}
    claims["commandId"]=str(uuid.uuid4())
    c2={name:("fixture" if name!="requestId" else str(uuid.uuid4()))
            for name in fixture.RECOVERY_FIELDS}
    c2["requestId"]="6bcd8419254dc21c0b149eb09e68a7b6da66"
    c2["dispatchPermitted"]=False
    normal=fixture.Signer("approval",key,{},task183_gate=None)
    denied("NO_GATE_APPROVAL_FAIL_CLOSED",lambda:normal.sign_approval({"claims":claims}))
    denied("NO_GATE_RECOVERY_FAIL_CLOSED",lambda:normal.sign_recovery_approval({"claims":c2}))
    check("NO_KEY_CALL_WHEN_GATE_ABSENT",key.calls==0)
    gate=FixtureGate()
    signer=fixture.Signer("approval",key,{},task183_gate=gate)
    first=signer.sign_approval({"claims":claims})
    check("REAL_ED25519_EPHEMERAL_APPROVAL_SIG",first["signatureBase64url"] is not None and key.calls==1)
    again=signer.sign_approval({"claims":claims})
    check("APPROVAL_REPLAY_NO_NEW_SIGNATURE",again["signatureBase64url"]==first["signatureBase64url"] and key.calls==1)
    gate.crash=True
    denied("RECOVERY_CRASH_IS_TRAPPED",lambda:signer.sign_recovery_approval({"claims":c2}))
    check("RECOVERY_CRASH_ONE_CALL",key.calls==2)
    gate.crash=False
    denied("RECOVERY_REPLAY_UNRESOLVED",lambda:signer.sign_recovery_approval({"claims":c2}))
    check("RECOVERY_CRASH_NEVER_RESIGNS",key.calls==2)
    check("DURABLE_ONE_COMPLETED_ONE_UNRESOLVED",phase.custody.audit(path=store,operational=False)["completed"]==1 and phase.custody.audit(path=store,operational=False)["unresolved"]==1)
    check("ISSUER_DISPATCH_NOT_GRANTED",first["authorizationGranted"] is False and first["dispatchPermitted"] is False)
print(f"RESULT={n}/{n} PASS")
print("KEY_TYPE=EPHEMERAL_ED25519_ONLY")
print("LIVE_SIGNER_CHANGED=FALSE")
print("PROD_CHANGED=FALSE")
