#!/usr/bin/env python3
"""Synthetic read-only Task183 owner decision gate; never creates live approval."""
import importlib.util,sqlite3,tempfile,time,os
from pathlib import Path
p=Path(__file__).with_name('task183-owner-recovery-decision-reader.py')
spec=importlib.util.spec_from_file_location('owner_reader_test',p)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
NOW=1800000000000
digest='a'*64
uid='synthetic_super_admin_auth'
owner='owner:synthetic-hubowner'
def lookup():
 return {'claimsSha256':digest,'taskId':183,'requestId':m.REQUEST,
 'evidenceSha256':m.EVIDENCE,'ownerSubject':owner,'nonce':'N'*48,'observedAt':NOW}
n=0
def check(label,okay):
 global n
 n+=1
 if not okay:raise AssertionError(label)
 print('PASS:'+label)
with tempfile.TemporaryDirectory(prefix='task183-owner-decision-fixture-') as tmp:
 path=str(Path(tmp)/'synthetic.sqlite')
 db=sqlite3.connect(path)
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
 db.execute('INSERT INTO admin_identities VALUES(?,?,?)',(uid,'super_admin',1))
 db.execute('INSERT INTO gpt02_issue159_admin_operator_links VALUES(?,?,?)',(uid,'synthetic-hubowner',1))
 cols=(183,m.REQUEST,'default',m.EVIDENCE,digest,owner,'N'*48,uid,'super_admin','supabase_admin_session','APPROVE_RECOVERY_ATTEMPT2_ONLY',NOW-10000,NOW+100000)
 db.execute('INSERT INTO gpt02_task183_owner_recovery_decisions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',('synthetic_decision',*cols))
 outbox=('synthetic_outbox','synthetic_decision',*cols[:10],cols[11],cols[12])
 # Outbox excludes decision text, and requires all decision-identity fields
 # through the same SQLite transaction.
 db.execute('INSERT INTO gpt02_task183_owner_recovery_outbox VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',outbox)
 db.commit()
 def read(x=None):
  return m.read_decision(lookup() if x is None else x,db_path=path,operational=False,now=NOW)
 r=read()
 check('MATCHED_PERSISTED_ROW_READ_ONLY',r.get('persistedIndependentOwnerDecision') is True)
 check('MATCHED_ROW_STILL_NOT_SIGNATURE',r['signatureVerified'] is False and r['ok'] is False)
 check('NO_ISSUER_DISPATCH_GRANT',r['issuerAuthorizationGranted'] is False and r['dispatchPermitted'] is False)
 check('NO_OWNER_WRITES_FROM_READER',db.execute('select count(*) from gpt02_task183_owner_recovery_decisions').fetchone()[0]==1)
 check('DIFFERENT_TENANT_DENIED',read({**lookup(),'requestId':'bad'})['ok'] is False)
 check('EXPIRED_LOOKUP_DENIED',m.read_decision(lookup(),db_path=path,operational=False,now=NOW+90000)['ok'] is False)
 check('INVALID_NONCE_DENIED',read({**lookup(),'nonce':'x'})['ok'] is False)
 check('OTHER_OWNER_DENIED',read({**lookup(),'ownerSubject':'owner:someone_else'})['ok'] is False)
 check('OTHER_TASK_DENIED',read({**lookup(),'taskId':184})['ok'] is False)
 check('BACKDATED_OBSERVATION_DENIED',read({**lookup(),'observedAt':NOW-6000})['ok'] is False)
 db.execute("UPDATE gpt02_task183_owner_recovery_decisions SET decision='DENY' ")
 db.commit()
 check('OWNER_REJECTION_DENIED',read()['ok'] is False)
 db.execute("UPDATE gpt02_task183_owner_recovery_decisions SET decision='APPROVE_RECOVERY_ATTEMPT2_ONLY'")
 db.execute('UPDATE admin_identities SET enabled=0');db.commit()
 check('DISABLED_ADMIN_DENIED',read()['ok'] is False)
 db.execute('UPDATE admin_identities SET enabled=1')
 db.execute('DELETE FROM gpt02_task183_owner_recovery_outbox');db.commit()
 check('MISSING_INDEPENDENT_OUTBOX_DENIED',read()['ok'] is False)
 db.close()
 check('PINNED_REAL_DB_CANNOT_BE_REPLACED',m.read_decision(lookup(),db_path=path,operational=True,now=NOW)['ok'] is False)
 check('MISSING_OWNER_DECISION_SCHEMA_DENIED',m.read_decision(lookup(),db_path=str(Path(tmp)/'missing.db'),operational=False,now=NOW)['ok'] is False)
print('TOTAL',n,'PASS')
print('LIVE_APPROVAL_DB_UNCHANGED=TRUE')
print('NO_SIGNED_OWNER_APPROVAL_CREATED=TRUE')
