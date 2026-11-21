#!/usr/bin/env python3
"""Full synthetic E2E for Task183 explicit decision/outbox writer.

No real approval or PROD writes. Only disposable SQLite with the exact
installed migration schema and existing read-only reader.
"""
import importlib.util,sqlite3,tempfile,time
from pathlib import Path
R=Path(__file__).parent
def module(name,file):
 s=importlib.util.spec_from_file_location(name,R/file)
 m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
writer=module('writer','task183-owner-approval-writer-dev.py')
migration=module('migration','task183-install-dormant-owner-approval-schema.py')
reader=module('reader','task183-owner-recovery-decision-reader.py')
NOW=1800000000000
actor={'id':'google_synthetic_owner','role':'super_admin','companyId':None,
 'authSupabaseId':'11111111-1111-4111-8111-111111111111',
 'email':'synthetic@example.invalid',
 'authSource':'supabase_google_identity','authVerifiedAt':NOW-10000}
evidence={'requestId':writer.REQUEST,'evidenceSha256':writer.SHA,
 'originalCoreTaskId':'faf682ad-d8e8-4888-95bc-e2e32ea13e92',
 'originalHubExecutionId':'96459064-0231-4d38-889b-419d7df52764',
 'originalAttemptId':'8f5ab85a-8300-4118-a14c-5fc701ae5a7c'}
N=0
def passed(name,condition):
 global N
 N+=1
 if not condition:raise AssertionError('FAIL:'+name)
 print('PASS:'+name)
def denied(name,fn):
 try:fn()
 except (ValueError,sqlite3.Error):passed(name,True)
 else:passed(name,False)
with tempfile.TemporaryDirectory(prefix='task183-real-writer-qa-') as tmp:
 p=Path(tmp)/'isolated.sqlite'
 c=sqlite3.connect(str(p))
 c.executescript('''
 CREATE TABLE admin_identities(user_id text,role text,enabled integer);
 CREATE TABLE gpt02_issue159_admin_operator_links(
   auth_user_id text,hub_operator_id text,email text,enabled integer);
 CREATE TABLE gpt02_issue159_approval_intents(id text PRIMARY KEY,task_id integer,marker text);
 INSERT INTO gpt02_issue159_approval_intents VALUES('old159',159,'PRESERVE');
 ''')
 c.execute('INSERT INTO admin_identities VALUES(?,?,?)',
   (actor['authSupabaseId'],'super_admin',1))
 c.execute('INSERT INTO gpt02_issue159_admin_operator_links VALUES(?,?,?,?)',
   (actor['authSupabaseId'],actor['id'],actor['email'],1))
 c.commit();c.close()
 passed('EXACT_DORMANT_MIGRATION_INSTALLED',
  migration.install(p)=='DORMANT_SCHEMA_INSTALLED_NO_APPROVAL')
 def write(a=actor,e=evidence,explicit=False,other=p):
  return writer.record(actor=a,evidence=e,explicit_action=explicit,
     db_path=other,operational=False,now_ms=NOW,nonce='A'*48)
 denied('IMPLICIT_REVIEW_NOT_OWNER_APPROVAL',lambda:write())
 denied('WRONG_ROLE_DENIED',lambda:write({**actor,'role':'staff'},explicit=True))
 denied('WRONG_COMPANY_DENIED',lambda:write({**actor,'companyId':'other'},explicit=True))
 denied('WRONG_HUB_OWNER_DENIED',lambda:write({**actor,'id':'google_someone_else'},explicit=True))
 denied('WRONG_SUPABASE_AUTH_DENIED',lambda:write({**actor,'authSupabaseId':'33333333-3333-4333-8333-333333333333'},explicit=True))
 denied('WRONG_EMAIL_DENIED',lambda:write({**actor,'email':'another@example.invalid'},explicit=True))
 denied('UNVERIFIED_GOOGLE_DENIED',lambda:write({**actor,'authSource':'manual'},explicit=True))
 denied('EXPIRED_AUTH_SESSION_DENIED',lambda:write({**actor,'authVerifiedAt':NOW-10*86400000},explicit=True))
 denied('ALTERED_EVIDENCE_DENIED',lambda:write(e={**evidence,'evidenceSha256':'b'*64},explicit=True))
 denied('FOREIGN_DB_DENIED',lambda:write(explicit=True,other=p.parent/'notthere.sqlite'))
 denied('UNPINNED_DB_DENIED',lambda:writer.record(actor=actor,evidence=evidence,
   explicit_action=True,db_path=p,operational=True,now_ms=NOW,nonce='A'*48))
 c=sqlite3.connect(p)
 passed('ALL_DENIALS_ROLLBACK',
    c.execute('select count(*) from gpt02_task183_owner_recovery_decisions').fetchone()[0]==0
    and c.execute('select count(*) from gpt02_task183_owner_recovery_outbox').fetchone()[0]==0)
 c.close()
 result=write(explicit=True)
 passed('SYNTHETIC_EXPLICIT_OWNER_DECISION_INSERTED',result['recorded'])
 passed('NO_SIGNER_ISSUER_OR_DISPATCH_PERMISSION',
    all(result[x] is False for x in
        ('cryptographicOwnerSignatureCreated','issuerAuthorized','attemptIssued','dispatchPermitted')))
 c=sqlite3.connect(p)
 passed('DECISION_OUTBOX_ATOMIC_ONE_TO_ONE',
   c.execute('select count(*) from gpt02_task183_owner_recovery_decisions').fetchone()[0]==1
   and c.execute('select count(*) from gpt02_task183_owner_recovery_outbox').fetchone()[0]==1)
 passed('OLD_ISSUE159_ROWS_PRESERVED',
   c.execute('select * from gpt02_issue159_approval_intents').fetchone()==('old159',159,'PRESERVE'))
 c.close()
 claims=result['claims']
 lookup={'claimsSha256':result['claimsSha256'],'taskId':183,
  'requestId':claims['requestId'],'evidenceSha256':claims['evidenceSha256'],
  'ownerSubject':claims['ownerSubject'],'nonce':claims['nonce'],'observedAt':NOW}
 r=reader.read_decision(lookup,db_path=str(p),operational=False,now=NOW)
 passed('INDEPENDENT_READER_MATCHES_SAME_DECISION',
  r['ok'] is True and r['persistedIndependentOwnerDecision'] is True)
 passed('READ_ONLY_PROVENANCE_NOT_SIGNATURE',
  r['signatureVerified'] is False and r['issuerAuthorizationGranted'] is False
  and r['dispatchPermitted'] is False)
 denied('REPLAY_DENIED',lambda:write(explicit=True))
 c=sqlite3.connect(p)
 passed('REPLAY_DID_NOT_DUPLICATE',c.execute('select count(*) from gpt02_task183_owner_recovery_outbox').fetchone()[0]==1)
 for table in ('gpt02_task183_owner_recovery_decisions','gpt02_task183_owner_recovery_outbox'):
  for action in ('UPDATE','DELETE'):
   sql=('UPDATE '+table+' SET nonce=?' if action=='UPDATE'
        else 'DELETE FROM '+table)
   try:c.execute(sql,('B'*48,) if action=='UPDATE' else ());c.commit()
   except sqlite3.DatabaseError:c.rollback();passed(action+'_'+table+'_IMMUTABLE',True)
   else:passed(action+'_'+table+'_IMMUTABLE',False)
 c.close()
print('RESULT',N,'PASS')
print('LIVE_TASK183_APPROVAL_DECISIONS_CREATED=FALSE')
print('LIVE_CST_DEV_AND_PROD_UNCHANGED=TRUE')
