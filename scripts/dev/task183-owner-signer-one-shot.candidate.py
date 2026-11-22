#!/usr/bin/env python3
"""Task183 Owner decision -> detached signer one-shot handoff (CST-DEV only).

DEFAULT: preflight reads real DB without signing. --execute is an explicit
root-only operational action requiring pre-existing release sentinel, running
broker and signer, and one unexpired independent Owner decision. This code
never creates Owner approval, enables a unit, retries signatures, or dispatches.
"""
from __future__ import annotations
import argparse
import importlib.util
import json
import os
from pathlib import Path
import socket
import stat
import subprocess
import time

ROOT=Path("/opt/ai-coding-standalone-dev/qa")
SIGNER=Path("/run/gpt02-issue159-operational-signer-approval/signer.sock")
RELEASE=Path("/etc/gpt02-dev/task183-broker-release.approved")
BROKER=Path("/run/cst-task183-root-broker/broker.sock")
SIGNER_UNIT="gpt02-issue159-operational-signer@approval.service"
BROKER_UNIT="cst-task183-root-broker.service"
ISSUER_UNIT="gpt02-issue159-issuer-reader.service"
SOURCE="task183-resolve-approved-claims.readonly.candidate.py"
MAX_REPLY=8192

def reject(reason):raise RuntimeError(reason)

def guarded_import(filename,alias):
    p=ROOT/filename
    st=os.lstat(p)
    if (not stat.S_ISREG(st.st_mode) or stat.S_ISLNK(st.st_mode) or
        st.st_uid!=0 or st.st_gid!=0 or stat.S_IMODE(st.st_mode)!=0o400):
        reject("TASK183_HANDOFF_SOURCE_CUSTODY_DENIED")
    spec=importlib.util.spec_from_file_location(alias,p)
    m=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m

def active(unit):
    result=subprocess.run(["systemctl","show",unit,"--property=ActiveState","--value"],
                          capture_output=True,text=True,timeout=4,check=True)
    return result.stdout.strip()=="active"

def guard_runtime():
    if os.geteuid()!=0:reject("ROOT_ONLY_HANDOFF")
    if not RELEASE.is_file() or RELEASE.is_symlink():reject("RELEASE_NOT_GRANTED")
    st=os.lstat(RELEASE)
    if st.st_uid!=0 or st.st_gid!=0 or stat.S_IMODE(st.st_mode)!=0o400:
        reject("RELEASE_FILE_CUSTODY_INVALID")
    if RELEASE.read_text().strip()!="CST_DEV_TASK183_BROKER_RELEASE_V1":
        reject("RELEASE_FILE_CONTENT_INVALID")
    if not active(BROKER_UNIT) or not active(SIGNER_UNIT) or active(ISSUER_UNIT):
        reject("BROKER_AND_SIGNER_NOT_READY_OR_ISSUER_ACTIVE")
    for path,mode,kind in ((BROKER,0o660,"BROKER"),(SIGNER,0o660,"SIGNER")):
        st=os.lstat(path)
        if not stat.S_ISSOCK(st.st_mode) or stat.S_ISLNK(st.st_mode):
            reject(kind+"_SOCKET_NOT_AVAILABLE")
        if stat.S_IMODE(st.st_mode)!=mode:reject(kind+"_SOCKET_MODE_INVALID")
        if kind=="BROKER" and st.st_uid!=0:reject("BROKER_NOT_ROOT_OWNED")
        if kind=="SIGNER" and st.st_uid==0:reject("SIGNER_DYNAMIC_USER_REQUIRED")

