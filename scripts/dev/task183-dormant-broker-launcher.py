#!/usr/bin/env python3
"""Task183 dormant service launcher: never signs, binds socket, or writes approval.

This file intentionally has NO operational broker launch path.
Its only permitted action is a read-only root custody audit and fail closed.
A separately reviewed operational implementation and service revision are
required before the system can ever leave NO-GO.
"""
import importlib.util
import os
from pathlib import Path

CUSTODY=Path("/opt/ai-coding-standalone-dev/qa/task183-dormant-signature-custody.py")
def main():
    if os.geteuid()!=0:
        raise SystemExit("TASK183_BROKER_NONROOT_DENIED")
    spec=importlib.util.spec_from_file_location("task183_dormant_custody",CUSTODY)
    m=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    status=m.audit(operational=True)
    if not (status["installed"] and status["total"]==0
            and status["issuerAuthorized"] is False
            and status["dispatchPermitted"] is False):
        raise SystemExit("TASK183_CUSTODY_NOT_EMPTY_OR_NOT_LOCKED")
    print("TASK183_DORMANT_BROKER_READ_ONLY_AUDIT_PASS")
    raise SystemExit("TASK183_NO_GO_OPERATIONAL_BROKER_NOT_IMPLEMENTED")
if __name__=="__main__":main()
