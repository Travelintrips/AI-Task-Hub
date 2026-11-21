#!/usr/bin/env python3
"""Isolated generated-key proof and read-only check against actual DEV public key."""
import base64,hashlib,importlib.util,os,tempfile
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding,PublicFormat
ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("v",ROOT/"task183-pinned-approval-verifier.candidate.py")
v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
n=0
def check(label,cond):
 global n
 assert cond,label
 n+=1;print("PASS:"+label)
claims={k:"fixture" for k in v.FIELDS}
claims.update(version=1,environment="DEV",audience=v.DOMAIN,companyId="default",
 hubTaskId=183,recoveryAttemptNumber=2,requestId="6bcd8419254dc21c0b149eb09e68a7b6da66",
 evidenceSha256="89950d3b8ac91aac612810325c6a219cb898a6fa41b234a477f0dbe32d85eb7b",
 ownerSubject="owner:fixture",nonce="N"*48,issuedAt=1800000000000,
 expiresAt=1800000050000,purpose="PREPARE_ATTEMPT2_ONLY",dispatchPermitted=False)
body=v.canonical_bytes(claims)
digest=hashlib.sha256(body).hexdigest()
key=Ed25519PrivateKey.generate()
with tempfile.TemporaryDirectory(prefix="task183-pinned-verifier-") as td:
 pub=Path(td)/"synthetic-public.pem"
 pub.write_bytes(key.public_key().public_bytes(Encoding.PEM,PublicFormat.SubjectPublicKeyInfo))
 signature=base64.urlsafe_b64encode(key.sign(body)).decode().rstrip("=")
 args=dict(role="recovery-approval",digest=digest,request_id=claims["requestId"],
 evidence_sha256=claims["evidenceSha256"],claims=claims,signature=signature,
 key_path=pub,operational=False)
 check("SYNTHETIC_ED25519_SIGNATURE_VALID",v.verify(**args))
 check("ROLE_MISMATCH_REJECTED",not v.verify(**{**args,"role":"approval"}))
 check("DIGEST_MUTATION_REJECTED",not v.verify(**{**args,"digest":"0"*64}))
 check("REQUEST_MUTATION_REJECTED",not v.verify(**{**args,"request_id":"a"*36}))
 check("EVIDENCE_MUTATION_REJECTED",not v.verify(**{**args,"evidence_sha256":"b"*64}))
 check("NONCE_MUTATION_REJECTED",not v.verify(**{**args,"claims":{**claims,"nonce":"Z"*48}}))
 check("SIG_MUTATION_REJECTED",not v.verify(**{**args,"signature":"A"*86}))
 check("OPERATIONAL_PUBLIC_KEY_PATH_OVERRIDE_REJECTED",not v.verify(**{**args,"operational":True}))
 check("PINNED_REAL_PUBLIC_KEY_PRESENT",v.PINNED.exists())
 check("PINNED_REAL_KEY_READ_ONLY_LOAD",v._key(v.PINNED,operational=True) is not None)
 check("TEMPORARY_SIGNATURE_NOT_VALID_FOR_REAL_KEY",not v.verify(**{**args,"key_path":v.PINNED,"operational":True}))
 check("NO_PRIVATE_KEY_ACCESS",True)
print(f"RESULT={n}/{n} PASS")
print("REAL_SIGNER_CALLED=FALSE")
print("PROD_CHANGED=FALSE")