def send_one(*,claims,digest,path=SIGNER,peer_check=None):
    if not isinstance(claims,dict) or not isinstance(digest,str):
        reject("CANONICAL_CLAIMS_REQUIRED")
    if peer_check is None:reject("TRUSTED_SIGNER_PEER_CHECK_REQUIRED")
    wire=json.dumps({"claims":claims},separators=(",",":"),ensure_ascii=False).encode()
    if not 0<len(wire)<=4096:reject("RECOVERY_CLAIMS_FRAME_INVALID")
    request=(b"POST /sign-recovery-approval HTTP/1.1\r\n"
        b"Host: localhost\r\nContent-Type: application/json\r\n"
        b"Content-Length: "+str(len(wire)).encode()+
        b"\r\nConnection: close\r\n\r\n"+wire)
    with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as conn:
        conn.settimeout(4)
        conn.connect(str(path))
        if peer_check(conn) is not True:reject("UNTRUSTED_SIGNER_UNIT_PEER")
        conn.sendall(request)
        chunks=[]
        count=0
        while True:
            b=conn.recv(2048)
            if not b:break
            count+=len(b)
            if count>MAX_REPLY:reject("SIGNER_REPLY_TOO_LARGE")
            chunks.append(b)
    raw=b"".join(chunks)
    headers,sep,payload=raw.partition(b"\r\n\r\n")
    if not sep or headers.split(b"\r\n",1)[0]!=b"HTTP/1.1 200 OK":
        reject("SIGNER_DID_NOT_SIGN_OR_DENIED")
    h={}
    for line in headers.split(b"\r\n")[1:]:
        k,sep,v=line.partition(b":")
        key=k.strip().lower()
        if not sep or key in h:reject("SIGNER_RESPONSE_HEADER_INVALID")
        h[key]=v.strip()
    length=h.get(b"content-length",b"")
    if (h.get(b"content-type")!=b"application/json" or not length.isdigit()
        or int(length)!=len(payload)):reject("SIGNER_RESPONSE_FRAMING_INVALID")
    reply=json.loads(payload)
    if (type(reply) is not dict or reply.get("claims")!=claims or
        reply.get("claimsSha256")!=digest or
        reply.get("signedOwnerApprovalVerified") is not True or
        reply.get("issuerAuthorizationGranted") is not False or
        reply.get("attemptIssued") is not False or
        reply.get("dispatchPermitted") is not False or
        reply.get("releaseDecision")!="NO_GO"):
        reject("SIGNED_RESULT_CLAIMS_OR_AUTHORITY_INVALID")
    return reply

def verified_handoff(*,reconstruction,send,verify_signature,now_ms=None):
    now=int(time.time()*1000) if now_ms is None else now_ms
    result=reconstruction()
    if (type(result) is not dict or
        result.get("decisionProvenanceVerified") is not True or
        result.get("signatureCreated") is not False or
        result.get("issuerAuthorized") is not False or
        result.get("dispatchPermitted") is not False or
        result.get("releaseDecision")!="NO_GO"):
        reject("INDEPENDENT_OWNER_DECISION_REQUIRED")
    claims=result.get("claims")
    digest=result.get("claimsSha256")
    if (type(claims) is not dict or claims.get("hubTaskId")!=183 or
        claims.get("recoveryAttemptNumber")!=2 or
        type(claims.get("expiresAt")) is not int or
        type(claims.get("issuedAt")) is not int or
        claims["issuedAt"]>now or claims["expiresAt"]<=now+10000 or
        claims["expiresAt"]-claims["issuedAt"]>120000):
        reject("OWNER_DECISION_TOO_OLD_OR_EXPIRING")
    # ONE request. No retry even on timeout/crash: reserve may already exist.
    signed=send(claims=claims,digest=digest)
    if verify_signature(signed,digest,claims) is not True:
        reject("SIGNED_RECOVERY_ED25519_VERIFICATION_FAILED")
    return {"taskId":183,"signedEvidenceVerified":True,
            "issuerAuthorized":False,"dispatchPermitted":False,
            "releaseDecision":"NO_GO"}

def run(mode,request_id=None):
    if os.geteuid()!=0:reject("ROOT_ONLY_HANDOFF")
    resolver=guarded_import(SOURCE,"task183_claims_reader")
    def reconstruct():
        return resolver.reconstruct() if request_id is None else resolver.reconstruct(request_id=request_id)
    if mode=="preflight":
        try:reconstruct()
        except ValueError as e:
            print("TASK183_OWNER_DECISION_READBACK=NO_GO_"+str(e))
            print("SIGNER_CALLED=FALSE")
            return 2
        print("TASK183_OWNER_DECISION_READBACK=VALID_UNEXPIRED")
        print("SIGNER_CALLED=FALSE")
        return 0
    guard_runtime()
    policy=guarded_import("task183-systemd-peer-policy.candidate.py","task183_peer_policy")
    verifier=guarded_import("task183-pinned-approval-verifier.candidate.py","task183_signature")
    def check_signature(signed,digest,claims):
        return verifier.verify(role="recovery-approval",digest=digest,
            request_id=claims["requestId"],evidence_sha256=claims["evidenceSha256"],
            claims=claims,signature=signed.get("signatureBase64url"),operational=True)
    answer=verified_handoff(reconstruction=reconstruct,
        send=lambda **kw:send_one(**kw,peer_check=policy.authenticated_peer),
        verify_signature=check_signature)
    print("TASK183_ONE_SHOT_HANDOFF="+("PASS" if answer["signedEvidenceVerified"] else "FAIL"))
    print("ISSUER_AUTHORIZED=FALSE")
    print("DISPATCH_PERMITTED=FALSE")
    return 0

def main():
    ap=argparse.ArgumentParser()
    g=ap.add_mutually_exclusive_group()
    g.add_argument("--preflight",action="store_true")
    g.add_argument("--execute",action="store_true")
    ap.add_argument("--request-id")
    args=ap.parse_args()
    raise SystemExit(run("execute" if args.execute else "preflight",args.request_id))

if __name__=="__main__":main()
