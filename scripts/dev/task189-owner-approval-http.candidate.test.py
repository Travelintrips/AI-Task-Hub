#!/usr/bin/env python3
"""Synthetic HTTP adapter contract; no real JWT or decision writes."""
import importlib.util
from pathlib import Path
ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("approval",ROOT/"task189-owner-approval-http.candidate.py")
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
n=0
def check(label,cond):
 global n
 assert cond,label
 n+=1;print("PASS:"+label)
def denied(label,changes=None,**options):
 kw=dict(base)
 if changes:kw.update(changes)
 kw.update(options)
 before=calls["write"]
 try:a.authorize_request(**kw)
 except (a.ApprovalRejected,ValueError):check(label,calls["write"]==before)
 else:check(label,False)
actor={"role":"super_admin","companyId":"default","authSource":"supabase_google_identity","id":"google_fixture"}
packet={"readOnly":True,"ownerApprovalGranted":False,"dispatchPermitted":False,"evidenceSha256":"a"*64,
"evidence":{"requestId":"b"*36,"coreTaskId":"aae1fb3b-1a1a-462f-8e65-ec3944f0fce0",
 "hubExecutionId":"816767f4-4264-4931-9a82-3d9496d3da3c",
 "originalAttemptId":"bb13af4f-8085-40e8-aa9b-a7e95d6ed1fc"}}
consent={"recorded":True,"state":"SUPERADMIN_RECOVERY_INTENT_PENDING_INDEPENDENT_ISSUER",
         "issuerAuthority":False,"dispatchPermitted":False}
calls={"jwt":0,"read":0,"write":0}
class Reader:
 def review_evidence_packet(self,actor):
  calls["read"]+=1;return packet
 def get_recovery_consent_state(self,actor):return consent
def jwt(token):
 calls["jwt"]+=1
 if token!="valid":raise ValueError("JWT_BAD")
 return actor
def writer(**kwargs):
 calls["write"]+=1
 assert kwargs["actor"] is actor and kwargs["explicit_action"] is True
 assert kwargs["evidence"]["requestId"]==packet["evidence"]["requestId"]
 assert kwargs["evidence"]["originalAttemptId"]==packet["evidence"]["originalAttemptId"]
 return {"requestId":"b"*36,"recorded":True,"ownerDecisionStored":True,
 "cryptographicOwnerSignatureCreated":False,"issuerAuthorized":False,
 "attemptIssued":False,"dispatchPermitted":False,"releaseDecision":"NO_GO"}
headers={"Origin":a.ORIGIN,"Host":a.HOST,"X-GPT02-Intent":a.INTENT,
 "Content-Type":"application/json","Content-Length":str(len(a.BODY)),
 "Authorization":"Bearer valid"}
base={"path":a.PATH,"headers":headers,"body":a.BODY,
 "verify_session":jwt,"load_review":lambda:Reader(),"write_approval":writer}
def different(**kwargs):return {**headers,**kwargs}
denied("BAD_PATH_DENIED",{"path":"/wrong"})
denied("BAD_ORIGIN_DENIED",{"headers":different(Origin="https://evil.invalid")})
denied("BAD_HOST_DENIED",{"headers":different(Host="evil.invalid")})
denied("MISSING_INTENT_DENIED",{"headers":different(**{"X-GPT02-Intent":""})})
denied("BAD_CONTENT_TYPE_DENIED",{"headers":different(**{"Content-Type":"text/plain"})})
denied("MISSING_EXPLICIT_BODY_DENIED",{"body":b'{}',"headers":different(**{"Content-Length":"2"})})
denied("ACTOR_IN_BODY_DENIED",{"body":b'{"actor":"fake"}',"headers":different(**{"Content-Length":"16"})})
denied("BAD_CONTENT_LENGTH_DENIED",{"headers":different(**{"Content-Length":"33"})})
denied("MISSING_BEARER_DENIED",{"headers":different(Authorization="")})
denied("FORGED_JWT_DENIED",{"headers":different(Authorization="Bearer forged")})
old=actor["role"];actor["role"]="admin"
denied("NON_SUPERADMIN_DENIED")
actor["role"]=old
old=actor["authSource"];actor["authSource"]="email_only"
denied("NON_GOOGLE_IDENTITY_DENIED")
actor["authSource"]=old
old=consent["recorded"];consent["recorded"]=False
denied("MISSING_REVIEW_CONSENT_DENIED")
consent["recorded"]=old
old=consent["state"];consent["state"]="REVIEW_ONLY"
denied("NONFINAL_REVIEW_DENIED")
consent["state"]=old
old=packet["evidenceSha256"];packet["evidenceSha256"]=None
denied("INCOMPLETE_EVIDENCE_DENIED")
packet["evidenceSha256"]=old
old=packet["dispatchPermitted"];packet["dispatchPermitted"]=True
denied("ELEVATED_REVIEW_DENIED")
packet["dispatchPermitted"]=old
old=packet["evidence"]["originalAttemptId"]
packet["evidence"]["originalAttemptId"]="8f5ab85a-8300-4118-a14c-5fc701ae5a7c"
denied("PREVIOUS_TASK_ATTEMPT_DENIED")
packet["evidence"]["originalAttemptId"]=old
denied("CALLER_SUCCESSOR_DENIED",{"headers":different(**{"X-GPT02-Successor":"a"*36})})
before=calls["write"]
res=a.authorize_request(**base)
check("EXPLICIT_VERIFIED_SUPERADMIN_POST_REACHES_WRITER",calls["write"]==before+1)
check("RESULT_NEVER_ISSUER_DISPATCH",res["issuerAuthorized"] is False and res["dispatchPermitted"] is False)
check("RESULT_RELEASE_NO_GO",res["releaseDecision"]=="NO_GO")
print("RESULT="+str(n)+"/"+str(n)+" PASS")
print("REAL_OWNER_DECISION_WRITTEN=FALSE")
