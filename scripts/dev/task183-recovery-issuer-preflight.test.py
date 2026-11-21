#!/usr/bin/env python3
"""Synthetic fail-closed contract tests, no live database or auth writes."""
import importlib.util,sqlite3,tempfile,sys
from pathlib import Path

ROOT=Path(__file__).parent
p=ROOT/'task183-recovery-issuer-preflight.py'
sp=importlib.util.spec_from_file_location('preflight_module',p)
m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
im=ROOT/'task183-recovery-review-intake-dev.py'
s=importlib.util.spec_from_file_location('intake_test_module',im)
i=importlib.util.module_from_spec(s);s.loader.exec_module(i)
NOW=1800000000000
actor={'id':'google_fixture_admin','role':'super_admin','companyId':None,
 'authSource':'supabase_google_identity','authVerifiedAt':NOW-10000}
source={'company_id':'default','hub_task_id':183,
 'core_task_id':'11111111-1111-4111-8111-111111111111',
 'hub_execution_id':'22222222-2222-4222-8222-222222222222',
 'attempt_id':'33333333-3333-4333-8333-333333333333',
 'command_candidate_id':'44444444-4444-4444-8444-444444444444',
 'expires_at_ms':NOW-100000,'expired':True,'prep_count':1,
 'job_count':1,'matching_job':1,'matching_core':1,
 'command_count':0,'binding_count':0,'preparer_sessions':0,'preparer_locked':True}
N=0
def passed(name,okay):
 global N
 N+=1
 if not okay:raise AssertionError(name)
 print('PASS '+name)
def failcase(name,store,sourced,locked=True):
 try:m.preflight(intake=str(im),store=str(store),source=sourced,roles_locked=locked,now_ms=NOW)
 except (ValueError,sqlite3.Error,TypeError):passed(name,True)
 else:passed(name,False)
with tempfile.TemporaryDirectory(prefix='issuer-gate-fixture-') as tmp:
 store=Path(tmp)/'consent.sqlite3'
 req=i.record_pending_request(actor=actor,source=source,store_path=store,now_ms=NOW)
 evidence=i.review_evidence_packet(actor,store_path=store,actual_source=source,now_ms=NOW)
 sha=evidence['evidenceSha256']
 failcase('MISSING_REVIEW_ACK_BLOCKS',store,source)
 i.attest_review_evidence(actor=actor,evidence_sha256=sha,store_path=store,actual_source=source,now_ms=NOW)
 failcase('MISSING_SUPERADMIN_CONSENT_BLOCKS',store,source)
 challenge=i.issue_recovery_consent_challenge(actor=actor,store_path=store,actual_source=source,now_ms=NOW)
 i.consent_to_recovery_review(actor=actor,challenge_id=challenge['challengeId'],
  nonce=challenge['nonce'],evidence_sha256=sha,store_path=store,actual_source=source,now_ms=NOW)
 result=m.preflight(intake=str(im),store=str(store),source=source,roles_locked=True,now_ms=NOW)
 passed('REAL_CONSENT_NEVER_BECOMES_OWNER_APPROVAL',
  result['status']=='NO_GO_INDEPENDENT_SIGNED_OWNER_APPROVAL_MISSING')
 passed('NONCE_AND_CONSENT_READBACK',
  result['proof']['singleUseNonceLocallyConsumed'] is True and
  result['proof']['signedGoogleSuperAdminIntentPresent'] is True)
 passed('ISSUER_REMAINS_NO_DISPATCH',
  not result['dispatchPermitted'] and not result['newAttemptCreated'] and
  not result['issuerAuthorityGranted'] and not result['databaseWrites'])
 unlocked=m.preflight(intake=str(im),store=str(store),source=source,roles_locked=False,now_ms=NOW)
 passed('UNLOCKED_ISSUER_DENIED',unlocked['status']=='NO_GO_ISSUER_ROLE_NOT_RELOCKED')
 for label,key,value in [
  ('ORIGINAL_CORE_MISMATCH_DENIED','core_task_id','55555555-5555-4555-8555-555555555555'),
  ('SECOND_HUB_JOB_DENIED','job_count',2),
  ('EXTRA_BRIDGE_COMMAND_DENIED','command_count',1),
  ('PREPARER_UNLOCKED_DENIED','preparer_locked',False),
  ('STILL_ACTIVE_ORIGINAL_DENIED','expired',False),
  ('EXTRA_ATTEMPT_BINDING_DENIED','binding_count',1)]:
  failcase(label,store,{**source,key:value})
 with sqlite3.connect(store) as db:
  db.execute("UPDATE recovery_consent_challenges SET consumed_at_ms=NULL")
 failcase('INVALID_NONCE_CONSUMPTION_DENIED',store,source)
 print('SYNTHETIC_PREPARATION_ISSUER_GATE_PASS='+str(N))
 print('NO_LIVE_CST_DEV_OR_PROD_WRITES=TRUE')
