#!/usr/bin/env python3
"""Task183 operational custody negative-only readiness check. NO real writes.

Requires root privileges, exact live CST-DEV store and absent Owner decision.
No application approval, broker unit activation, signing or issuer command.
"""
import importlib.util
import os
from pathlib import Path

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("engine",HERE/"task183-two-phase-signing.candidate.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
n=0
def check(name,ok):
 global n
 assert ok,name
 n+=1
 print("PASS:"+name)
def denied(name,fn):
 try:fn()
 except ValueError:check(name,True)
 else:check(name,False)

def run():
 if os.geteuid()!=0:
  raise RuntimeError("ROOT_READ_ONLY_PROOF_REQUIRED")
 before=m.custody.audit(operational=True)
 check("ROOT_CUSTODY_EXISTS_AND_EMPTY",before["installed"] and before["total"]==0)
 engine=m.TwoPhase(m.custody.STORE,fixture_only=False)
 check("PINNED_ROOT_CUSTODY_LOADED",engine.operational is True and engine.store==m.custody.STORE)
 denied("OTHER_ROOT_STORE_DENIED",lambda:m.TwoPhase(Path("/tmp/task183-two-phase-fixture-fake/receipts.db"),fixture_only=False))
 denied("OTHER_MODE_TYPE_DENIED",lambda:m.TwoPhase(m.custody.STORE,fixture_only="false"))
 args={"digest":"a"*64,"request":"6bcd8419254dc21c0b149eb09e68a7b6da66",
       "evidence":"89950d3b8ac91aac612810325c6a219cb898a6fa41b234a477f0dbe32d85eb7b"}
 denied("NO_OWNER_READBACK_NO_RESERVE",lambda:engine.reserve(**args,independent_owner_readback=False))
 after=m.custody.audit(operational=True)
 check("ROOT_CUSTODY_UNCHANGED",after==before)
 check("NO_SIGNED_RECEIPT",after["completed"]==0 and after["unresolved"]==0)
 check("ISSUER_DISPATCH_NOT_GRANTED",not after["issuerAuthorized"] and not after["dispatchPermitted"])
 print(f"RESULT={n}/{n} PASS")
 print("ROOT_DB_CHANGED=FALSE")
 print("REAL_SIGNER_CALLED=FALSE")
 print("PROD_CHANGED=FALSE")

if __name__=="__main__":run()
