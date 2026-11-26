#!/usr/bin/env python3
"""Task189 reader-backed Unix broker authorization candidate, NO live service.

This is a trusted callback for the preexisting fixture-only Unix bridge.
It validates complete canonical recovery claims against the pinned root-owned
decision reader; it never accepts a caller-supplied approval boolean.
No real signing, approval creation or issuer/dispatch activation.
"""
import importlib.util
from pathlib import Path

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location(
    "task189_authorization_adapter",
    HERE/"task189-independent-owner-adapter.candidate.py")
adapter=importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)

def make_recovery_authorizer(*, operational=False, db_path=None, now_ms=None):
    """Reader-backed authorize callback; approval role deliberately stays NO-GO."""
    if operational is True and db_path is not None:
        raise ValueError("OPERATIONAL_DB_OVERRIDE_DENIED")
    def authorize(role,digest,request_id,evidence_sha256,claims=None):
        if role!="recovery-approval" or type(claims) is not dict:
            return False
        if (claims.get("requestId")!=request_id or
            claims.get("evidenceSha256")!=evidence_sha256):
            return False
        try:
            args={"claims":claims,"operational":operational}
            if db_path is not None:args["db_path"]=db_path
            if now_ms is not None:args["now_ms"]=now_ms
            result=adapter.authorize_recovery(**args)
        except (adapter.AuthorizationDenied,ValueError,TypeError,OSError):
            return False
        return (
            result.get("decisionProvenanceVerified") is True
            and result.get("approvalDigest")==digest
            and result.get("requestId")==request_id
            and result.get("evidenceSha256")==evidence_sha256
            and result.get("signatureVerified") is False
            and result.get("issuerAuthorized") is False
            and result.get("dispatchPermitted") is False
            and result.get("releaseDecision")=="NO_GO"
        )
    return authorize
