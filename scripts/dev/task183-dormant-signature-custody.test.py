#!/usr/bin/env python3
import importlib.util,sqlite3,tempfile
from pathlib import Path
p=Path(__file__).with_name('task183-dormant-signature-custody.py')
s=importlib.util.spec_from_file_location('custody',p)
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
n=0
def check(label,ok):
 global n
 n+=1
 if not ok:raise AssertionError(label)
 print('PASS:'+label)
def denied(label,fn):
 try:fn()
 except (ValueError,sqlite3.Error):check(label,True)
 else:check(label,False)
with tempfile.TemporaryDirectory(prefix='task183-custody-isolated-') as td:
 q=Path(td)/'fixture.sqlite'
 check('NOT_INSTALLED_YET',m.audit(path=q,operational=False)['installed'] is False)
 data=m.install(path=q,operational=False)
 check('EMPTY_CUSTODY_INITIALIZED',data['total']==0)
 check('READ_ONLY_AUDIT_EMPTY',m.audit(path=q,operational=False)['total']==0)
 check('IDEMPOTENT_EMPTY_INSTALL',m.install(path=q,operational=False)['installed'])
 denied('UNPINNED_OPERATING_FILE_REJECTED',
        lambda:m.install(path=q,operational=True))
 with sqlite3.connect(q) as c:
  c.execute('INSERT INTO signature_receipts(approval_digest,request_id,evidence_sha256,state,reserved_at_ms) VALUES (?,?,?,?,?)',
           ('a'*64,'b'*36,'c'*64,'RESERVED',1000));c.commit()
 check('READ_ONLY_DETECTS_UNRESOLVED',
       m.audit(path=q,operational=False)['unresolved']==1)
 denied('REINSTALL_WITH_NONEMPTY_RECEIPT_DENIED',
        lambda:m.install(path=q,operational=False))
 with sqlite3.connect(q) as c:
  try:c.execute('DELETE FROM signature_receipts');c.commit()
  except sqlite3.DatabaseError:c.rollback();check('CANNOT_DELETE_RESERVATION',True)
  else:check('CANNOT_DELETE_RESERVATION',False)
  try:c.execute('UPDATE signature_receipts SET dispatch_permitted=1');c.commit()
  except sqlite3.DatabaseError:c.rollback();check('CANNOT_GRANT_DISPATCH',True)
  else:check('CANNOT_GRANT_DISPATCH',False)
  c.execute("UPDATE signature_receipts SET state='COMPLETED',signed_at_ms=1500,signature_base64url=?,signature_sha256=? WHERE approval_digest=?",
            ('A'*86,'d'*64,'a'*64));c.commit()
 check('READ_ONLY_AUDIT_ONE_COMPLETED',
       m.audit(path=q,operational=False)['completed']==1)
 with sqlite3.connect(q) as c:
  try:c.execute("UPDATE signature_receipts SET state='RESERVED'");c.commit()
  except sqlite3.DatabaseError:c.rollback();check('CANNOT_DOWNGRADE_SIGNED_RECORD',True)
  else:check('CANNOT_DOWNGRADE_SIGNED_RECORD',False)
print('RESULT',n,'PASS')
print('ALL_DATA_SYNTHETIC_NO_CST_KEY_OR_SIGNER=TRUE')
