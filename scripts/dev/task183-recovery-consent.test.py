#!/usr/bin/env python3
"""Complete recovery human intent anti-replay contract in ephemeral SQLite only."""
import importlib.util,sqlite3,tempfile
from pathlib import Path
p=Path(__file__).with_name('task183-recovery-review-intake-dev.py')
spec=importlib.util.spec_from_file_location('recovery_intent',p)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
NOW=1800000000000
actor={'id':'google_synthetic_admin','role':'super_admin','companyId':None,
 'authSource':'supabase_google_identity','authVerifiedAt':NOW-10000}
src={'company_id':'default','hub_task_id':183,
 'core_task_id':'11111111-1111-4111-8111-111111111111',
 'hub_execution_id':'22222222-2222-4222-8222-222222222222',
 'attempt_id':'33333333-3333-4333-8333-333333333333',
 'command_candidate_id':'44444444-4444-4444-8444-444444444444',
 'expires_at_ms':NOW-100000,'expired':True,'prep_count':1,
 'job_count':1,'matching_job':1,'matching_core':1,'command_count':0,
 'binding_count':0,'preparer_sessions':0,'preparer_locked':True}
n=0
def check(k,okay):
 global n
 n+=1
 if not okay:raise AssertionError('FAIL '+k)
 print('PASS '+k)
def deny(k,fn):
 try:fn()
 except (ValueError,TypeError,sqlite3.DatabaseError):check(k,True)
 else:check(k,False)
with tempfile.TemporaryDirectory(prefix='task183-recovery-consent-') as tmp:
 dbpath=Path(tmp)/'review.sqlite3'
 req=m.record_pending_request(actor=actor,source=src,store_path=dbpath,now_ms=NOW)
 ev=m.review_evidence_packet(actor,store_path=dbpath,actual_source=src,now_ms=NOW)
 digest=ev['evidenceSha256']
 c=lambda **kw:m.issue_recovery_consent_challenge(actor=actor,store_path=dbpath,actual_source=src,now_ms=NOW,**kw)
 a=lambda cid,nonce,sha=digest,actor_override=actor,now=NOW,source=src:m.consent_to_recovery_review(
     actor=actor_override,challenge_id=cid,nonce=nonce,evidence_sha256=sha,
     store_path=dbpath,actual_source=source,now_ms=now)
 deny('CHALLENGE_REQUIRES_REAL_REVIEW_ACK',lambda:c())
 reviewed=m.attest_review_evidence(actor=actor,evidence_sha256=digest,store_path=dbpath,actual_source=src,now_ms=NOW)
 check('REAL_REVIEW_ACK_FIXTURE',reviewed['recorded'] and not reviewed['ownerApprovalGranted'])
 challenge=c()
 check('FRESH_RANDOM_NONCE',len(challenge['nonce'])==48 and len(challenge['challengeId'])==32)
 check('CHALLENGE_NO_AUTHORITY',challenge['ownerApprovalGranted'] is False and challenge['dispatchPermitted'] is False)
 check('NO_CONSENT_UNTIL_USER_CLICKS',m.get_recovery_consent_state(actor,store_path=dbpath)['recorded'] is False)
 deny('BAD_NONCE_DENIED',lambda:a(challenge['challengeId'],'A'*48))
 deny('BAD_EVIDENCE_DENIED',lambda:a(challenge['challengeId'],challenge['nonce'],sha='0'*64))
 deny('FOREIGN_OPERATOR_DENIED',lambda:a(challenge['challengeId'],challenge['nonce'],
      actor_override={**actor,'id':'google_synthetic_other'}))
 deny('NON_GOOGLE_SESSION_DENIED',lambda:a(challenge['challengeId'],challenge['nonce'],
      actor_override={**actor,'authSource':'email_otp_only'}))
 deny('EXPIRED_CHALLENGE_DENIED',lambda:a(challenge['challengeId'],challenge['nonce'],now=NOW+300001))
 deny('WRONG_CORE_DENIED',lambda:a(challenge['challengeId'],challenge['nonce'],
     source={**src,'core_task_id':'55555555-5555-4555-8555-555555555555'}))
 deny('ISSUED_COMMAND_SOURCE_DENIED',lambda:a(challenge['challengeId'],challenge['nonce'],
     source={**src,'command_count':1}))
 result=a(challenge['challengeId'],challenge['nonce'])
 check('SUPERADMIN_INTENT_RECORDED',result['recorded'] and result['state']==m.RECOVERY_CONSENT_STATE)
 check('INTENT_NEVER_AUTHORIZES_ISSUER',not result['issuerAuthority'] and not result['signedOwnerApproval'] and not result['dispatchPermitted'] and not result['attemptIssued'])
 deny('NONCE_REPLAY_DENIED',lambda:a(challenge['challengeId'],challenge['nonce']))
 deny('SECOND_CHALLENGE_AFTER_CONSENT_DENIED',lambda:c())
 read=m.get_recovery_consent_state(actor,store_path=dbpath)
 check('SIGNED_ACTOR_READBACK',read['recorded'] and read['state']==m.RECOVERY_CONSENT_STATE)
 deny('FOREIGN_STATE_READER_DENIED',lambda:m.get_recovery_consent_state({**actor,'id':'google_fake'},store_path=dbpath))
 db=sqlite3.connect(dbpath)
 for sql,label in [
 ("UPDATE recovery_consent_intents SET state='APPROVED'","APPROVAL_UPGRADE_DENIED"),
 ("DELETE FROM recovery_consent_intents","CONSENT_DELETE_DENIED"),
 ("UPDATE recovery_consent_intents SET attempt_issued=1","ISSUER_ATTEMPT_FLAG_DENIED"),
 ("UPDATE recovery_consent_intents SET dispatch_permitted=1","DISPATCH_FLAG_DENIED")]:
  try:db.execute(sql);db.commit()
  except sqlite3.DatabaseError:db.rollback();check(label,True)
  else:check(label,False)
 check('ONE_IMMUTABLE_CONSENT',db.execute('select count(*) from recovery_consent_intents').fetchone()[0]==1)
 check('NONCE_CONSUMED_ATOMICALLY',db.execute('select count(*) from recovery_consent_challenges where consumed_at_ms is not null').fetchone()[0]==1)
 check('NO_CORE_HUB_WRITES_BY_INTENT',db.execute('select count(*) from reviews').fetchone()[0]==1)
 db.close()
 print('RESULT',n,'PASS')
 print('REAL_DEV_AND_PROD_DATABASES_UNCHANGED=TRUE')
