#!/usr/bin/env python3
"""Synthetic fail-closed gate contract tests; no database connection."""
import importlib.util
from pathlib import Path
src=Path("/opt/ai-coding-standalone-dev/qa/task183-postprepare-readiness.py")
spec=importlib.util.spec_from_file_location("task183_readonly_release_gate",src)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
good={"preparations":1,"hub_jobs":1,"matching_hub_prepared":1,"matching_core_pending":1,
 "official_command":1,"valid_command_approvals":1,"verified_bindings":1,
 "reservation_current":True,"preparer_locked":True,"preparer_sessions":0}
tests=[
 ("COMPLETE_PROOF_STILL_NO_DISPATCH",{},'READY_FOR_INDEPENDENT_ISSUER_CHECK_ONLY'),
 ("NO_OFFICIAL_COMMAND",{"official_command":0},'NO_GO_OFFICIAL_COMMAND_MISSING'),
 ("NO_OPERATOR_APPROVAL",{"valid_command_approvals":0},'NO_GO_COMMAND_BOUND_OWNER_APPROVAL_MISSING'),
 ("NO_VERIFIED_BINDING",{"verified_bindings":0},'NO_GO_IMMUTABLE_ATTEMPT_BINDING_MISSING'),
 ("EXPIRED_RESERVATION",{"reservation_current":False},'NO_GO_RESERVATION_EXPIRED'),
 ("DUPLICATE_HUB_JOB",{"hub_jobs":2},'NO_GO_PREPARATION_LINEAGE_MISMATCH'),
 ("DUPLICATE_CORE_PREPARATION",{"preparations":2},'NO_GO_PREPARATION_LINEAGE_MISMATCH'),
 ("PREPARER_STILL_LOGGED_IN",{"preparer_locked":False},'NO_GO_PREPARER_NOT_RELOCKED'),
 ("PREPARER_SESSION_LEAK",{"preparer_sessions":1},'NO_GO_PREPARER_NOT_RELOCKED'),
 ("UNVERIFIED_CORE_TASK",{"matching_core_pending":0},'NO_GO_PREPARATION_LINEAGE_MISMATCH'),
]
for label,changes,expected in tests:
 got=m.classify(dict(good,**changes))
 print(label,'PASS' if got==expected else 'FAIL')
 if got!=expected:raise SystemExit(4)
assert m.classify({"probe_error":"SYNTHETIC"})=="NO_GO_QUERY_UNAVAILABLE"
assert m.classify({})=="NO_GO_MISSING_PROOF"
print("SYNTHETIC_QA=12/12 PASS")
print("REAL_DB_WRITES=FALSE")
