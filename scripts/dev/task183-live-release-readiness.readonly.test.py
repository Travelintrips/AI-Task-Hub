#!/usr/bin/env python3
"""Task183 read-only audit state classifications, including real historical signed evidence."""
import importlib.util
from pathlib import Path
HERE=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location("readonly_status",HERE/"task183-live-release-readiness.readonly.py")
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
BASE=dict(decisions=0,outbox=0,matched=0,receipts=0,completed=0,
          unresolved=0,last_expiry_ms=None,now_ms=2_000_000)
tests=[
 ("NO_DECISION",{}, "NO_GO_OWNER_DECISION_NOT_RECORDED"),
 ("OUTBOX_MISMATCH",dict(decisions=2,outbox=1,matched=1),"NO_GO_OWNER_OUTBOX_LINEAGE_MISMATCH"),
 ("HISTORICAL_SIGNED_EXPIRED",dict(decisions=2,outbox=2,matched=2,receipts=1,
   completed=1,last_expiry_ms=1_000_000),"NO_GO_HISTORICAL_SIGNATURE_EXPIRED_REGISTRATION_UNVERIFIED"),
 ("RECEIPT_WITHIN_WINDOW",dict(decisions=2,outbox=2,matched=2,receipts=1,
   completed=1,last_expiry_ms=3_000_000),"NO_GO_HISTORICAL_RECEIPT_REGISTRATION_UNVERIFIED"),
 ("CRASH_RESERVATION",dict(decisions=2,outbox=2,matched=2,receipts=1,
   unresolved=1,last_expiry_ms=1_000_000),"NO_GO_UNRESOLVED_SIGNATURE_REQUIRES_MANUAL_REVIEW"),
 ("OWNER_ONLY",dict(decisions=1,outbox=1,matched=1,last_expiry_ms=3_000_000),
   "NO_GO_OWNER_DECISION_EXISTS_WITHOUT_COMPLETED_RECEIPT"),
 ("NEGATIVE_COUNTS",dict(decisions=-1),"NO_GO_INVALID_READ_ONLY_EVIDENCE"),
]
for name,overrides,expected in tests:
 args={**BASE,**overrides}
 observed=m.classify(**args)
 assert observed==expected,(name,observed,expected)
 assert observed.startswith("NO_GO_")
 print("PASS:"+name)
print(f"RESULT={len(tests)}/{len(tests)} PASS")
print("REAL_DATABASE_MODIFIED=FALSE")
