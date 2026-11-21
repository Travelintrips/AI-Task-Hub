#!/usr/bin/env python3
"""Generate fail-closed Task183 candidate from the existing signer source.

No live signer file, systemd unit, or credentials are modified.
The injected gate is an explicit integration port for a future independently
authenticated broker. A missing gate FAILS CLOSED before key.sign().
"""
import argparse
from pathlib import Path

OLD_INIT='''    def __init__(self,role,key,public):
        self.role=role; self.key=key; self.public=public
    def sign_approval(self,data):'''
NEW_INIT='''    def __init__(self,role,key,public,task183_gate=None):
        self.role=role; self.key=key; self.public=public
        self.task183_gate=task183_gate

    def _task183_sign_with_gate(self,role,claims,digest,request_id,payload):
        gate=self.task183_gate
        if gate is None or not callable(getattr(gate,"sign_once",None)):
            deny("TASK183_DURABLE_GATE_REQUIRED")
        # The signer keeps the private key. The broker must never be given it.
        result=gate.sign_once(
            role=role,claims=claims,approval_digest=digest,
            request_id=request_id,evidence_sha256=(claims["evidenceSha256"] if role=="recovery-approval" else hashlib.sha256(payload).hexdigest()),
            signing_bytes=payload,signer_callback=lambda:self.key.sign(payload))
        if type(result) is not bytes or len(result)!=64:
            deny("TASK183_DURABLE_SIGNATURE_INVALID")
        return base64.urlsafe_b64encode(result).decode().rstrip("=")

    def sign_approval(self,data):'''
OLD_RECOVERY='''        signature=base64.urlsafe_b64encode(
            self.key.sign(recovery_signing_bytes(claims))).decode().rstrip("=")'''
NEW_RECOVERY='''        signature=self._task183_sign_with_gate(
            "recovery-approval",claims,digest,claims["requestId"],
            recovery_signing_bytes(claims))'''

def patch(source):
    replacements=[(OLD_INIT,NEW_INIT),(OLD_RECOVERY,NEW_RECOVERY)]
    for old,new in replacements:
        if source.count(old)!=1:
            raise ValueError("EXACT_SIGNER_SOURCE_DRIFT")
        source=source.replace(old,new,1)
    if source.count("self.key.sign(")!=3:
        # One callback in gate, plus existing hub/core/issuer roles.
        # The original signer has additional Hub/Core/Issuer key calls;
        # ensure none of the two approval paths still sign directly.
        assert "self.key.sign(signing_bytes(\"approval\",c))" not in source
        assert "self.key.sign(recovery_signing_bytes(claims))" not in source
    if "self.key.sign(signing_bytes(\\"approval\\",c))" not in source:
        raise ValueError("EXISTING_APPROVAL_PATH_CHANGED")
    if "self.key.sign(recovery_signing_bytes(claims))" in source:
        raise ValueError("TASK183_RECOVERY_SIGNER_NOT_GATED")
    return source

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--source",required=True)
    ap.add_argument("--output",required=True)
    args=ap.parse_args()
    src=Path(args.source)
    out=Path(args.output)
    if out.exists():raise SystemExit("CANDIDATE_ALREADY_EXISTS")
    if not str(out).startswith("/tmp/task183-signer-gate-fixture-"):
        raise SystemExit("ISOLATED_CANDIDATE_ONLY")
    out.write_text(patch(src.read_text()))
    print("TASK183_APPROVAL_AND_RECOVERY_SIGNER_GATED_CANDIDATE=PASS")
    print("LIVE_SIGNER_CHANGED=FALSE")

if __name__=="__main__":main()
