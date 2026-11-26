#!/usr/bin/env python3
"""Read-only regression against synthetic Owner decision/outbox; no live writes."""
import importlib.util,sqlite3,tempfile,time
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("adapter",HERE/"task183-independent-owner-adapter.candidate.py")
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
reader=a._reader()
NOW=1800000000000
claims={k:"x" for k in a.REQUIRED}
claims.update(version=1,environment="DEV",audience=a.DOMAIN,companyId="default",
 hubTaskId=183,recoveryAttemptNumber=2,requestId=reader.REQUEST,
 evidenceSha256=reader.EVIDENCE,ownerSubject="owner:synthetic-hubowner",
 nonce="N"*48,issuedAt=NOW-1000,expiresAt=NOW+60000,
 purpose="PREPARE_ATTEMPT2_ONLY",dispatchPermitted=False)
n=0
def check(label,yes):
 global n
 assert yes,label
 n+=1
 print("PASS:"+label)
def deny(label,params):
 try:a.authorize_recovery(**params)
 except a.AuthorizationDenied:check(label,True)
 else:check(label,False)
with tempfile.TemporaryDirectory(prefix="task183-owner-adapter-fixture-") as td:
 dbpath=Path(td)/"owner.sqlite"
 db=sqlite3.connect(dbpath)
 db.executescript("""
 CREATE TABLE admin_identities(user_id text primary key,role text,enabled integer);
 CREATE TABLE gpt02_issue159_admin_operator_links(auth_user_id text,hub_operator_id text,enabled integer);
 CREATE TABLE gpt02_task183_owner_recovery_decisions(
  id text primary key,task_id integer,request_id text,company_id text,
  evidence_sha256 text,claims_sha256 text,owner_subject text,nonce text,
  auth_user_id text,role_at_decision text,auth_method text,decision text,
  recorded_at_ms integer,expires_at_ms integer);
 CREATE TABLE gpt02_task183_owner_recovery_outbox(
  id text primary key,decision_id text,task_id integer,request_id text,
  company_id text,evidence_sha256 text,claims_sha256 text,owner_subject text,
  nonce text,auth_user_id text,role_at_decision text,auth_method text,
  recorded_at_ms integer,expires_at_ms integer);
 """)
 uid="synthetic_admin"
 db.execute("INSERT INTO admin_identities VALUES(?,?,?)",(uid,"super_admin",1))
 db.execute("INSERT INTO gpt02_issue159_admin_operator_links VALUES(?,?,?)",(uid,"synthetic-hubowner",1))
 base=dict(claims=claims,now_ms=NOW,db_path=dbpath,operational=False)
 deny("MISSING_OWNER_RECORD_NO_GO",base)
 import hashlib,json
 payload=json.dumps({k:claims[k] for k in a.REQUIRED},ensure_ascii=False,separators=(",",":")).encode()
 digest=hashlib.sha256((a.DOMAIN+"\n").encode()+payload).hexdigest()
 cols=(183,reader.REQUEST,"default",reader.EVIDENCE,digest,claims["ownerSubject"],claims["nonce"],uid,"super_admin","supabase_admin_session","APPROVE_RECOVERY_ATTEMPT2_ONLY",NOW-10000,NOW+50000)
 db.execute("INSERT INTO gpt02_task183_owner_recovery_decisions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",("decision-1",*cols))
 outbox=("outbox-1","decision-1",*cols[:10],cols[11],cols[12])
 db.execute("INSERT INTO gpt02_task183_owner_recovery_outbox VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",outbox)
 db.commit()
 r=a.authorize_recovery(**base)
 check("MATCHED_DECISION_AND_OUTBOX_PROVENANCE",r["decisionProvenanceVerified"] is True and r["approvalDigest"]==digest)
 check("NO_SIGNATURE_OR_ISSUER_GRANT",r["signatureVerified"] is False and r["issuerAuthorized"] is False and r["dispatchPermitted"] is False)
 for label,changed in [
  ("WRONG_OWNER",{"ownerSubject":"owner:someone-else"}),
  ("NONCE_MUTATION",{"nonce":"A"*48}),
  ("EVIDENCE_MUTATION",{"evidenceSha256":"a"*64}),
  ("REQUEST_MUTATION",{"requestId":"b"*36}),
  ("WRONG_TASK",{"hubTaskId":184}),
  ("WRONG_PURPOSE",{"purpose":"DISPATCH"}),
  ("DISPATCH_FLAG_DENIED",{"dispatchPermitted":True}),
  ("EXPIRED_CLAIMS",{"expiresAt":NOW-1}),
  ("FUTURE_ISSUED",{"issuedAt":NOW+10000})]:
  deny(label,{**base,"claims":{**claims,**changed}})
 db.execute("DELETE FROM gpt02_task183_owner_recovery_outbox");db.commit()
 deny("MISSING_OUTBOX_NO_GO",base)
 db.execute("INSERT INTO gpt02_task183_owner_recovery_outbox VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",outbox)
 db.execute("UPDATE admin_identities SET enabled=0");db.commit()
 deny("DISABLED_OWNER_NO_GO",base)
 db.close()
 deny("OPERATIONAL_DB_PIN_NOT_BYPASSABLE",{**base,"operational":True})
print(f"RESULT={n}/{n} PASS")
print("REAL_OWNER_DECISION_CREATED=FALSE")
print("PROD_CHANGED=FALSE")
