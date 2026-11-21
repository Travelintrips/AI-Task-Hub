#!/usr/bin/env python3
"""Task183 independent Owner provenance adapter; read-only, fail-closed.

Accepts complete recovery claims, not caller-provided boolean authorization.
Uses the EXISTING decision reader. No signer, issuer, dispatch, or DB writes.
A non-cryptographic decision provenance check is NOT an Ed25519 signature.
"""
from __future__ import annotations
import hashlib
import importlib.util
import json
import time
from pathlib import Path

ROOT=Path(__file__).resolve().parent
READ_SOURCE=ROOT/"task183-owner-recovery-decision-reader.py"
REQUIRED=("version","environment","audience","companyId","hubTaskId",
    "recoveryAttemptNumber","requestId","evidenceSha256","originalCoreTaskId",
    "originalHubExecutionId","originalAttemptId","ownerSubject","nonce",
    "issuedAt","expiresAt","purpose","dispatchPermitted")
DOMAIN="GPT02_TASK183_RECOVERY_ISSUER_APPROVAL_V1"

class AuthorizationDenied(ValueError):pass

def _reader():
    spec=importlib.util.spec_from_file_location("task183_existing_reader",READ_SOURCE)
    m=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m

def authorize_recovery(*,claims,now_ms=None,db_path=None,operational=False):
    """Return normalized, non-authorizing readback for exact Task183 claims."""
    now=int(time.time()*1000) if now_ms is None else now_ms
    if type(claims) is not dict or set(claims)!=set(REQUIRED):
        raise AuthorizationDenied("TASK183_CLAIM_FIELDS_INVALID")
    if (claims["version"]!=1 or claims["environment"]!="DEV"
        or claims["audience"]!=DOMAIN or claims["companyId"]!="default"
        or type(claims["hubTaskId"]) is not int or claims["hubTaskId"]!=183
        or type(claims["recoveryAttemptNumber"]) is not int
        or claims["recoveryAttemptNumber"]!=2
        or claims["purpose"]!="PREPARE_ATTEMPT2_ONLY"
        or claims["dispatchPermitted"] is not False):
        raise AuthorizationDenied("TASK183_CLAIM_SCOPE_DENIED")
    if (type(claims["issuedAt"]) is not int or type(claims["expiresAt"]) is not int
        or claims["issuedAt"]>now+5000 or claims["issuedAt"]<now-300000
        or claims["expiresAt"]<=now or claims["expiresAt"]>claims["issuedAt"]+300000):
        raise AuthorizationDenied("TASK183_CLAIM_EXPIRY_DENIED")
    m=_reader()
    if (claims["requestId"]!=m.REQUEST or claims["evidenceSha256"]!=m.EVIDENCE):
        raise AuthorizationDenied("TASK183_EXACT_REQUEST_OR_EVIDENCE_REQUIRED")
    payload=json.dumps({k:claims[k] for k in REQUIRED},ensure_ascii=False,separators=(",",":")).encode()
    digest=hashlib.sha256((DOMAIN+"\n").encode()+payload).hexdigest()
    lookup={"claimsSha256":digest,"taskId":183,"requestId":claims["requestId"],
            "evidenceSha256":claims["evidenceSha256"],
            "ownerSubject":claims["ownerSubject"],"nonce":claims["nonce"],
            "observedAt":now}
    args={"operational":operational,"now":now}
    if db_path is not None:args["db_path"]=str(db_path)
    record=m.read_decision(lookup,**args)
    expected={"ok":True,"environment":"DEV",
        "source":"task183-independent-recovery-approval-reader","readOnly":True,
        "releaseDecision":"NO_GO","claimsSha256":digest,
        "requestId":claims["requestId"],"ownerSubject":claims["ownerSubject"],
        "evidenceSha256":claims["evidenceSha256"],
        "signatureVerified":False,"persistedIndependentOwnerDecision":True,
        "issuerAuthorizationGranted":False,"dispatchPermitted":False}
    if type(record) is not dict or any(record.get(k)!=v for k,v in expected.items()):
        raise AuthorizationDenied("TASK183_PERSISTED_INDEPENDENT_OWNER_DECISION_MISSING")
    return {"decisionProvenanceVerified":True,"approvalDigest":digest,
            "requestId":claims["requestId"],"evidenceSha256":claims["evidenceSha256"],
            "ownerSubject":claims["ownerSubject"],
            "signatureVerified":False,"issuerAuthorized":False,
            "dispatchPermitted":False,"releaseDecision":"NO_GO"}
