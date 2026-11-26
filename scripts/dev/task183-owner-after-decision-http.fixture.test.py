#!/usr/bin/env python3
"""Run the actual STAGED CST-DEV HTTP handler using in-memory callbacks only.

No Owner credentials or DB, no signer/dispatch, no real operating unit.
"""
import importlib.util,json,threading,urllib.request,urllib.error
from pathlib import Path
from types import SimpleNamespace
from http.server import HTTPServer
SRC=Path("/opt/ai-coding-standalone-dev/qa/task183-after-owner-http-stage-20261122.py")
spec=importlib.util.spec_from_file_location("task183_owner_after_stage",SRC)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
calls={"writer":0,"after":0,"auth":0}
n=0
def check(label,yes):
 global n
 assert yes,label
 n+=1;print("PASS:"+label,flush=True)
class Review:
 def review_evidence_packet(self,actor):
  return {"readOnly":True,"ownerApprovalGranted":False,"dispatchPermitted":False,
  "evidenceSha256":"a"*64,
  "evidence":{"requestId":"b"*36,
    "coreTaskId":"10000000-1111-2222-3333-444444444444",
    "hubExecutionId":"20000000-1111-2222-3333-444444444444",
    "originalAttemptId":"30000000-1111-2222-3333-444444444444"}}
 def get_recovery_consent_state(self,actor):
  return {"recorded":True,"state":"SUPERADMIN_RECOVERY_INTENT_PENDING_INDEPENDENT_ISSUER",
          "issuerAuthority":False,"dispatchPermitted":False}
def auth(token):
 calls["auth"]+=1
 if token!="synthetic":raise ValueError("UNAUTHORIZED")
 return {"role":"super_admin","companyId":"default","authSource":"supabase_google_identity"}
class Writer:
 @staticmethod
 def record(**kwargs):
  calls["writer"]+=1
  return {"requestId":"b"*36,"recorded":True,"ownerDecisionStored":True,
    "cryptographicOwnerSignatureCreated":False,"issuerAuthorized":False,
    "attemptIssued":False,"dispatchPermitted":False,"releaseDecision":"NO_GO"}
signing={"success":True}
class After:
 @staticmethod
 def run_handoff(decision):
  calls["after"]+=1
  assert calls["writer"]==calls["after"]
  return {"taskId":183,"ownerDecisionStored":True,
    "signedEvidenceVerified":signing["success"],
    "manualReviewRequired":not signing["success"],
    "issuerAuthorized":False,"dispatchPermitted":False,"releaseDecision":"NO_GO"}
real_checked=m.checked_import
def checked(path,alias):
 if alias=="task183_owner_writer":return Writer
 if alias=="task183_owner_after_decision":return After
 return real_checked(path,alias)
m.checked_import=checked
m.verify_task183_owner_session=auth
m.load_review_intake=lambda:Review()
server=HTTPServer(("127.0.0.1",0),m.Handler)
thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
url=f"http://127.0.0.1:{server.server_port}"+m.OWNER_APPROVAL_PATH
headers={"Host":"dev-ai-task.cstlogistic.co.id","Origin":m.ORIGIN,
         "Content-Type":"application/json","X-GPT02-Intent":"approve-task183-recovery-attempt2-only",
         "Authorization":"Bearer synthetic"}
body=b'{"approveRecoveryAttempt2":true}'
def request(extras=None,data=body):
 q=urllib.request.Request(url,data=data,headers={**headers,**(extras or {})},method="POST")
 try:
  with urllib.request.urlopen(q,timeout=3) as resp:return resp.status,json.load(resp)
 except urllib.error.HTTPError as err:return err.code,json.load(err)
try:
 before=dict(calls)
 code,result=request(extras={"Authorization":"Bearer forged"})
 check("FORGED_AUTH_DENIED",code==409 and calls["writer"]==0)
 code,result=request(extras={"Origin":"https://evil.invalid"})
 check("CROSS_ORIGIN_DENIED",code==403 and calls["writer"]==0)
 code,result=request()
 check("EXPLICIT_SIGNING_PROOF_HTTP_201",code==201 and result["signedEvidenceVerified"] is True)
 check("ONE_WRITER_AND_ONE_SIGNING_HANDOFF",calls["writer"]==1 and calls["after"]==1)
 signing["success"]=False
 code,result=request()
 check("UNCERTAIN_SIGNING_HTTP_202_MANUAL_REVIEW",code==202 and result["manualReviewRequired"] is True)
 check("NO_RETRY_AFTER_FAILURE_IN_HANDLER",calls["writer"]==2 and calls["after"]==2)
 check("RESULT_NEVER_AUTHORIZES_DISPATCH",result["dispatchPermitted"] is False and result["issuerAuthorized"] is False)
finally:
 server.shutdown();server.server_close();thread.join(3)
print(f"RESULT={n}/{n} PASS")
print("REAL_OWNER_APPROVAL_WRITTEN=FALSE")
print("REAL_SIGNER_CALLED=FALSE")
