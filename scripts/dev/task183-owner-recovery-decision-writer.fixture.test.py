#!/usr/bin/env python3
"""Atomic synthetic Owner decision/outbox writer + separate read-only gate."""
import importlib.util,sqlite3,tempfile,copy
from pathlib import Path
ROOT=Path(__file__).parent
def load(path,name):
 spec=importlib.util.spec_from_file_location(name,ROOT/path)
 m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
w=load('task183-owner-recovery-decision-writer.fixture.py','writer')
r=load('task183-owner-recovery-decision-reader.py','reader')
NOW=1800000000000
actor={'id':'google_synthetic_owner','role':'super_admin',
 'authSource':'supabase_google_identity','authVerifiedAt':NOW-10000,
 'authSupabaseId':'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}
evidence={'requestId':r.REQUEST,'evidenceSha256':r.EVIDENCE,
 'originalCoreTaskId':'faf682ad-d8e8-4888-95bc-e2e32ea13e92',
 'originalHubExecutionId':'96459064-0231-4d38-889b-419d7df52764',
 'originalAttemptId':'8f5ab85a-8300-4118-a14c-5fc701ae5a7c'}
N=0
def check(label,condition):
 global N
 N+=1
 if not condition:raise AssertionError(label)
 print('PASS:'+label)
def denied(label,fn):
 try:fn()
 except (ValueError,sqlite3.Error):check(label,True)
 else:check(label,False)
with tempfile.TemporaryDirectory(prefix='task183-owner-writer-fixture-') as tmp:
 p=Path(tmp)/'task183-owner-approval-fixture.sqlite'
 c=sqlite3.connect(str(p))
 c.execute('CREATE TABLE admin_identities(user_id TEXT,role TEXT,enabled INTEGER)')
 c.execute('CREATE TABLE gpt02_issue159_admin_operator_links(auth_user_id TEXT,hub_operator_id TEXT,enabled INTEGER)')
 c.execute('INSERT INTO admin_identities VALUES(?,?,?)',(actor['authSupabaseId'],'super_admin',1))
 c.execute('INSERT INTO gpt02_issue159_admin_operator_links VALUES(?,?,?)',(actor['authSupabaseId'],actor['id'],1))
 w.create_fixture_tables(c)
 c.commit()
 def call(a=actor,e=evidence,approve=False):
  return w.record_fixture_decision(p,actor=a,evidence=e,now_ms=NOW,
    verified_explicit_approval=approve)
 denied('IMPLICIT_REVIEW_NOT_APPROVAL',lambda:call())
 denied('UNSIGNED_OTHER_ACTOR',lambda:call({**actor,'role':'staff'},approve=True))
 denied('UNVERIFIED_AUTH_SOURCE',lambda:call({**actor,'authSource':'email'},approve=True))
 denied('STALE_SIGNED_SESSION',lambda:call({**actor,'authVerifiedAt':NOW-10*86400000},approve=True))
 denied('WRONG_HUB_OPERATOR_LINK',lambda:call({**actor,'id':'google_unregistered'},approve=True))
 denied('WRONG_EVIDENCE_HASH',lambda:call(e={**evidence,'evidenceSha256':'NOT_HASH'},approve=True))
 denied('OTHER_DATA_FILE_PATH_DENIED',lambda:w.record_fixture_decision(
     Path(tmp)/'tasks.db',actor=actor,evidence=evidence,now_ms=NOW,
     verified_explicit_approval=True))
 result=call(approve=True)
 check('EXPLICIT_SYNTHETIC_OWNER_DECISION_ATOMICALLY_WRITTEN',result['persisted'] is True)
 check('STILL_NO_SIGNED_OWNER_APPROVAL',result['signedOwnerApproval'] is False and
       result['issuerAuthorized'] is False and result['dispatchPermitted'] is False)
 check('DECISION_AND_OUTBOX_ONE_TO_ONE',c.execute('SELECT COUNT(*) FROM gpt02_task183_owner_recovery_decisions').fetchone()[0]==1 and
   c.execute('SELECT COUNT(*) FROM gpt02_task183_owner_recovery_outbox').fetchone()[0]==1)
 claim=result['claims']
 lookup={'claimsSha256':result['claimsSha256'],'taskId':183,
    'requestId':claim['requestId'],'evidenceSha256':claim['evidenceSha256'],
    'ownerSubject':claim['ownerSubject'],'nonce':claim['nonce'],'observedAt':NOW}
 proof=r.read_decision(lookup,db_path=str(p),operational=False,now=NOW)
 check('READ_BACK_MATCHED_IMMUTABLE_OWNER_DECISION',proof['persistedIndependentOwnerDecision'] is True)
 check('PERSISTED_DECISION_CANNOT_FORGE_SIGNATURE',proof['ok'] is True and
       proof['signatureVerified'] is False and proof['issuerAuthorizationGranted'] is False)
 denied('DUPLICATE_OWNER_DECISION_DENIED',lambda:call(approve=True))
 check('REPLAY_NO_DUPLICATION',c.execute('select count(*) from gpt02_task183_owner_recovery_outbox').fetchone()[0]==1)
 for stmt,label in [
   ('UPDATE gpt02_task183_owner_recovery_decisions SET decision="APPROVE"','DECISION_IMMUTABLE'),
   ('DELETE FROM gpt02_task183_owner_recovery_outbox','OUTBOX_IMMUTABLE')]:
  try:c.execute(stmt);c.commit()
  except sqlite3.DatabaseError:c.rollback();check(label,True)
  else:check(label,False)
 check('WRONG_OWNER_LOOKUP_DENIED',r.read_decision({**lookup,'ownerSubject':'owner:other'},db_path=str(p),operational=False,now=NOW)['ok'] is False)
 check('WRONG_NONCE_DENIED',r.read_decision({**lookup,'nonce':'B'*48},db_path=str(p),operational=False,now=NOW)['ok'] is False)
 check('EXPIRED_DECISION_DENIED',r.read_decision({**lookup,'observedAt':NOW+130000},db_path=str(p),operational=False,now=NOW+130000)['ok'] is False)
 c.close()
print('RESULT',N,'PASS')
print('REAL_OWNER_APPROVAL_OR_SIGNATURE_CREATED=FALSE')
print('LIVE_CST_DEV_AND_PROD_DATABASES_UNCHANGED=TRUE')
