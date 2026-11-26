#!/usr/bin/env python3
"""Exact source regression for staged Task183 recovery-only signer.

Proves the original approval, Hub, Core and issuer methods are unchanged,
while only recovery signing routes through the durable Unix gate. No service
activation or cryptographic key is used.
"""
import ast,hashlib,importlib.util
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("stage",HERE/"task183-stage-exact-recovery-signer.candidate.py")
stage=importlib.util.module_from_spec(spec);spec.loader.exec_module(stage)
BASE=HERE/"task183-exact-live-operational-signer.snapshot.py.txt"
original=BASE.read_text()
candidate=stage.make(original)
n=0
def check(label,ok):
 global n
 assert ok,label
 n+=1
 print("PASS:"+label)
def methods(source):
 tree=ast.parse(source)
 signer=next(x for x in tree.body if isinstance(x,ast.ClassDef) and x.name=="Signer")
 return {x.name:ast.get_source_segment(source,x) for x in signer.body if isinstance(x,ast.FunctionDef)}
a,b=methods(original),methods(candidate)
check("EXACT_PINNED_ORIGINAL_SHA",hashlib.sha256(original.encode()).hexdigest()==stage.BASE_SHA)
for name in ("sign_approval","sign_hub","sign_core","sign_issuer"):
 check("PRESERVED_"+name.upper(),a[name]==b[name])
check("RECOVERY_METHOD_CHANGES",a["sign_recovery_approval"]!=b["sign_recovery_approval"])
check("RECOVERY_GATED", 'self._task183_sign_with_gate(' in b["sign_recovery_approval"])
check("RECOVERY_DIRECT_SIGN_REMOVED", 'self.key.sign(recovery_signing_bytes(claims))' not in candidate)
check("UNIX_GATE_CONSTRUCTOR_INSTALLED", 'task183_gate=_task183_mod.SignerGate()' in candidate)
check("DYNAMIC_USER_GROUP_CUSTODY_CHECK", 'getgrnam("gpt02-issue159-signers")' in candidate and '!=0o440' in candidate)
check("APPROVAL_SIGNATURE_STILL_DIRECT", 'self.key.sign(signing_bytes("approval",c))' in b["sign_approval"])
try:stage.make(original+"# untrusted drift\n")
except ValueError:check("SOURCE_DRIFT_REFUSED",True)
else:check("SOURCE_DRIFT_REFUSED",False)
compile(candidate,"staged-task183-signer","exec")
check("STAGED_SIGNER_COMPILES",True)
print(f"RESULT={n}/{n} PASS")
print("LIVE_SIGNER_CHANGED=FALSE")
