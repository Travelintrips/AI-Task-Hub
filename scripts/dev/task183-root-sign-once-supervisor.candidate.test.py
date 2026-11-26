#!/usr/bin/env python3
"""Isolated tests. No real keys, signer, approvals, or production data."""
import concurrent.futures
import importlib.util
import sqlite3
import tempfile
import threading
import uuid
from pathlib import Path

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("supervisor",HERE/"task183-root-sign-once-supervisor.candidate.py")
s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
n=0

def check(name,condition):
    global n
    assert condition,name
    n+=1
    print("PASS:"+name)

def denied(name,call):
    try: call()
    except (ValueError,sqlite3.DatabaseError):
        check(name,True)
    else:check(name,False)

with tempfile.TemporaryDirectory(prefix="task183-root-supervisor-fixture-") as td:
    path=Path(td)/"custody.sqlite"
    s.CUSTODY.install(path=path,operational=False)
    count=[0]
    lock=threading.Lock()
    sig="A"*86
    def sign():
        with lock:count[0]+=1
        return sig
    def verify(value):return value==sig
    a="a"*64
    r=str(uuid.uuid4())
    e="e"*64
    def go(**extra):
        params=dict(approval_digest=a,request_id=r,evidence_sha256=e,
                    owner_verified=True,signer_callback=sign,verifier_callback=verify,
                    store=path,operational=False)
        params.update(extra)
        return s.run(**params)
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        outcomes=list(pool.map(lambda _:go(),range(5)))
    check("ONE_SIGN_FOR_FIVE_CONCURRENT_REQUESTS",count[0]==1)
    check("ALL_CONCURRENT_RECEIPTS_COMPLETED",all(x["state"]=="COMPLETED" for x in outcomes))
    check("REPLAY_DOES_NOT_SIGN_AGAIN",go()["signerCalled"] is False and count[0]==1)
    denied("EVIDENCE_MUTATION_DENIED",lambda:go(evidence_sha256="f"*64))
    denied("REQUEST_MUTATION_DENIED",lambda:go(request_id=str(uuid.uuid4())))
    denied("REUSED_REQUEST_DIFFERENT_DIGEST_DENIED",lambda:go(approval_digest="b"*64))
    denied("UNVERIFIED_OWNER_DENIED",lambda:go(owner_verified=False))
    denied("BAD_DIGEST_DENIED",lambda:go(approval_digest="bad"))
    b="c"*64
    rb=str(uuid.uuid4())
    eb="d"*64
    try:go(approval_digest=b,request_id=rb,evidence_sha256=eb,crash_after_sign=True)
    except RuntimeError:check("SYNTHETIC_CRASH_TRIGGERED",True)
    else:check("SYNTHETIC_CRASH_TRIGGERED",False)
    check("CRASH_ONE_SIGN_ONLY",count[0]==2)
    x=go(approval_digest=b,request_id=rb,evidence_sha256=eb)
    check("AFTER_CRASH_UNRESOLVED",x["state"]=="UNRESOLVED_SIGNING")
    check("AFTER_CRASH_NO_RESIGN",count[0]==2)
    check("PERSISTED_STATE_SURVIVES_NEW_DB_CONNECTION",s.CUSTODY.audit(path=path,operational=False)["unresolved"]==1)
    check("ISSUER_DISPATCH_ALWAYS_DENIED",all(v["issuerAuthorized"] is False and v["dispatchPermitted"] is False for v in outcomes+[x]))
    with sqlite3.connect(path) as c:
        try:c.execute("DELETE FROM signature_receipts");c.commit()
        except sqlite3.DatabaseError:c.rollback();check("NO_DELETE_TRIGGERS",True)
        else:check("NO_DELETE_TRIGGERS",False)
print("RESULT="+str(n)+"/"+str(n)+" PASS")
print("REAL_SIGNER_CALLED=FALSE")
print("PROD_CHANGED=FALSE")
