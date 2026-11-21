#!/usr/bin/env python3
"""Loopback HTTP tests with mocked intake and synthetic JWT; no live writes."""
import importlib.util,json,base64,hashlib,hmac,http.server,threading,urllib.request,urllib.error,time
from unittest import mock
from pathlib import Path

def load(path,alias):
 s=importlib.util.spec_from_file_location(alias,path)
 m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
 return m
broker=load('/opt/ai-coding-standalone-dev/qa/task183-single-click-broker-dev.py','gpt02_broker_test')
now=int(time.time())
claims={"id":"google_synthetic_test","role":"super_admin","email":"fake@example.test","companyId":None,
 "authSource":"supabase_google_identity","authSupabaseId":"12345678-aaaa-4bbb-8ccc-abcdef012345",
 "authVerifiedAt":now*1000,"iat":now-5,"exp":now+300}
def b64(data):
 if isinstance(data,dict):data=json.dumps(data,separators=(',',':')).encode()
 return base64.urlsafe_b64encode(data).decode().rstrip('=')
data=b64({"alg":"HS256","typ":"JWT"})+'.'+b64(claims)
token=data+'.'+b64(hmac.new(broker.SECRET,data.encode(),hashlib.sha256).digest())
def assert_status(label,got,want):
 print(label,got,'PASS' if got==want else 'FAIL')
 if got!=want:raise AssertionError(label)
counter=[]
class IntakeMock:
 def source_readback(self):
  return {"task":"synthetic-mock"}
 def record_pending_request(self,*,actor,source):
  assert actor["role"]=="super_admin"
  assert source=={"task":"synthetic-mock"}
  counter.append(actor["id"])
  return {"requestId":"mock_review_123","status":"PENDING_INDEPENDENT_OWNER_REVIEW","created":len(counter)==1,"approvalGranted":False,"dispatchPermitted":False,"attemptIssued":False}
 def get_status(self,actor):
  return {"requested":bool(counter),"status":"PENDING_INDEPENDENT_OWNER_REVIEW" if counter else "NOT_REQUESTED","approvalGranted":False,"dispatchPermitted":False}
 def review_evidence_packet(self,actor):
  return {"evidence":{"taskId":183,"requestId":"mock_review_123"},
    "evidenceSha256":"f"*64,"readOnly":True,
    "ownerApprovalGranted":False,"signedApprovalReceived":False,
    "nonceConsumed":False,"dispatchPermitted":False,"attemptIssued":False}
 def attest_review_evidence(self,*,actor,evidence_sha256):
  assert actor["role"]=="super_admin" and evidence_sha256=="f"*64
  return {"recorded":True,"created":True,"status":"REVIEWED_ONLY_NO_AUTHORIZATION",
    "ownerApprovalGranted":False,"nonceConsumed":False,
    "issuerGrant":False,"attemptIssued":False,"dispatchPermitted":False}
 def get_review_acknowledgement(self,actor):
  return {"recorded":False,"status":"NOT_REVIEWED",
    "ownerApprovalGranted":False,"dispatchPermitted":False}

server=http.server.HTTPServer(('127.0.0.1',0),broker.Handler)
thread=threading.Thread(target=server.serve_forever,daemon=True)
thread.start()
base='http://127.0.0.1:'+str(server.server_address[1])
body=b'{"requestReview":true}'
headers={'Host':'dev-ai-task.cstlogistic.co.id','Origin':broker.ORIGIN,'X-GPT02-Intent':'recovery-review-only','Content-Type':'application/json','Authorization':'Bearer '+token}
def call(method,path,headers=None,body=None):
 req=urllib.request.Request(base+path,method=method,headers=headers or {},data=body)
 try:
  with urllib.request.urlopen(req,timeout=4) as r:return r.status,json.load(r)
 except urllib.error.HTTPError as e:return e.code,json.load(e)
