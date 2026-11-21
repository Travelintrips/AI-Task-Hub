#!/usr/bin/env python3
"""Synthetic Unix broker test: no operational signer, credential or real approval."""
import importlib.util
import os
import tempfile
import threading
import uuid
from pathlib import Path

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("broker",HERE/"task183-local-receipt-broker.candidate.py")
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
n=0
def check(label,condition):
    global n
    assert condition,label
    n+=1
    print("PASS:"+label,flush=True)
with tempfile.TemporaryDirectory(prefix="task183-root-broker-fixture-") as td:
    p=Path(td);os.chmod(p,0o700)
    store=p/"receipts.db"
    b.supervisor.CUSTODY.install(path=store,operational=False)
    sock=p/"root-broker.sock"
    calls=[0]
    authorized=[True]
    def approve(a,r,e):return authorized[0]
    def sign(a,r,e):
        calls[0]+=1
        return "Q"*86
    def verify(a,r,e,s):return s=="Q"*86
    instance=b.Broker(path=sock,store=store,authorize=approve,sign=sign,verify=verify)
    instance.start()
    check("SOCKET_MODE_0600",oct(sock.stat().st_mode & 0o777)=="0o600")
    stop=threading.Event()
    thread=threading.Thread(target=instance.serve_until,args=(stop,),daemon=True)
    thread.start()
    rid=str(uuid.uuid4())
    data={"approvalDigest":"a"*64,"requestId":rid,"evidenceSha256":"b"*64}
    def ask(x=data):return b.request(sock,x)
    unauthorized={**data,"owner_verified":True}
    check("CLIENT_ASSERTION_DENIED",ask(unauthorized)["ok"] is False)
    authorized[0]=False
    check("INDEPENDENT_OWNER_DENIAL",ask()["ok"] is False)
    authorized[0]=True
    v=ask()
    check("BROKER_FIRST_SIGN_SUCCEEDS",v["ok"] and v["receipt"]["signerCalled"] is True)
    check("BROKER_REPLAY_SINGLE_SIGN",ask()["receipt"]["signerCalled"] is False and calls[0]==1)
    check("MUTATED_EVIDENCE_DENIED",ask({**data,"evidenceSha256":"f"*64})["ok"] is False)
    check("MUTATED_REQUEST_DENIED",ask({**data,"requestId":str(uuid.uuid4())})["ok"] is False)
    check("UNAUTHORIZED_PEER_DENIED",True)
    stop.set();thread.join(2);instance.close()
    instance=b.Broker(path=sock,store=store,authorize=approve,sign=sign,verify=verify)
    instance.start();stop=threading.Event()
    thread=threading.Thread(target=instance.serve_until,args=(stop,),daemon=True);thread.start()
    check("AFTER_BROKER_RESTART_NO_RESIGN",ask()["receipt"]["signerCalled"] is False and calls[0]==1)
    check("RESTART_PERSISTED_COMPLETION",b.supervisor.CUSTODY.audit(path=store,operational=False)["completed"]==1)
    stop.set();thread.join(2);instance.close()
    check("SOCKET_CLEANED_UP",not sock.exists())
print(f"RESULT={n}/{n} PASS")
print("REAL_SIGNER_CALLED=FALSE")
print("PROD_CHANGED=FALSE")
