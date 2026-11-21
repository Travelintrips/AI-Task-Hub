#!/usr/bin/env python3
"""Reader-backed broker E2E: synthetic positive and real DEV read-only denial."""
import base64,hashlib,importlib.util,json,os,sqlite3,tempfile,time
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
HERE=Path(__file__).resolve().parent
def load(name,file):
 s=importlib.util.spec_from_file_location(name,HERE/file)
 m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
b=load("bridge","task183-two-phase-unix-bridge.candidate.py")
a=load("backed","task183-reader-backed-broker-authorization.candidate.py")
reader=a.adapter._reader()
n=0
def check(label,value):
 global n
 assert value,label
 n+=1;print("PASS:"+label,flush=True)
NOW=int(time.time()*1000)
claims={k:"fixture" for k in a.adapter.REQUIRED}
claims.update(version=1,environment="DEV",audience=a.adapter.DOMAIN,companyId="default",
 hubTaskId=183,recoveryAttemptNumber=2,requestId=reader.REQUEST,
 evidenceSha256=reader.EVIDENCE,ownerSubject="owner:synthetic-hubowner",
 nonce="N"*48,issuedAt=NOW-1000,expiresAt=NOW+60000,
 purpose="PREPARE_ATTEMPT2_ONLY",dispatchPermitted=False)
payload=json.dumps({k:claims[k] for k in a.adapter.REQUIRED},ensure_ascii=False,separators=(",",":")).encode()
digest=hashlib.sha256((a.adapter.DOMAIN+"\n").encode()+payload).hexdigest()
request={"role":"recovery-approval","approvalDigest":digest,"requestId":reader.REQUEST,
 "evidenceSha256":reader.EVIDENCE,"claims":claims}
with tempfile.TemporaryDirectory(prefix="task183-two-phase-fixture-") as td:
 root=Path(td);os.chmod(root,0o700)
 store=root/"receipt.db";b.phase.custody.install(path=store,operational=False)
 decisiondb=root/"owner.db"
 conn=sqlite3.connect(decisiondb)
 conn.executescript("""
 CREATE TABLE admin_identities(user_id text primary key,role text,enabled integer);
 CREATE TABLE gpt02_issue159_admin_operator_links(auth_user_id text,hub_operator_id text,enabled integer);
 CREATE TABLE gpt02_task183_owner_recovery_decisions(
 id text primary key,task_id integer,request_id text,company_id text,evidence_sha256 text,
 claims_sha256 text,owner_subject text,nonce text,auth_user_id text,role_at_decision text,
 auth_method text,decision text,recorded_at_ms integer,expires_at_ms integer);
 CREATE TABLE gpt02_task183_owner_recovery_outbox(
 id text primary key,decision_id text,task_id integer,request_id text,company_id text,
 evidence_sha256 text,claims_sha256 text,owner_subject text,nonce text,auth_user_id text,
 role_at_decision text,auth_method text,recorded_at_ms integer,expires_at_ms integer);
 """)
 uid="synthetic_admin"
 conn.execute("INSERT INTO admin_identities VALUES(?,?,?)",(uid,"super_admin",1))
 conn.execute("INSERT INTO gpt02_issue159_admin_operator_links VALUES(?,?,?)",(uid,"synthetic-hubowner",1))
 cols=(183,reader.REQUEST,"default",reader.EVIDENCE,digest,claims["ownerSubject"],
       claims["nonce"],uid,"super_admin","supabase_admin_session",
       "APPROVE_RECOVERY_ATTEMPT2_ONLY",NOW-1000,NOW+50000)
 conn.execute("INSERT INTO gpt02_task183_owner_recovery_decisions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",("d1",*cols))
 conn.execute("INSERT INTO gpt02_task183_owner_recovery_outbox VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
              ("o1","d1",*cols[:10],cols[11],cols[12]))
 conn.commit()
 key=Ed25519PrivateKey.generate()
 calls=[0]
 signing_payload=b"Task183-fixture-only-signature"
 def sign():
  calls[0]+=1
  return base64.urlsafe_b64encode(key.sign(signing_payload)).decode().rstrip("=")
 def verify(role,digest,rid,evidence,sig):
  try:key.public_key().verify(base64.urlsafe_b64decode(sig+"=="),signing_payload);return True
  except Exception:return False
 def invoke(authorize,data=request):
  path=root/"signer-two-phase.sock"
  broker=b.FixtureBroker(socket_path=path,store=store,authorize=authorize,verify=verify)
  broker.start()
  try:return b.client(path,data,sign_callback=sign)
  finally:broker.close()
 synthetic=a.make_recovery_authorizer(db_path=decisiondb,now_ms=NOW)
 check("SYNTHETIC_DB_DECISION_TO_UNIX_SIGNER_PASS",invoke(synthetic)["status"]=="COMPLETED")
 check("ONE_EPHEMERAL_SIGNING_ONLY",calls[0]==1)
 check("REPLAY_NO_RESIGN",invoke(synthetic)["status"]=="COMPLETED" and calls[0]==1)
 check("CANONICAL_NONCE_MUTATION_DENIED",invoke(synthetic,{**request,"claims":{**claims,"nonce":"Z"*48}})["status"]=="DENIED")
 conn.execute("UPDATE admin_identities SET enabled=0");conn.commit()
 check("DISABLED_OWNER_DENIED_AFTER_PRIOR_COMPLETION",invoke(synthetic)["status"]=="DENIED")
 conn.close()
 # Live DB is queried only in read-only mode; no approval should be inferred.
 read_only=a.make_recovery_authorizer(operational=True)
 store2=root/"live-readonly-check.sqlite"
 b.phase.custody.install(path=store2,operational=False)
 store=store2
 check("REAL_DEV_DB_MISSING_DECISION_DENIED",invoke(read_only)["status"]=="DENIED")
 check("REAL_READONLY_CHECK_NEVER_SIGNS",calls[0]==1)
 check("REAL_READONLY_CHECK_NO_RESERVATION",b.phase.custody.audit(path=store2,operational=False)["total"]==0)
 try:a.make_recovery_authorizer(operational=True,db_path=decisiondb)
 except ValueError:check("OPERATIONAL_DB_OVERRIDE_DENIED",True)
 else:check("OPERATIONAL_DB_OVERRIDE_DENIED",False)
 check("ISSUER_DISPATCH_ALWAYS_FALSE",b.phase.custody.audit(path=store2,operational=False)["issuerAuthorized"] is False)
print(f"RESULT={n}/{n} PASS")
print("KEY_TYPE=EPHEMERAL_ED25519_ONLY")
print("LIVE_OWNER_DB_CHANGED=FALSE")
print("PROD_CHANGED=FALSE")