try:
 with mock.patch.object(broker,'load_review_intake',return_value=IntakeMock()):
  path=broker.REVIEW_REQUEST_PATH
  status=broker.REVIEW_STATUS_PATH
  assert_status('NO_AUTH_REVIEW',call('POST',path,{k:v for k,v in headers.items() if k!='Authorization'},body)[0],401)
  assert_status('NO_ORIGIN_REVIEW',call('POST',path,{k:v for k,v in headers.items() if k!='Origin'},body)[0],403)
  assert_status('INVALID_INTENT_REVIEW',call('POST',path,{**headers,'X-GPT02-Intent':'prepare-only'},body)[0],400)
  assert_status('WRONG_BODY_REVIEW',call('POST',path,headers,b'{"requestReview":false}')[0],400)
  assert_status('FAKE_JWT_REVIEW',call('POST',path,{**headers,'Authorization':'Bearer AAA.BBB.CCC'},body)[0],409)
  assert_status('OTHER_TASK_REVIEW',call('POST','/api/ai-tasks/184/gpt02-recovery-review-request?companyId=default',headers,body)[0],404)
  code,result=call('POST',path,headers,body)
  assert_status('SIGNED_REVIEW_REQUEST',code,201)
  assert result["approvalGranted"] is False and result["dispatchPermitted"] is False
  code,result=call('POST',path,headers,body)
  assert_status('IDEMPOTENT_REVIEW_RETRY',code,200)
  assert result["created"] is False and len(counter)==2
  code,result=call('GET',status,headers)
  assert_status('GET_SIGNED_REVIEW_STATUS',code,200)
  assert result["requested"] is True and result["readOnly"] is True
  assert_status('GET_REVIEW_STATUS_NO_AUTH',call('GET',status)[0],401)
  assert_status('GET_WRONG_TASK_REVIEW',call('GET','/api/ai-tasks/184/gpt02-recovery-review-status?companyId=default',headers)[0],404)
  evidence_path=broker.REVIEW_PACKET_PATH
  assert_status('PACKET_NO_AUTH_DENIED',call('GET',evidence_path)[0],401)
  assert_status('PACKET_FORGED_JWT_DENIED',call('GET',evidence_path,{"Authorization":"Bearer AAA.BBB.CCC"})[0],403)
  code,pkt=call('GET',evidence_path,headers)
  assert_status('PACKET_SIGNED_READ_ONLY',code,200)
  assert pkt["ownerApprovalGranted"] is False and pkt["dispatchPermitted"] is False and pkt["evidence"]["taskId"]==183
  ack_status=broker.REVIEW_ACK_STATUS_PATH
  ack_path=broker.REVIEW_ACK_PATH
  assert_status('ACK_STATUS_NO_AUTH_DENIED',call('GET',ack_status)[0],401)
  assert_status('ACK_STATUS_FORGED_JWT_DENIED',call('GET',ack_status,{'Authorization':'Bearer AAA.BBB.CCC'})[0],403)
  assert_status('ACK_STATUS_SIGNED_READ',call('GET',ack_status,headers)[0],200)
  ack_body=json.dumps({'evidenceSha256':'f'*64,'reviewedOnly':True},separators=(',',':')).encode()
  ack_headers={**headers,'X-GPT02-Intent':'acknowledge-review-only'}
  assert_status('ACK_POST_NOAUTH_DENIED',call('POST',ack_path,{k:v for k,v in ack_headers.items() if k!='Authorization'},ack_body)[0],401)
  assert_status('ACK_POST_WRONG_ORIGIN_DENIED',call('POST',ack_path,{**ack_headers,'Origin':'https://evil.example'},ack_body)[0],403)
  assert_status('ACK_POST_WRONG_INTENT_DENIED',call('POST',ack_path,{**ack_headers,'X-GPT02-Intent':'prepare-only'},ack_body)[0],400)
  assert_status('ACK_POST_WRONG_BODY_DENIED',call('POST',ack_path,ack_headers,b'{}')[0],400)
  assert_status('ACK_POST_FORGED_JWT_DENIED',call('POST',ack_path,{**ack_headers,'Authorization':'Bearer AAA.BBB.CCC'},ack_body)[0],409)
  ack_code,ack_data=call('POST',ack_path,ack_headers,ack_body)
  assert_status('ACK_POST_AUTHENTICATED_REVIEW_ONLY',ack_code,201)
  assert ack_data['ownerApprovalGranted'] is False and ack_data['dispatchPermitted'] is False


 print('BROKER_RECOVERY_REVIEW_HTTP=PASS')
 print('PRODUCTION_AND_CST_DEV_DATABASE_WRITES=FALSE')
finally:
 server.shutdown();server.server_close();thread.join(timeout=3)
