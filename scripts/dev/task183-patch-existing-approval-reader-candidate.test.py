#!/usr/bin/env python3
"""Exercise actual existing-reader route code on ephemeral Unix sockets only."""
import importlib.util,json,socket,threading,tempfile,time
from pathlib import Path
BASE=Path(__file__).parent

def get(name,path):
 spec=importlib.util.spec_from_file_location(name,path)
 mod=importlib.util.module_from_spec(spec)
 spec.loader.exec_module(mod)
 return mod

patch=get('patch',BASE/'task183-patch-existing-approval-reader-candidate.py')
source=(BASE/'gpt02-existing-approval-reader-baseline.py.txt').read_text()
new=patch.patch(source)
compile(new,'candidate','exec')
assert new.count('POST /approval-intent HTTP/1.1')==1
assert new.count('POST /owner-outbox-intent HTTP/1.1')==1
assert new.count('POST /verify-owner-recovery-approval HTTP/1.1')==1

with tempfile.TemporaryDirectory(prefix='task183-reader-route-fixture-') as path:
 script=Path(path)/'test_reader.py';script.write_text(new)
 mod=get('candidate_reader',script)
 target=Path(path)/'reader.sock'
 obs=int(time.time()*1000)
 payload={'claimsSha256':'a'*64,'taskId':183,
    'requestId':'6bcd8419254dc21c0b149eb09e68a7b6da66',
    'evidenceSha256':'89950d3b8ac91aac612810325c6a219cb898a6fa41b234a477f0dbe32d85eb7b',
    'ownerSubject':'owner:synthetic-reviewer','nonce':'A'*48,
    'observedAt':obs}
 sample={'ok':True,'environment':'DEV',
   'source':'task183-independent-recovery-approval-reader','readOnly':True,
   'releaseDecision':'NO_GO','claimsSha256':payload['claimsSha256'],
   'requestId':payload['requestId'],'ownerSubject':payload['ownerSubject'],
   'evidenceSha256':payload['evidenceSha256'],
   'signatureVerified':False,'persistedIndependentOwnerDecision':True,
   'issuerAuthorizationGranted':False,'dispatchPermitted':False}
 cnt=0
 def check(name,condition):
  global cnt
  cnt+=1
  if not condition:raise AssertionError('FAIL:'+name)
  print('PASS:'+name)
 def call(route,body,handler=None):
  if target.exists():target.unlink()
  class H(mod._Handler):pass
  H.task183_recovery_reader_fn=handler
  H.approval_reader_fn=lambda *args,**kwargs:{
     'persistedTrustedReadProven':True,'sourceOutboxMatched':True}
  H.operational=False
  H.db_path=str(Path(path)/'nonexistent.sqlite')
  server=mod._UnixServer(str(target),H)
  server.timeout=4
  t=threading.Thread(target=server.handle_request,daemon=True);t.start()
  content=json.dumps(body,separators=(',',':')).encode()
  req=(('POST '+route+' HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: '+str(len(content))+'\r\n\r\n').encode()+content)
  try:
   with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as s:
    s.settimeout(4);s.connect(str(target));s.sendall(req)
    chunks=[]
    while True:
     part=s.recv(4096)
     if not part:break
     chunks.append(part)
   raw=b''.join(chunks)
   head,_,payload_bytes=raw.partition(b'\r\n\r\n')
   return int(head.split(b' ',2)[1]),json.loads(payload_bytes)
  finally:
   t.join(timeout=5);server.server_close()
   if target.exists():target.unlink()
 route='/verify-owner-recovery-approval'
 code,reply=call(route,payload,lambda *a,**k:{
     'ok':False,'persistedIndependentOwnerDecision':False})
 check('NO_INDEPENDENT_OWNER_DECISION_404',code==404 and reply['releaseDecision']=='NO_GO')
 code,reply=call(route,payload,lambda *a,**k:sample)
 check('SIGNED_GOOGLE_DECISION_READBACK_200',code==200 and reply['ok'] is True)
 check('DECISION_READBACK_CANNOT_GRANT_ISSUER',
   reply['signatureVerified'] is False and reply['issuerAuthorizationGranted'] is False
   and reply['dispatchPermitted'] is False)
 for key,bad,mark in [
  ('issuerAuthorizationGranted',True,'FORGED_ISSUER_GRANT_DENIED'),
  ('signatureVerified',True,'FALSIFIED_SIGNED_DECISION_DENIED'),
  ('requestId','b'*36,'ALTERED_REQUEST_ID_DENIED'),
  ('source','caller-supplied','UNTRUSTED_SOURCE_DENIED'),
  ('releaseDecision','GO','UNTRUSTED_RELEASE_DENIED'),
  ('evidenceSha256','b'*64,'ALTERED_EVIDENCE_HASH_DENIED')]:
  code,_=call(route,payload,lambda *a,**k:{**sample,key:bad})
  check(mark,code==404)
 code,_=call(route,{**payload,'observedAt':obs-15000},lambda *a,**k:sample)
 check('STALE_READER_LOOKUP_DENIED',code==400)
 code,_=call(route,{**payload,'inject':'true'},lambda *a,**k:sample)
 check('EXTRA_REQUEST_FIELD_DENIED',code==400)
 code,_=call('/obsolete',payload,None)
 check('NON_WHITELISTED_ROUTE_404',code==404)
 legacy={'lookup':{'claimsSha256':'c'*64,'taskId':159,'commandId':'x',
    'attemptId':'y','companyId':'default','superAdminId':'fixture'},'observedAt':obs}
 code,legacy_response=call('/approval-intent',legacy,None)
 check('OLD_APPROVAL_READER_ROUTE_PRESERVED',code==200 and
   legacy_response['approvalReadOnly'] is True)
 code,legacy_response=call('/owner-outbox-intent',legacy,None)
 check('OLD_OWNER_OUTBOX_READER_ROUTE_PRESERVED',code==200 and
   legacy_response['releaseDecision']=='NO_GO')
 print('RESULT',cnt,'PASS')
 print('REAL_OWNER_DECISION_WRITES=FALSE')
