#!/usr/bin/env python3
"""Test exact post-owner one-shot contract; no live decisions or signer."""
import importlib.util,os,tempfile,subprocess
from pathlib import Path
from types import SimpleNamespace
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("after_owner",HERE/"task189-owner-after-decision.candidate.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
count=0
def ok(name,condition):
 global count
 assert condition,name
 count+=1;print("PASS:"+name)
def rejected(name,fn):
 try:fn()
 except (m.HandoffDenied,OSError):ok(name,True)
 else:ok(name,False)
decision={"requestId":m.REQUEST,"recorded":True,"ownerDecisionStored":True,
 "cryptographicOwnerSignatureCreated":False,"issuerAuthorized":False,
 "attemptIssued":False,"dispatchPermitted":False,"releaseDecision":"NO_GO"}
calls=[]
def runner(args,**kwargs):
 calls.append(args)
 return SimpleNamespace(returncode=0,stdout="TASK189_ONE_SHOT_HANDOFF=PASS\nISSUER_AUTHORIZED=FALSE\nDISPATCH_PERMITTED=FALSE\n")
with tempfile.TemporaryDirectory(prefix="task189-postdecision-fixture-") as td:
 script=Path(td)/"one-shot.py"
 script.write_text("synthetic do not execute")
 os.chown(script,0,0);os.chmod(script,0o400)
 kw={"runner":runner,"path":script}
 rejected("MISSING_WRITER_RESULT_DENIED",lambda:m.run_handoff({},**kw))
 rejected("UNRECORDED_DECISION_DENIED",lambda:m.run_handoff({**decision,"recorded":False},**kw))
 rejected("ISSUER_GRANT_DENIED",lambda:m.run_handoff({**decision,"issuerAuthorized":True},**kw))
 rejected("WRONG_REQUEST_DENIED",lambda:m.run_handoff({**decision,"requestId":"fake"},**kw))
 ok("NO_SPAWN_BEFORE_APPROVED_DECISION",len(calls)==0)
 result=m.run_handoff(decision,**kw)
 ok("ONE_SHOT_SIGNING_PROOF_ACCEPTED",result["signedEvidenceVerified"] is True)
 ok("EXACTLY_ONE_SUBPROCESS_CALL",len(calls)==1 and calls[0][2]=="--execute")
 ok("NO_ISSUER_DISPATCH_AUTHORITY",not result["issuerAuthorized"] and not result["dispatchPermitted"])
 successor="a"*36
 new_decision={**decision,"requestId":successor}
 rejected("STALE_CLICK_CANNOT_SELECT_SUCCESSOR",lambda:m.run_handoff(new_decision,expected_request=m.REQUEST,**kw))
 receipt_result=m.run_handoff(new_decision,expected_request=successor,**kw)
 ok("SUCCESSOR_PASSED_TO_ONE_SHOT",calls[-2][-2:]==["--request-id",successor])
 ok("VERIFIED_SUCCESSOR_REGISTERS_EXACT_RECEIPT",receipt_result["receiptRegistered"] and
    calls[-1]==["/usr/bin/systemctl","start",f"cst-task189-register-receipt@{successor}.service"])
 def failed_registration(args,**kwargs):
  if args[0]=="/usr/bin/systemctl":
   raise subprocess.TimeoutExpired(args,25)
  return runner(args,**kwargs)
 uncertain=m.run_handoff(new_decision,expected_request=successor,runner=failed_registration,path=script)
 ok("REGISTRATION_TIMEOUT_PRESERVES_SIGNATURE",uncertain["signedEvidenceVerified"] and
    uncertain["manualReviewRequired"] and not uncertain["receiptRegistered"])
 bad=lambda *a,**k:SimpleNamespace(returncode=2,stdout="")
 result=m.run_handoff(decision,runner=bad,path=script)
 ok("ONE_SHOT_DENIAL_REPORTED_WITHOUT_RETRY",result["manualReviewRequired"] is True and result["signedEvidenceVerified"] is False)
 def timed(*a,**k):raise subprocess.TimeoutExpired(a[0],16)
 result=m.run_handoff(decision,runner=timed,path=script)
 ok("TIMEOUT_REQUIRES_MANUAL_RECONCILIATION",result["manualReviewRequired"] is True)
 os.chmod(script,0o644)
 rejected("UNSEALED_HANDOFF_SOURCE_DENIED",lambda:m.run_handoff(decision,**kw))
print(f"RESULT={count}/{count} PASS")
print("REAL_WRITER_CALLED=FALSE")
print("REAL_SIGNER_CALLED=FALSE")
