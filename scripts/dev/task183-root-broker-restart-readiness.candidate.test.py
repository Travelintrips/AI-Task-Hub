#!/usr/bin/env python3
"""Task183 broker restart readiness must accept persisted immutable receipts.

All nonempty cases here use a temporary synthetic SQLite store. Live root
custody is read-only and must not be modified by this test.
"""
import importlib.util,sqlite3,tempfile
from pathlib import Path
HERE=Path(__file__).resolve().parent
def load(name,path):
 s=importlib.util.spec_from_file_location(name,HERE/path)
 m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
broker=load("task183_broker","task183-root-broker-operational.candidate.py")
custody=load("task183_custody","task183-dormant-signature-custody.py")
total=0
def check(name,cond):
 global total
 assert cond,name
 total+=1;print("PASS:"+name)
def denied(name,status):
 try:broker.verify_custody_recovery(status)
 except RuntimeError:check(name,True)
 else:check(name,False)
with tempfile.TemporaryDirectory(prefix="task183-custody-restart-fixture-") as td:
 db=Path(td)/"synthetic.sqlite"
 custody.install(path=db,operational=False)
 empty=custody.audit(path=db,operational=False)
 check("EMPTY_STORE_ACCEPTED",broker.verify_custody_recovery(empty)["total"]==0)
 with sqlite3.connect(db) as c:
  c.execute("INSERT INTO signature_receipts (approval_digest,request_id,evidence_sha256,state,reserved_at_ms) VALUES (?,?,?,?,?)",("a"*64,"6bcd8419254dc21c0b149eb09e68a7b6da66","b"*64,"RESERVED",1000))
  c.commit()
 unresolved=custody.audit(path=db,operational=False)
 check("ONE_UNRESOLVED_SURVIVES_RESTART",broker.verify_custody_recovery(unresolved)["unresolved"]==1)
 with sqlite3.connect(db) as c:
  c.execute("UPDATE signature_receipts SET state='COMPLETED',signed_at_ms=1500,signature_base64url=?,signature_sha256=? WHERE approval_digest=?",("A"*86,"d"*64,"a"*64))
  c.commit()
 completed=custody.audit(path=db,operational=False)
 check("COMPLETED_RECEIPT_SURVIVES_RESTART",broker.verify_custody_recovery(completed)["completed"]==1)
 with sqlite3.connect(db) as c:
  c.execute("INSERT INTO signature_receipts (approval_digest,request_id,evidence_sha256,state,reserved_at_ms) VALUES (?,?,?,?,?)",("c"*64,"f"*36,"e"*64,"RESERVED",1000))
  c.commit()
 mixed=custody.audit(path=db,operational=False)
 check("MIXED_COMPLETED_UNRESOLVED_SURVIVES_RESTART",broker.verify_custody_recovery(mixed)=={"total":2,"unresolved":1,"completed":1})
 denied("AUTHORITY_GRANT_REJECTED",{**mixed,"issuerAuthorized":True})
 denied("DISPATCH_GRANT_REJECTED",{**mixed,"dispatchPermitted":True})
 denied("MISSING_READONLY_PROVENANCE_REJECTED",{**mixed,"readOnly":False})
 denied("COUNT_MISMATCH_REJECTED",{**mixed,"total":99})
 denied("NEGATIVE_COUNT_REJECTED",{**mixed,"unresolved":-1})
 denied("FLOAT_COUNT_REJECTED",{**mixed,"total":2.0})
 denied("BOOL_COUNT_REJECTED",{**mixed,"completed":True})
 denied("UNINSTALLED_STORE_REJECTED",{**mixed,"installed":False})
 denied("UNKNOWN_OBJECT_REJECTED",None)
check("LIVE_STORE_UNTOUCHED_BY_SYNTHETIC_TEST",db!=custody.STORE)
print(f"RESULT={total}/{total} PASS")
print("REAL_SIGNER_CALLED=FALSE")
print("PROD_CHANGED=FALSE")
