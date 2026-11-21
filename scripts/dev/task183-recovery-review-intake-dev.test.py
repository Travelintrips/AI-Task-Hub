#!/usr/bin/env python3
"""Pure synthetic SQLite fixture, no CST-DEV or production DB mutations."""
import importlib.util,json,sqlite3,tempfile,time
from pathlib import Path
from copy import deepcopy
p=Path(__file__).with_name('task183-recovery-review-intake-dev.py')
spec=importlib.util.spec_from_file_location('task183_review_intake_fixture',p)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
NOW=1800000000000
actor={"id":"google_synthetic_admin_A","role":"super_admin","companyId":None}
row={"company_id":"default","hub_task_id":183,"core_task_id":"11111111-1111-4111-8111-111111111111",
"hub_execution_id":"22222222-2222-4222-8222-222222222222",
"attempt_id":"33333333-3333-4333-8333-333333333333",
"command_candidate_id":"44444444-4444-4444-8444-444444444444",
"expires_at_ms":NOW-100000,"expired":True,
"prep_count":1,"job_count":1,"matching_job":1,"matching_core":1,
"command_count":0,"binding_count":0,"preparer_sessions":0,"preparer_locked":True}
def passed(name,condition):
 print(name, 'PASS' if condition else 'FAIL')
 if not condition:raise AssertionError(name)
def denied(name,row_arg=None,actor_arg=None):
 try:
  m.record_pending_request(actor=actor if actor_arg is None else actor_arg,
   source=row if row_arg is None else row_arg,store_path=store,now_ms=NOW)
 except ValueError:passed(name,True)
 else:passed(name,False)

with tempfile.TemporaryDirectory(prefix='task183-review-fixture-') as folder:
 store=Path(folder)/'recovery-review.sqlite3'
 first=m.record_pending_request(actor=actor,source=row,store_path=store,now_ms=NOW)
 passed('FIRST_REAL_REVIEW_REQUEST_ONLY',first["created"] and first["status"]==m.REVIEW_STATUS)
 passed('NO_OWNER_APPROVAL_NO_DISPATCH',first["approvalGranted"] is False and first["dispatchPermitted"] is False and first["attemptIssued"] is False)
 same=m.record_pending_request(actor=actor,source=row,store_path=store,now_ms=NOW)
 passed('REPLAY_IDEMPOTENT',not same["created"] and same["requestId"]==first["requestId"])
 r=m.get_status(actor,store)
 passed('GET_STATUS_ONLY',r["requested"] and r["status"]==m.REVIEW_STATUS)
 packet=m.review_evidence_packet(actor,store_path=store,actual_source=row,now_ms=NOW)
 passed('READ_ONLY_MATCHED_EVIDENCE_PACKET',
        packet["evidence"]["requestId"]==first["requestId"] and
        len(packet["evidenceSha256"])==64 and
        packet["readOnly"] and not packet["ownerApprovalGranted"] and
        not packet["dispatchPermitted"] and not packet["signedApprovalReceived"])
 packet_again=m.review_evidence_packet(actor,store_path=store,actual_source=row,now_ms=NOW)
 passed('REPEATED_EVIDENCE_DIGEST_STABLE',
        packet["evidenceSha256"]==packet_again["evidenceSha256"])
 for label,changed in [
    ('PACKET_TAMPERED_ATTEMPT_DENIED',{"attempt_id":"55555555-5555-4555-8555-555555555555"}),
    ('PACKET_WRONG_HUB_DENIED',{"hub_execution_id":"66666666-6666-4666-8666-666666666666"}),
    ('PACKET_NEW_COMMAND_DENIED',{"command_count":1}),
    ('PACKET_SOURCE_PREPARER_UNLOCKED_DENIED',{"preparer_locked":False})]:
    try:m.review_evidence_packet(actor,store_path=store,actual_source={**row,**changed},now_ms=NOW)
    except ValueError:passed(label,True)
    else:passed(label,False)
 try:m.review_evidence_packet({**actor,"id":"google_someone_else"},store_path=store,actual_source=row,now_ms=NOW)
 except ValueError:passed('PACKET_FOREIGN_ACTOR_DENIED',True)
 else:passed('PACKET_FOREIGN_ACTOR_DENIED',False)

 denied('FOREIGN_REQUESTER_DENIED',actor_arg={**actor,"id":"google_synthetic_admin_B"})
 for tag,key,value in [
  ('OTHER_TASK_DENIED','hub_task_id',184),('FOREIGN_COMPANY_DENIED','company_id','other'),
  ('ACTIVE_RESERVATION_DENIED','expired',False),('MISSING_CORE_DENIED','matching_core',0),
  ('MISSING_HUB_DENIED','matching_job',0),('SECOND_PREPARATION_DENIED','prep_count',2),
  ('SECOND_HUB_JOB_DENIED','job_count',2),('OFFICIAL_COMMAND_EXISTS_DENIED','command_count',1),
  ('BINDING_EXISTS_DENIED','binding_count',1),('PREPARER_UNLOCKED_DENIED','preparer_locked',False),
  ('PREPARER_SESSION_LEAK_DENIED','preparer_sessions',1)]:
  denied(tag,row_arg={**row,key:value})
 denied('NON_SUPERADMIN_DENIED',actor_arg={**actor,"role":"staff"})
 denied('SPOOFED_USER_DENIED',actor_arg={**actor,"id":"untrusted"})
 db=sqlite3.connect(store)
 try:
  for statement,name in [
   ("UPDATE reviews SET status='APPROVED'","IMMUTABLE_UPDATE_DENIED"),
   ("DELETE FROM reviews","IMMUTABLE_DELETE_DENIED"),
   ("UPDATE reviews SET dispatch_permitted=1","DISPATCH_CANNOT_BE_GRANTED"),
   ("UPDATE reviews SET owner_approval_granted=1","APPROVAL_CANNOT_BE_GRANTED")]:
   try:db.execute(statement);db.commit()
   except sqlite3.DatabaseError:passed(name,True);db.rollback()
   else:passed(name,False)
  count=db.execute("SELECT COUNT(*) FROM reviews").fetchone()[0]
  flags=db.execute("SELECT owner_approval_granted,issuer_grant,dispatch_permitted FROM reviews").fetchone()
  passed('ONE_APPEND_ONLY_REVIEW_RECORD',count==1 and flags==(0,0,0))
 finally:db.close()
 print('CST_DEV_AND_PROD_DATABASES_UNCHANGED=TRUE')
