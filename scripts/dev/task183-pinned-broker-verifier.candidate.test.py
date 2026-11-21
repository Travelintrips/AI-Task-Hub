#!/usr/bin/env python3
"""Synthetic full Unix broker signature verification through a pinned manifest."""
import base64,hashlib,importlib.util,json,os,tempfile
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding,PublicFormat
HERE=Path(__file__).resolve().parent
def load(name,file):
 s=importlib.util.spec_from_file_location(name,HERE/file)
 x=importlib.util.module_from_spec(s);s.loader.exec_module(x);return x
bridge=load("bridge","task183-two-phase-unix-bridge.candidate.py")
pinned=load("pinned","task183-pinned-broker-verifier.candidate.py")
n=0
def _override_rejected():
 try:pinned.make_verifier(operational=True,key_path=Path("/tmp/fake"))
 except ValueError:return True
 return False
def check(label,ok):
 global n
 assert ok,label
 n+=1;print("PASS:"+label)
claims={k:"fixture" for k in pinned.v.FIELDS}
claims.update(version=1,environment="DEV",audience=pinned.v.DOMAIN,companyId="default",hubTaskId=183,
 recoveryAttemptNumber=2,requestId="6bcd8419254dc21c0b149eb09e68a7b6da66",
 evidenceSha256="89950d3b8ac91aac612810325c6a219cb898a6fa41b234a477f0dbe32d85eb7b",
 ownerSubject="owner:synthetic",nonce="N"*48,issuedAt=1800000000000,
 expiresAt=1800000050000,purpose="PREPARE_ATTEMPT2_ONLY",dispatchPermitted=False)
body=pinned.v.canonical_bytes(claims)
digest=hashlib.sha256(body).hexdigest()
request={"role":"recovery-approval","approvalDigest":digest,"requestId":claims["requestId"],
         "evidenceSha256":claims["evidenceSha256"],"claims":claims}
with tempfile.TemporaryDirectory(prefix="task183-two-phase-fixture-") as td:
 root=Path(td);os.chmod(root,0o700)
 key=Ed25519PrivateKey.generate()
 pub=root/"approval-public.pem"
 manifest=root/"manifest.json"
 public=key.public_key()
 pub.write_bytes(public.public_bytes(Encoding.PEM,PublicFormat.SubjectPublicKeyInfo))
 fingerprint=hashlib.sha256(public.public_bytes(Encoding.DER,PublicFormat.SubjectPublicKeyInfo)).hexdigest()
 manifest.write_text(json.dumps({"approval":fingerprint}))
 verifier=pinned.make_verifier(operational=False,key_path=pub,manifest_path=manifest)
 calls=[0]
 def sign():
  calls[0]+=1
  return base64.urlsafe_b64encode(key.sign(body)).decode().rstrip("=")
 def invoke(store,signer=sign,verify=verifier):
  bridge.phase.custody.install(path=store,operational=False)
  s=root/"signer-two-phase.sock"
  broker=bridge.FixtureBroker(socket_path=s,store=store,
       authorize=lambda *args:True,verify=verify)
  broker.start()
  try:return bridge.client(s,request,sign_callback=signer)
  finally:broker.close()
 store=root/"correct.db"
 check("CANONICAL_SIGNATURE_PERSISTED",invoke(store)["status"]=="COMPLETED")
 check("SYNTHETIC_SIGNER_CALLED_ONCE",calls[0]==1)
 store2=root/"wrong-trust.db"
 manifest.write_text(json.dumps({"approval":"0"*64}))
 check("MISMATCHED_MANIFEST_DENIED",invoke(store2)["status"]=="DENIED")
 check("FAILED_SIGNATURE_STAYS_UNRESOLVED",bridge.phase.custody.audit(path=store2,operational=False)["unresolved"]==1)
 manifest.write_text(json.dumps({"approval":fingerprint}))
 store3=root/"wrong-signature.db"
 wrong=Ed25519PrivateKey.generate()
 check("DIFFERENT_KEY_SIGNATURE_DENIED",invoke(store3,signer=lambda:base64.urlsafe_b64encode(wrong.sign(body)).decode().rstrip("="))["status"]=="DENIED")
 check("INVALID_SIG_NOT_COMPLETED",bridge.phase.custody.audit(path=store3,operational=False)["completed"]==0)
 check("OPERATIONAL_TRUST_OVERRIDE_REFUSED",True if _override_rejected() else False)
 print("REAL_CST_DEV_KEY_NOT_USED=TRUE")
 print("RESULT="+str(n)+"/"+str(n)+" PASS")
