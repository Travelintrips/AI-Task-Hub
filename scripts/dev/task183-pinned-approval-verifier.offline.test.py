#!/usr/bin/env python3
"""CI-only synthetic key / manifest proof; never requires real VPS files."""
import importlib.util
import json
import hashlib
import base64
import tempfile
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding,PublicFormat

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("verify",HERE/"task183-pinned-approval-verifier.candidate.py")
v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
n=0
def check(label,yes):
 global n
 assert yes,label
 n+=1
 print("PASS:"+label)
claims={field:"fixture" for field in v.FIELDS}
claims.update(version=1,environment="DEV",audience=v.DOMAIN,companyId="default",
 hubTaskId=183,recoveryAttemptNumber=2,requestId="6bcd8419254dc21c0b149eb09e68a7b6da66",
 evidenceSha256="89950d3b8ac91aac612810325c6a219cb898a6fa41b234a477f0dbe32d85eb7b",
 ownerSubject="owner:synthetic",nonce="N"*48,issuedAt=1800000000000,
 expiresAt=1800000050000,purpose="PREPARE_ATTEMPT2_ONLY",dispatchPermitted=False)
payload=v.canonical_bytes(claims)
sha=hashlib.sha256(payload).hexdigest()
with tempfile.TemporaryDirectory(prefix="task183-signature-fixture-") as td:
 p=Path(td)/"approval-public.pem"
 manifest=Path(td)/"manifest.json"
 private=Ed25519PrivateKey.generate()
 public=private.public_key()
 pem=public.public_bytes(Encoding.PEM,PublicFormat.SubjectPublicKeyInfo)
 p.write_bytes(pem)
 manifest.write_text(json.dumps({"approval":hashlib.sha256(public.public_bytes(Encoding.DER,PublicFormat.SubjectPublicKeyInfo)).hexdigest()}))
 old_pin,old_manifest=v.PINNED,v.MANIFEST
 v.PINNED,v.MANIFEST=p,manifest
 try:
  check("SYNTHETIC_PINNED_KEY_MATCHES_MANIFEST",v._key(p,operational=False,manifest_path=manifest) is not None)
  signature=base64.urlsafe_b64encode(private.sign(payload)).decode().rstrip("=")
  args=dict(role="recovery-approval",digest=sha,request_id=claims["requestId"],
    evidence_sha256=claims["evidenceSha256"],claims=claims,signature=signature,
    key_path=p,operational=False,manifest_path=manifest)
  check("SIGNED_CANONICAL_RECOVERY_VERIFIES",v.verify(**args))
  check("BAD_NONCE_REJECTED",not v.verify(**{**args,"claims":{**claims,"nonce":"Z"*48}}))
  check("BAD_DIGEST_REJECTED",not v.verify(**{**args,"digest":"a"*64}))
  check("BAD_SIGNATURE_REJECTED",not v.verify(**{**args,"signature":"A"*86}))
  check("OTHER_ROLE_REJECTED",not v.verify(**{**args,"role":"issuer"}))
  manifest.write_text(json.dumps({"approval":"0"*64}))
  check("TRUST_MANIFEST_MISMATCH_REJECTED",not v.verify(**args))
  manifest.write_text(json.dumps({"approval":"not-a-hash"}))
  check("INVALID_MANIFEST_DENIED",not v.verify(**args))
 finally:
  v.PINNED,v.MANIFEST=old_pin,old_manifest
print(f"RESULT={n}/{n} PASS")
print("ONLY_EPHEMERAL_TEST_KEY=TRUE")
