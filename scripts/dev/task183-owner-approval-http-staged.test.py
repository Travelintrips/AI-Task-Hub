#!/usr/bin/env python3
"""Actual staged HTTP handler test on isolated localhost ephemeral port.

Uses the EXACT patched broker handler but replaces JWT and writer with
synthetic callbacks. Never calls live Owner writer, PostgreSQL, approval DB,
signer, or dispatch.
"""
import importlib.util,json,threading,urllib.request,urllib.error
from http.server import HTTPServer
from pathlib import Path
STAGED=Path("/opt/ai-coding-standalone-dev/qa/task183-owner-http-stage-20261122/task183-single-click-broker-dev.py")
spec=importlib.util.spec_from_file_location("owner_http_staged",STAGED)
broker=importlib.util.module_from_spec(spec);spec.loader.exec_module(broker)
n=0
calls={"writer":0,"jwt":0,"reader":0}
def check(label,yes):
 global n
 assert yes,label
 n+=1
 print("PASS:"+label,flush=True)
actor={"role":"super_admin","companyId":"default","authSource":"supabase_google_identity"}
class Review:
 def review_evidence_packet(self,actor):
  calls["reader"]+=1
  return {"readOnly":True,"ownerApprovalGranted":False,"dispatchPermitted":False,
    "evidenceSha256":"a"*64,
    "evidence":{"requestId":"b"*36,
        "coreTaskId":"10000000-1111-2222-3333-444444444444",
        "hubExecutionId":"20000000-1111-2222-3333-444444444444",
        "originalAttemptId":"30000000-1111-2222-3333-444444444444"}}
 def get_recovery_consent_state(self,actor):
  return {"recorded":True,"state":"SUPERADMIN_RECOVERY_INTENT_PENDING_INDEPENDENT_ISSUER",
          "issuerAuthority":False,"dispatchPermitted":False}
def verify_jwt(token):
 calls["jwt"]+=1
 if token!="fixture":raise ValueError("JWT_INVALID")
 return actor
class Writer:
 def record(self,**kwargs):
  calls["writer"]+=1
  assert kwargs["explicit_action"] is True
  assert kwargs["evidence"]["requestId"]=="b"*36
  return {"requestId":"b"*36,"recorded":True,"ownerDecisionStored":True,
    "cryptographicOwnerSignatureCreated":False,"issuerAuthorized":False,
    "attemptIssued":False,"dispatchPermitted":False,"releaseDecision":"NO_GO"}
orig_checked=broker.checked_import
def checked(path,alias):
 if alias=="task183_owner_writer":return Writer()
 return orig_checked(path,alias)
broker.checked_import=checked
broker.verify_jwt=verify_jwt
broker.load_review_intake=lambda:Review()
server=HTTPServer(("127.0.0.1",0),broker.Handler)
thread=threading.Thread(target=server.serve_forever,daemon=True)
thread.start()
host=f"http://127.0.0.1:{server.server_port}"
path=broker.OWNER_APPROVAL_PATH
body=b'{"approveRecoveryAttempt2":true}'
headers={"Host":"dev-ai-task.cstlogistic.co.id","Origin":broker.ORIGIN,
  "Content-Type":"application/json","X-GPT02-Intent":"approve-task183-recovery-attempt2-only",
  "Authorization":"Bearer fixture"}
def request(data=body,extras=None):
 h={**headers,**(extras or {})}
 q=urllib.request.Request(host+path,data=data,headers=h,method="POST")
 try:
  with urllib.request.urlopen(q,timeout=3) as r:return r.status,json.load(r)
 except urllib.error.HTTPError as e:return e.code,json.load(e)
try:
 for name,extras,expect in [
  ("MISSING_ORIGIN",{"Origin":"https://wrong.example"},403),
  ("BAD_INTENT",{"X-GPT02-Intent":"review-only"},400),
  ("NO_AUTH",{"Authorization":""},401),
  ("FAKE_TOKEN",{"Authorization":"Bearer forged"},409)]:
  old=calls["writer"]
  status,_=request(extras=extras)
  check(name,status==expect and calls["writer"]==old)
 old=calls["writer"]
 status,_=request(data=b'{"actor":"owner"}')
 check("CLIENT_ACTOR_BODY_REJECTED",status==400 and calls["writer"]==old)
 status,result=request()
 check("AUTHORIZED_EXPLICIT_POST_REACHES_SYNTHETIC_WRITER",status==201 and calls["writer"]==old+1)
 check("ISSUER_DISPATCH_NOT_GRANTED",result["issuerAuthorized"] is False and result["dispatchPermitted"] is False)
 check("RELEASE_REMAINS_NO_GO",result["releaseDecision"]=="NO_GO")
finally:
 server.shutdown();server.server_close();thread.join(3)
print(f"RESULT={n}/{n} PASS")
print("REAL_OWNER_WRITER_CALLED=FALSE")
print("REAL_APPROVAL_DB_CHANGED=FALSE")
