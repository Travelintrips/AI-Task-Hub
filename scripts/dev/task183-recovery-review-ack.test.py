#!/usr/bin/env python3
"""Synthetic signed actor & ephemeral filesystem only. Never touch real DB."""
import tempfile,importlib.util,sqlite3
from pathlib import Path
s=importlib.util.spec_from_file_location('ack','/opt/ai-coding-standalone-dev/qa/task183-recovery-review-intake-dev.py')
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
NOW=1800000000000
actor={'id':'google_synthetic_superadmin','role':'super_admin','companyId':None}
source={'company_id':'default','hub_task_id':183,
 'core_task_id':'11111111-1111-4111-8111-111111111111',
 'hub_execution_id':'22222222-2222-4222-8222-222222222222',
 'attempt_id':'33333333-3333-4333-8333-333333333333',
 'command_candidate_id':'44444444-4444-4444-8444-444444444444',
 'expires_at_ms':NOW-100000,'expired':True,
 'prep_count':1,'job_count':1,'matching_job':1,'matching_core':1,
 'command_count':0,'binding_count':0,'preparer_sessions':0,'preparer_locked':True}
count=0
def check(label,good):
 global count
 count+=1
 if not good:raise AssertionError('FAIL:'+label)
 print('PASS:'+label)
def reject(label,**kw):
 try:m.attest_review_evidence(actor=actor,evidence_sha256=digest,store_path=path,actual_source=source,now_ms=NOW,**kw)
 except (ValueError,TypeError):check(label,True)
 else:check(label,False)
with tempfile.TemporaryDirectory(prefix='task183-ack-isolated-') as tmp:
 path=Path(tmp)/'synthetic.sqlite'
 req=m.record_pending_request(actor=actor,source=source,store_path=path,now_ms=NOW)
 evidence=m.review_evidence_packet(actor,store_path=path,actual_source=source,now_ms=NOW)
 digest=evidence['evidenceSha256']
 check('NO_ACK_INITIAL',m.get_review_acknowledgement(actor,store_path=path)['recorded'] is False)
 one=m.attest_review_evidence(actor=actor,evidence_sha256=digest,store_path=path,actual_source=source,now_ms=NOW)
 check('ACK_REVIEW_ONLY_CREATED',one['created'] and one['status']=='REVIEWED_ONLY_NO_AUTHORIZATION')
 check('CANNOT_AUTHORIZE_ISSUER',one['ownerApprovalGranted'] is False and one['issuerGrant'] is False and one['nonceConsumed'] is False and one['dispatchPermitted'] is False and one['attemptIssued'] is False)
 two=m.attest_review_evidence(actor=actor,evidence_sha256=digest,store_path=path,actual_source=source,now_ms=NOW)
 check('ACK_REPLAY_IDEMPOTENT',two['created'] is False and two['requestId']==one['requestId'])
 check('GET_AUTHENTICATED_ACK',m.get_review_acknowledgement(actor,store_path=path)['recorded'] is True)
 def denied(label,actor2=None,digest2=None,source2=None):
  try:m.attest_review_evidence(actor=actor if actor2 is None else actor2,evidence_sha256=digest if digest2 is None else digest2,store_path=path,actual_source=source if source2 is None else source2,now_ms=NOW)
  except (ValueError,TypeError):check(label,True)
  else:check(label,False)
 denied('FORGED_EVIDENCE_HASH_DENIED',digest2='0'*64)
 denied('NON_ADMIN_DENIED',actor2={**actor,'role':'staff'})
 denied('FOREIGN_OPERATOR_DENIED',actor2={**actor,'id':'google_other_owner'})
 denied('WRONG_ATTEMPT_DENIED',source2={**source,'attempt_id':'55555555-5555-4555-8555-555555555555'})
 denied('CORE_MISMATCH_DENIED',source2={**source,'core_task_id':'55555555-5555-4555-8555-555555555555'})
 denied('ADDED_COMMAND_DENIED',source2={**source,'command_count':1})
 denied('NEW_BINDING_DENIED',source2={**source,'binding_count':1})
 denied('PREPARER_UNLOCKED_DENIED',source2={**source,'preparer_locked':False})
 db=sqlite3.connect(path)
 try:
  for statement,label in [
    ("UPDATE evidence_acknowledgements SET decision='APPROVE'","ACK_UPDATE_DENIED"),
    ("DELETE FROM evidence_acknowledgements","ACK_DELETE_DENIED"),
    ("UPDATE evidence_acknowledgements SET owner_approval_granted=1","FAKE_APPROVAL_DENIED"),
    ("UPDATE evidence_acknowledgements SET dispatch_permitted=1","FAKE_DISPATCH_DENIED")]:
   try:db.execute(statement);db.commit()
   except sqlite3.DatabaseError:db.rollback();check(label,True)
   else:check(label,False)
  check('EXACTLY_ONE_ACK',db.execute('select count(*) from evidence_acknowledgements').fetchone()[0]==1)
 finally:db.close()
print('RESULT',count,'PASS')
print('NO_REAL_DATABASE_OR_USER_APPROVAL_CREATED=TRUE')
