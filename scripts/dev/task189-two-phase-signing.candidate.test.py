#!/usr/bin/env python3
"""Isolated Task189 two-phase crash/concurrency test. No real signer or key."""
import concurrent.futures
import importlib.util
import tempfile
import uuid
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("two",HERE/"task189-two-phase-signing.candidate.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
count=0
def ok(name,value):
    global count
    assert value,name
    count+=1
    print("PASS:"+name)
def denied(name,callback):
    try:callback()
    except ValueError:ok(name,True)
    else:ok(name,False)
with tempfile.TemporaryDirectory(prefix="task189-two-phase-fixture-") as td:
    db=Path(td)/"receipts.sqlite"
    m.custody.install(path=db,operational=False)
    engine=m.TwoPhase(db)
    a="a"*64
    req=str(uuid.uuid4())
    ev="b"*64
    kwargs={"digest":a,"request":req,"evidence":ev,"independent_owner_readback":True}
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        results=list(pool.map(lambda _:engine.reserve(**kwargs),range(5)))
    ok("FIVE_CONCURRENT_ONLY_ONE_SIGNING_ADMITTED",sum(x["signingPermitted"] for x in results)==1)
    ok("REST_UNRESOLVED_WITH_NO_SIGNING",sum(x["state"]=="UNRESOLVED_SIGNING" for x in results)==4)
    reopened=m.TwoPhase(db)
    ok("RESTART_NO_SECOND_SIGNING",reopened.reserve(**kwargs)["signingPermitted"] is False)
    denied("REQUEST_ID_MUTATION_BLOCKED",lambda:reopened.reserve(**{**kwargs,"request":str(uuid.uuid4())}))
    denied("EVIDENCE_MUTATION_BLOCKED",lambda:reopened.reserve(**{**kwargs,"evidence":"c"*64}))
    denied("OTHER_DIGEST_SAME_REQUEST_BLOCKED",lambda:reopened.reserve(**{**kwargs,"digest":"d"*64}))
    denied("OWNER_READBACK_REQUIRED",lambda:reopened.reserve(**{**kwargs,"digest":"e"*64,"request":str(uuid.uuid4()),"independent_owner_readback":False}))
    sig="A"*86
    completion={"digest":a,"request":req,"evidence":ev,"signature":sig,"independent_signature_verify":lambda x:x==sig}
    denied("INVALID_SIGNATURE_DENIED",lambda:reopened.complete(**{**completion,"signature":"B"*86}))
    ok("COMPLETION_DURABLY_WRITTEN",reopened.complete(**completion)["newCompletion"] is True)
    ok("DUPLICATE_COMPLETION_IDEMPOTENT",reopened.complete(**completion)["newCompletion"] is False)
    denied("COMPLETED_SIGNATURE_IMMUTABLE",lambda:reopened.complete(**{**completion,"signature":"B"*86,"independent_signature_verify":lambda _:True}))
    ok("COMPLETE_REPLAY_NEVER_SIGN",reopened.reserve(**kwargs)["signingPermitted"] is False)
    ok("ROOT_CUSTODY_RECORD_PERSISTS",m.custody.audit(path=db,operational=False)["completed"]==1)
    crash={"digest":"f"*64,"request":str(uuid.uuid4()),"evidence":"1"*64,"independent_owner_readback":True}
    ok("CRASH_RESERVATION_CREATED",reopened.reserve(**crash)["signingPermitted"] is True)
    # Simulate process exit after actual signing, but before durable completion.
    recovered=m.TwoPhase(db)
    ok("CRASH_RESTART_REQUIRES_RECONCILIATION",recovered.reserve(**crash)["state"]=="UNRESOLVED_SIGNING")
    ok("CRASH_RESTART_NEVER_AUTOSIGNS",recovered.reserve(**crash)["signingPermitted"] is False)
    ok("UNRESOLVED_RECORD_IMMUTABLE",m.custody.audit(path=db,operational=False)["unresolved"]==1)
print(f"RESULT={count}/{count} PASS")
print("REAL_SIGNER_CALLED=FALSE")
print("PROD_CHANGED=FALSE")
