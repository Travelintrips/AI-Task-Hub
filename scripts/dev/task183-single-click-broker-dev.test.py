#!/usr/bin/env python3
"""Isolated tests. Positive preparation is mocked; zero database/task writes."""
import base64
import hashlib
import hmac
import http.server
import importlib.util
import json
import threading
import time
import urllib.request
import urllib.error
from pathlib import Path
from unittest import mock

p=Path("/opt/ai-coding-standalone-dev/qa/task183-single-click-broker-dev.py")
spec=importlib.util.spec_from_file_location("broker_dev_module",p)
broker=importlib.util.module_from_spec(spec)
spec.loader.exec_module(broker)

def enc(v):
    if isinstance(v,dict):v=json.dumps(v,separators=(",",":")).encode()
    return base64.urlsafe_b64encode(v).decode().rstrip("=")

def jwt(claims):
    signed=enc({"alg":"HS256","typ":"JWT"})+"."+enc(claims)
    mac=hmac.new(broker.SECRET,signed.encode(),hashlib.sha256).digest()
    return signed+"."+enc(mac)

def assertion(label,yes):
    print(label,"PASS" if yes else "FAIL")
    if not yes:raise AssertionError(label)

now=int(time.time())
claims={"id":"google_fixture_superadmin","email":"superadmin@example.test","role":"super_admin","companyId":"default","authSource":"supabase_google_identity","authSupabaseId":"01234567-89ab-4cde-8fab-0123456789ab","authVerifiedAt":(now-3600)*1000,"iat":now-3600,"exp":now+600}
token=jwt(claims)
assertion("SIGNED_SUPERADMIN_GOOGLE_CLAIMS_ACCEPTED",broker.verify_jwt(token,now)["role"]=="super_admin")
for label,update in [
    ("NON_SUPERADMIN_DENIED",{"role":"staff"}),
    ("FOREIGN_COMPANY_DENIED",{"companyId":"other"}),
    ("MISSING_GOOGLE_EVIDENCE_DENIED",{"authSource":"email"}),
    ("EXPIRED_JWT_DENIED",{"exp":now-1}),
    ("FUTURE_IAT_DENIED",{"iat":now+600}),
    ("MISSING_IDENTITY_DENIED",{"authSupabaseId":None}),
]:
    bad={**claims,**update}
    try:
        broker.verify_jwt(jwt(bad),now)
    except ValueError:assertion(label,True)
    else:assertion(label,False)
fake=token[:-4]+"ABCD"
try:broker.verify_jwt(fake,now)
except ValueError:assertion("TAMPERED_SIGNATURE_DENIED",True)
else:assertion("TAMPERED_SIGNATURE_DENIED",False)

# Test genuine HTTP handler with a mocked prepare operation. Never call root
# custody, unlock a role, or write a real task from this test.
server=http.server.HTTPServer(("127.0.0.1",0),broker.Handler)
port=server.server_address[1]
thread=threading.Thread(target=server.serve_forever,daemon=True)
thread.start()
actual_calls=[]
def fake_prepare(t):
    actual_calls.append(t)
    return {"taskId":183,"preparedOnly":True,"corePreparations":1,"hubJobs":1,"operatorApprovalGranted":False,"dispatchPermitted":False}
headers={"Host":"dev-ai-task.cstlogistic.co.id","Origin":broker.ORIGIN,"Content-Type":"application/json","X-GPT02-Intent":"prepare-only","Authorization":"Bearer "+token}
req=urllib.request.Request(f"http://127.0.0.1:{port}"+broker.TASK_PATH,data=b'{"prepareOnly":true}',headers=headers,method="POST")
try:
    with mock.patch.object(broker,"prepare_bounded",side_effect=fake_prepare):
        with urllib.request.urlopen(req,timeout=6) as r:
            payload=json.load(r)
            assertion("ONE_CLICK_HTTP_200",r.status==200)
            assertion("ONE_CLICK_DISPATCH_DISABLED",payload["dispatchPermitted"] is False)
    assertion("ONE_CLICK_PRESERVES_SIGNED_JWT",len(actual_calls)==1 and actual_calls[0]==token)
    with mock.patch.object(broker,"prepare_bounded",side_effect=RuntimeError("TEST_FAIL_CLOSED")):
        try:
            urllib.request.urlopen(req,timeout=6)
        except urllib.error.HTTPError as e:
            assertion("FAILED_PREPARATION_HTTP_409",e.code==409)
        else:assertion("FAILED_PREPARATION_HTTP_409",False)
finally:
    server.shutdown();server.server_close();thread.join(timeout=3)
print("NO_REAL_DB_OR_ROLE_MUTATIONS=TRUE")
