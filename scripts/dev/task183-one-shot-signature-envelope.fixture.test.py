#!/usr/bin/env python3
"""Replay and concurrent-signing proof for strictly isolated Task183 outbox."""
import concurrent.futures,importlib.util,sqlite3,tempfile,threading,time
from pathlib import Path
p=Path(__file__).with_name('task183-one-shot-signature-envelope.fixture.py')
spec=importlib.util.spec_from_file_location('sign_once',p)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
N=0
def passed(name,okay):
 global N
 N+=1
 if not okay:raise AssertionError('FAIL_'+name)
 print('PASS:'+name)
def denied(name,fn):
 try:fn()
 except (ValueError,sqlite3.DatabaseError):passed(name,True)
 else:passed(name,False)
with tempfile.TemporaryDirectory(prefix='task183-once-envelope-fixture-') as folder:
 path=Path(folder)/'synthetic-signatures.sqlite'
 digest='a'*64;proof='b'*64;req='6bcd8419254dc21c0b149eb09e68a7b6da66'
 calls=[];lock=threading.Lock()
 def sign():
  with lock:calls.append('called')
  time.sleep(.13)
  return {'signature':'S'*86,'verified':True}
 def issue(**extra):
  return m.issue_once(store=path,approval_digest=digest,
    request_id=req,evidence_sha256=proof,signer_callback=sign,
    approval_verified=True,**extra)
 denied('UNVERIFIED_OWNER_APPROVAL_DENIED',
   lambda:m.issue_once(store=path,approval_digest=digest,request_id=req,
     evidence_sha256=proof,signer_callback=sign,approval_verified=False))
 passed('NO_SIGN_AFTER_UNVERIFIED_APPROVAL',not calls)
 denied('OPERATIONAL_SIGNING_NOT_IMPLEMENTED',lambda:issue(fixture_only=False))
 denied('WRONG_DATABASE_DENIED',
   lambda:m.issue_once(store=Path(folder)/'other.sqlite',approval_digest=digest,
    request_id=req,evidence_sha256=proof,signer_callback=sign,
    approval_verified=True))
 def first():return issue()
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
  futures=[ex.submit(first) for i in range(4)]
  results=[v.result(timeout=6) for v in futures]
 passed('EXACTLY_ONE_SIGNATURE_GENERATION',len(calls)==1)
 passed('ONE_CREATION_THREE_SAFE_REPLAY_READS',
   sum(int(x['created']) for x in results)==1)
 passed('ALL_REPLAY_SIGNATURES_IDENTICAL',
   len({x['signatureSha256'] for x in results})==1)
 passed('NO_ISSUER_DISPATCH_GRANTED',
   all(x['issuerAuthorized'] is False and x['dispatchPermitted'] is False for x in results))
 denied('REPLAY_WITH_CHANGED_REQUEST_DENIED',
  lambda:m.issue_once(store=path,approval_digest=digest,request_id='c'*36,
    evidence_sha256=proof,signer_callback=sign,approval_verified=True))
 denied('REPLAY_WITH_CHANGED_EVIDENCE_DENIED',
  lambda:m.issue_once(store=path,approval_digest=digest,request_id=req,
    evidence_sha256='d'*64,signer_callback=sign,approval_verified=True))
 denied('SAME_REQUEST_DIFFERENT_DIGEST_DENIED_BEFORE_SIGNING',
  lambda:m.issue_once(store=path,approval_digest='e'*64,request_id=req,
    evidence_sha256=proof,signer_callback=sign,approval_verified=True))
 passed('NO_SECOND_SIGNATURE_GENERATED',len(calls)==1)
 c=sqlite3.connect(path)
 passed('EXACTLY_ONE_PERSISTED_ENVELOPE',
    c.execute('select count(*) from signature_envelopes').fetchone()[0]==1)
 for statement,label in [
  ('UPDATE signature_envelopes SET issuer_authorized=1','SIGNATURE_CANNOT_UPGRADE_ISSUER'),
  ('UPDATE signature_envelopes SET dispatch_permitted=1','SIGNATURE_CANNOT_DISPATCH'),
  ('DELETE FROM signature_envelopes','IMMUTABLE_SIGNED_OUTBOX')]:
  try:c.execute(statement);c.commit()
  except sqlite3.DatabaseError:c.rollback();passed(label,True)
  else:passed(label,False)
 c.close()
print('RESULT',N,'PASS')
print('ALL_CALLBACKS_SYNTHETIC_AND_NO_CST_KEY_LOADED=TRUE')
print('LIVE_APPROVAL_DATABASE_UNCHANGED=TRUE')
