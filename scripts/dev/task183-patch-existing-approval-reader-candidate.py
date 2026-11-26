#!/usr/bin/env python3
"""Add Task183 read-only decision route to EXISTING Issue159 approval reader.

Scoped surgical patch candidate. Existing two routes and trusted reader
remain unchanged. No approval writes, no signing, no new systemd service.
"""
from pathlib import Path
import sys

HELPER = '''
TASK183_RECOVERY_READER_SOURCE="/opt/ai-coding-standalone-dev/qa/task183-owner-recovery-decision-reader.py"

def _load_task183_recovery_reader():
    import importlib.util
    p=Path(TASK183_RECOVERY_READER_SOURCE)
    st=os.lstat(p)
    if (stat.S_ISLNK(st.st_mode) or not stat.S_ISREG(st.st_mode)
        or st.st_uid!=0 or stat.S_IMODE(st.st_mode)!=0o400):
        raise RuntimeError("ROOT_OWNER_RECOVERY_READER_SOURCE_UNTRUSTED")
    spec=importlib.util.spec_from_file_location("task183_recovery_decision",p)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.read_decision
'''
BRANCH = '''
            if require_outbox=="task183_recovery":
                if (not isinstance(req,dict) or set(req)!={"claimsSha256",
                    "taskId","requestId","evidenceSha256","ownerSubject",
                    "nonce","observedAt"}):
                    raise ValueError("TASK183_LOOKUP_SHAPE_INVALID")
                current_time=int(time.time()*1000)
                if type(req["observedAt"]) is not int or abs(
                      req["observedAt"]-current_time)>5000:
                    raise ValueError("TASK183_UNTRUSTED_OBSERVED_TIME")
                decision_reader=(type(self).task183_recovery_reader_fn or
                                 _load_task183_recovery_reader())
                record=decision_reader(req,db_path=self.db_path,
                                       operational=self.operational,
                                       now=current_time)
                # A persisted owner decision is NOT a detached signature.
                # This route returns only decision provenance, never an
                # issuer grant. The separately credentialed signer creates
                # the Ed25519 signature AFTER receiving this exact result.
                verified=(record.get("ok") is True and
                    record.get("environment")=="DEV" and
                    record.get("source")=="task183-independent-recovery-approval-reader" and
                    record.get("releaseDecision")=="NO_GO" and
                    all(record.get(k)==req[k] for k in
                        ("claimsSha256","requestId","evidenceSha256","ownerSubject")) and
                    record.get("persistedIndependentOwnerDecision") is True
                    and record.get("signatureVerified") is False
                    and record.get("issuerAuthorizationGranted") is False
                    and record.get("dispatchPermitted") is False
                    and record.get("readOnly") is True)
                if not verified:
                    self.wfile.write(_response(404,{
                        "ok":False,"reason":"TASK183_PERSISTED_OWNER_DECISION_MISSING",
                        "releaseDecision":"NO_GO","dispatchPermitted":False}))
                    return
                expected=("ok","environment","source","readOnly",
                    "releaseDecision","claimsSha256","requestId",
                    "ownerSubject","evidenceSha256","signatureVerified",
                    "persistedIndependentOwnerDecision",
                    "issuerAuthorizationGranted","dispatchPermitted")
                self.wfile.write(_response(200,
                    {key:record[key] for key in expected}))
                return
'''
def patch(s):
    old='''        b"POST /owner-outbox-intent HTTP/1.1":True,
'''
    assert s.count(old)==1
    s=s.replace(old,old+'''        b"POST /verify-owner-recovery-approval HTTP/1.1":"task183_recovery",
''',1)
    old='''class _Handler(socketserver.StreamRequestHandler):
    approval_reader_fn: Callable[...,dict] | None = None
'''
    assert s.count(old)==1
    s=s.replace(old,old+'''    task183_recovery_reader_fn: Callable[...,dict] | None = None
''',1)
    marker='''            req=json.loads(raw.decode("utf-8"))
            if not isinstance(req,dict) or set(req)!={"lookup","observedAt"}:
'''
    assert s.count(marker)==1
    s=s.replace(marker,'''            req=json.loads(raw.decode("utf-8"))
'''+BRANCH+'''            if not isinstance(req,dict) or set(req)!={"lookup","observedAt"}:
''',1)
    point='''MAX_BODY = 8192
'''
    assert s.count(point)==1
    s=s.replace(point,point+HELPER,1)
    return s
if __name__=="__main__":
    if len(sys.argv)!=3:raise SystemExit("SOURCE_DEST_REQUIRED")
    src=Path(sys.argv[1]);dest=Path(sys.argv[2])
    if dest.exists():raise SystemExit("CANDIDATE_EXISTS")
    output=patch(src.read_text())
    compile(output,str(dest),'exec')
    dest.write_text(output)
    print('TASK183_READ_ONLY_ROUTE_ADDED_EXISTING_READER_CANDIDATE=TRUE')
