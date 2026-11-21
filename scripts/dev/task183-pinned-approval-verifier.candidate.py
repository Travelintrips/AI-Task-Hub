#!/usr/bin/env python3
"""Task183 DEV recovery Ed25519 verifier candidate, no private key use.

Uses the existing trust-pinned approval public key. No signer service,
issuing permission, broker socket or owner decision is created.
"""
import base64
import hashlib
import json
import os
import re
import stat
from pathlib import Path
from cryptography.hazmat.primitives.serialization import load_pem_public_key,Encoding,PublicFormat
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.exceptions import InvalidSignature

DOMAIN="GPT02_TASK183_RECOVERY_ISSUER_APPROVAL_V1"
FIELDS=("version","environment","audience","companyId","hubTaskId",
"recoveryAttemptNumber","requestId","evidenceSha256","originalCoreTaskId",
"originalHubExecutionId","originalAttemptId","ownerSubject","nonce",
"issuedAt","expiresAt","purpose","dispatchPermitted")
PINNED=Path("/etc/gpt02-dev/public/approval-public.pem")
MANIFEST=Path("/etc/gpt02-dev/trust-fingerprints.json")
HEX=re.compile(r"^[a-f0-9]{64}$")
B64=re.compile(r"^[A-Za-z0-9_-]{86}$")

def fail(msg):raise ValueError(msg)

def canonical_bytes(claims):
    if type(claims) is not dict or set(claims)!=set(FIELDS):
        fail("RECOVERY_FIELDS_INVALID")
    if (claims["environment"]!="DEV" or claims["audience"]!=DOMAIN or
        claims["hubTaskId"]!=183 or claims["recoveryAttemptNumber"]!=2 or
        claims["purpose"]!="PREPARE_ATTEMPT2_ONLY" or
        claims["dispatchPermitted"] is not False):
        fail("RECOVERY_SIGNED_SCOPE_DENIED")
    return (DOMAIN+"\n").encode()+json.dumps(
        {k:claims[k] for k in FIELDS},ensure_ascii=False,separators=(",",":")
    ).encode()

def _key(path,*,operational,manifest_path=None):
    p=Path(path)
    if operational and p!=PINNED:fail("PINNED_APPROVAL_PUBLIC_KEY_REQUIRED")
    st=os.lstat(p)
    if not stat.S_ISREG(st.st_mode) or stat.S_ISLNK(st.st_mode):
        fail("PUBLIC_KEY_SOURCE_NOT_REGULAR")
    if operational and (st.st_uid!=0 or st.st_gid!=0 or stat.S_IMODE(st.st_mode)!=0o440):
        fail("PUBLIC_KEY_CUSTODY_INVALID")
    raw=p.read_bytes()
    if len(raw)>4096:fail("PUBLIC_KEY_TOO_LARGE")
    key=load_pem_public_key(raw)
    if not isinstance(key,Ed25519PublicKey):fail("PUBLIC_KEY_NOT_ED25519")
    if operational or manifest_path is not None:
        manifest=MANIFEST if manifest_path is None else Path(manifest_path)
        if operational and manifest!=MANIFEST:fail("PINNED_TRUST_MANIFEST_REQUIRED")
        trust_stat=os.lstat(manifest)
        if not stat.S_ISREG(trust_stat.st_mode) or stat.S_ISLNK(trust_stat.st_mode) or (operational and trust_stat.st_uid!=0):
            fail("TRUST_MANIFEST_CUSTODY_INVALID")
        record=json.loads(manifest.read_text())
        if (type(record) is not dict or
            type(record.get("approval")) is not str or
            not HEX.fullmatch(record["approval"])):
            fail("TRUST_APPROVAL_FINGERPRINT_MISSING")
        actual=hashlib.sha256(key.public_bytes(Encoding.DER,PublicFormat.SubjectPublicKeyInfo)).hexdigest()
        if actual!=record["approval"]:
            fail("TRUST_APPROVAL_FINGERPRINT_MISMATCH")
    return key

def verify(*,role,digest,request_id,evidence_sha256,claims,signature,key_path=PINNED,operational=True,manifest_path=None):
    if role!="recovery-approval":return False
    if type(signature) is not str or not B64.fullmatch(signature):return False
    try:
        body=canonical_bytes(claims)
        if (claims["requestId"]!=request_id or
            claims["evidenceSha256"]!=evidence_sha256 or
            not isinstance(digest,str) or not HEX.fullmatch(digest) or
            hashlib.sha256(body).hexdigest()!=digest):
            return False
        sig=base64.urlsafe_b64decode(signature+"==")
        if len(sig)!=64 or base64.urlsafe_b64encode(sig).decode().rstrip("=")!=signature:
            return False
        _key(key_path,operational=operational,manifest_path=manifest_path).verify(sig,body)
        return True
    except (ValueError,OSError,InvalidSignature,TypeError,json.JSONDecodeError):
        return False
