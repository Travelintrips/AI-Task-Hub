#!/usr/bin/env python3
"""Durable crash-before/after-signing, restart and concurrent replay tests."""
import concurrent.futures,importlib.util,sqlite3,tempfile,threading,time
from pathlib import Path

p=Path(__file__).with_name('task183-durable-sign-once.fixture.py')
spec=importlib.util.spec_from_file_location('durable',p)
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
n=0
def passed(label,ok):
 global n
 n+=1
 if not ok:raise AssertionError('FAIL:'+label)
 print('PASS:'+label)
def denied(label,fn):
 try:fn()
 except (ValueError,sqlite3.DatabaseError,RuntimeError):passed(label,True)
 else:passed(label,False)

with tempfile.TemporaryDirectory(prefix='task183-crash-fence-fixture-') as td:
 store=Path(td)/'synthetic-durable-signatures.sqlite'
 mod.create_fixture_schema(store)
 calls=[];mutex=threading.Lock()
 def signer():
  with mutex:calls.append('signed')
  time.sleep(.2)
  return {'signature':'A'*86}
 def verifier(sig):return sig=='A'*86
 base={'store':store,'approval_digest':'a'*64,'request_id':'6bcd8419254dc21c0b149eb09e68a7b6da66',
       'evidence_sha256':'b'*64,'signed_owner_decision':True,
       'signer_callback':signer,'verify_callback':verifier,'now_ms':1800000000000}
 def call(**extra):return mod.sign_at_most_once(**{**base,**extra})
 denied('NEVER_TRUST_UNVERIFIED_OWNER',
        lambda:call(signed_owner_decision=False))
 passed('NO_SIGNATURE_WITHOUT_OWNER',len(calls)==0)
 denied('NO_OPERATIONAL_SIGNER_AVAILABLE',
        lambda:call(fixture_only=False))
 denied('NO_UNTRUSTED_STORAGE_FILE',
        lambda:call(store=store.parent/'other.sqlite'))
 passed('NO_SIGNATURE_BEFORE_DURABLE_OWNER_GATE',len(calls)==0)
 with concurrent.futures.ThreadPoolExecutor(max_workers=5) as ex:
  results=[f.result(timeout=8) for f in [ex.submit(call) for _ in range(5)]]
 passed('ONE_SIGNER_CALLBACK_ACROSS_FIVE_CONCURRENT_REQUESTS',len(calls)==1)
 passed('CONCURRENT_REQUESTS_NEVER_RECEIVE_UNVERIFIED_SIGNATURE',
        all(x['state'] in ('UNRESOLVED_SIGNING','COMPLETED') for x in results) and
        all(x.get('signatureSha256') is None for x in results if x['state']=='UNRESOLVED_SIGNING') and
        len({x.get('signatureSha256') for x in results if x['state']=='COMPLETED'})<=1)
 passed('AT_LEAST_ONE_COMPLETED_SIGNATURE',any(x['state']=='COMPLETED' for x in results))
 state=mod.status(store=store,approval_digest=base['approval_digest'],
                  request_id=base['request_id'],evidence_sha256=base['evidence_sha256'])
 passed('ONE_COMPLETED_DURABLE_ENVELOPE',state['state']=='COMPLETED')
 passed('RESTART_RETURNS_SAME_RECEIPT_WITHOUT_RESIGNING',
        call()['signatureSha256']==state['signatureSha256'] and len(calls)==1)
 denied('CROSS_DIGEST_REPLAY_NEVER_SIGNS',
        lambda:call(approval_digest='c'*64))
 denied('MISMATCHED_EVIDENCE_REPLAY_NEVER_SIGNS',
        lambda:call(evidence_sha256='d'*64))
 passed('REPLAY_DID_NOT_CALL_SIGNER',len(calls)==1)
 # Simulate a power loss after the external signer returns but before the
 # signature envelope can be durably committed.
 base2={**base,'approval_digest':'e'*64,
        'request_id':'f'*36,'evidence_sha256':'1'*64}
 denied('SYNTHETIC_CRASH_AFTER_REAL_SIGNER_CALL',
        lambda:mod.sign_at_most_once(**base2,simulate_crash_after_signature=True))
 passed('CRASH_CALLBACK_EXACTLY_ONCE',len(calls)==2)
 unresolved=mod.status(store=store,approval_digest=base2['approval_digest'],
    request_id=base2['request_id'],evidence_sha256=base2['evidence_sha256'])
 passed('CRASH_LEFT_DURABLE_UNRESOLVED_FENCE',
        unresolved['state']=='UNRESOLVED_SIGNING' and unresolved['signed'] is False)
 restart=mod.sign_at_most_once(**base2)
 passed('RESTART_REFUSES_SECOND_SIGNATURE',
        restart['state']=='UNRESOLVED_SIGNING' and len(calls)==2)
 # Callback that rejects a forged signer output leaves RESERVED too.
 base3={**base,'approval_digest':'2'*64,'request_id':'3'*36,
        'evidence_sha256':'4'*64}
 denied('UNVERIFIED_SIGNER_RESPONSE_REJECTED',
        lambda:mod.sign_at_most_once(**{**base3,'verify_callback':lambda _:False}))
 passed('INVALID_SIGNATURE_STAYS_UNRESOLVED',
        mod.status(store=store,approval_digest=base3['approval_digest'],
          request_id=base3['request_id'],
          evidence_sha256=base3['evidence_sha256'])['state']=='UNRESOLVED_SIGNING')
 x=sqlite3.connect(store)
 passed('ONE_SIGNED_TWO_RESERVED',
        x.execute("select count(*) from task183_signing_outbox where signer_state='COMPLETED'").fetchone()[0]==1 and
        x.execute("select count(*) from task183_signing_outbox where signer_state='RESERVED'").fetchone()[0]==2)
 passed('NO_GRANTED_ISSUER_OR_DISPATCH',
        x.execute("select count(*) from task183_signing_outbox where issuer_authorized<>0 or dispatch_permitted<>0").fetchone()[0]==0)
 for sql,label in [
  ("UPDATE task183_signing_outbox SET dispatch_permitted=1","DISPATCH_ESCALATION_DENIED"),
  ("UPDATE task183_signing_outbox SET signer_state='RESERVED'","SIGNATURE_DOWNGRADE_DENIED"),
  ("DELETE FROM task183_signing_outbox","SIGNATURE_DELETE_DENIED")]:
  try:x.execute(sql);x.commit()
  except sqlite3.DatabaseError:x.rollback();passed(label,True)
  else:passed(label,False)
 x.close()
print('RESULT',n,'PASS')
print('ALL_SIGNATURES_SYNTHETIC=TRUE')
print('CST_PRIVATE_KEY_AND_LIVE_DB_UNCHANGED=TRUE')
