#!/usr/bin/env python3
"""Narrow source patch of EXISTING GPT02 operational signer, offline only.

This produces a candidate file for independent review and CI. Never touches
the live /opt signer or any systemd unit/credential. New route fails closed
unless a root-owned independent Task183 approval reader exists.
"""
from pathlib import Path
import sys

EXTENSION = '''
RECOVERY_AUDIENCE="GPT02_TASK183_RECOVERY_ISSUER_APPROVAL_V1"
RECOVERY_FIELDS=("version","environment","audience","companyId","hubTaskId",
    "recoveryAttemptNumber","requestId","evidenceSha256","originalCoreTaskId",
    "originalHubExecutionId","originalAttemptId","ownerSubject","nonce",
    "issuedAt","expiresAt","purpose","dispatchPermitted")
# Reuse existing restricted read-only approval-reader service/socket.
# New route is deliberately absent until its independent Task183 decision
# handler is reviewed; existing reader returns 404 and signer refuses.
RECOVERY_READER="/run/gpt02-approval-reader/approval.sock"

def recovery_signing_bytes(claims):
    return (RECOVERY_AUDIENCE+"\\n").encode()+canonical(claims,RECOVERY_FIELDS)

def recovery_signed_owner_readback(claims,now):
    """Only trusted root-owned independent reader may assert authorization.

    This existing socket does not expose a Task183 approval route, so
    actual recovery signing stays NO-GO unless independently authorized.
    Never trust caller-supplied approval, approvals from Issue159, or the
    local human-ack/recovery-intent SQLite queue as an Owner signature.
    """
    import struct
    # Match existing approval-reader custody: root-owned socket and parent,
    # group access restricted to the already existing signer group.
    reader_group=grp.getgrnam("gpt02-issue159-signers").gr_gid
    if not exact(claims,RECOVERY_FIELDS):deny("RECOVERY_CLAIM_SHAPE_INVALID")
    import re
    if (not isinstance(claims.get("requestId"),str) or not re.fullmatch(r"[a-f0-9]{36}",claims["requestId"]) or
        not isinstance(claims.get("evidenceSha256"),str) or not re.fullmatch(r"[a-f0-9]{64}",claims["evidenceSha256"]) or
        not isinstance(claims.get("ownerSubject"),str) or not re.fullmatch(r"owner:[A-Za-z0-9_-]{4,120}",claims["ownerSubject"]) or
        any(not isinstance(claims.get(n),str) or not UUID_RE.fullmatch(claims[n]) for n in
            ("originalCoreTaskId","originalHubExecutionId","originalAttemptId")) or
        len({claims[n] for n in ("originalCoreTaskId","originalHubExecutionId","originalAttemptId")})!=3):
        deny("RECOVERY_ORIGINAL_EVIDENCE_SCOPE_DENIED")
    if (claims.get("version")!=1 or claims.get("environment")!="DEV" or
       claims.get("audience")!=RECOVERY_AUDIENCE or
       claims.get("companyId")!="default" or claims.get("hubTaskId")!=183 or
       claims.get("recoveryAttemptNumber")!=2 or
       claims.get("purpose")!="PREPARE_ATTEMPT2_ONLY" or
       claims.get("dispatchPermitted") is not False or
       not isinstance(claims.get("nonce"),str) or
       not NONCE_RE.fullmatch(claims["nonce"]) or
       type(claims.get("issuedAt")) is not int or
       type(claims.get("expiresAt")) is not int or
       claims["issuedAt"]>now+5000 or claims["issuedAt"]<now-300000 or
       not now<claims["expiresAt"]<=claims["issuedAt"]+300000):
        deny("RECOVERY_APPROVAL_SCOPE_OR_WINDOW_DENIED")
    digest=hashlib.sha256(recovery_signing_bytes(claims)).hexdigest()
    parent=Path(RECOVERY_READER).parent
    try:
        pst=os.lstat(parent)
        st=os.lstat(RECOVERY_READER)
    except OSError:
        deny("INDEPENDENT_RECOVERY_OWNER_APPROVAL_READER_MISSING")
    if (not stat.S_ISDIR(pst.st_mode) or stat.S_ISLNK(pst.st_mode)
        or pst.st_uid!=0 or pst.st_gid!=reader_group or
        stat.S_IMODE(pst.st_mode)!=0o750
        or not stat.S_ISSOCK(st.st_mode) or stat.S_ISLNK(st.st_mode)
        or st.st_uid!=0 or st.st_gid!=reader_group or
        stat.S_IMODE(st.st_mode)!=0o660):
        deny("RECOVERY_OWNER_READER_CUSTODY_INVALID")
    payload={"claimsSha256":digest,"taskId":183,"requestId":claims["requestId"],
             "evidenceSha256":claims["evidenceSha256"],
             "ownerSubject":claims["ownerSubject"],"nonce":claims["nonce"],
             "observedAt":now}
    body=json.dumps(payload,separators=(",",":")).encode()
    msg=(b"POST /verify-owner-recovery-approval HTTP/1.1\\r\\n"
      b"Host: localhost\\r\\nContent-Type: application/json\\r\\n"
      b"Content-Length: "+str(len(body)).encode()+
      b"\\r\\nConnection: close\\r\\n\\r\\n"+body)
    with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as client:
        client.settimeout(3)
        client.connect(RECOVERY_READER)
        if not hasattr(socket,"SO_PEERCRED"):deny("SO_PEERCRED_REQUIRED")
        _pid,uid,_gid=struct.unpack("3i",client.getsockopt(
            socket.SOL_SOCKET,socket.SO_PEERCRED,12))
        if uid!=0:deny("UNTRUSTED_RECOVERY_READER_PEER")
        client.sendall(msg)
        response=b""
        while True:
            chunk=client.recv(2048)
            if not chunk:break
            response+=chunk
            if len(response)>8192:deny("RECOVERY_READBACK_TOO_LARGE")
    head,sep,reply=response.partition(b"\\r\\n\\r\\n")
    if not sep or head.split(b"\\r\\n",1)[0]!=b"HTTP/1.1 200 OK":
        deny("RECOVERY_APPROVAL_READBACK_UNAVAILABLE")
    headers={}
    for line in head.split(b"\\r\\n")[1:]:
        key,sep2,value=line.partition(b":")
        name=key.strip().lower()
        if not sep2 or name in headers:deny("RECOVERY_RESPONSE_HEADERS_INVALID")
        headers[name]=value.strip()
    length=headers.get(b"content-length",b"")
    if (headers.get(b"content-type")!=b"application/json" or
        b"transfer-encoding" in headers or not length.isdigit() or
        int(length)!=len(reply)):
        deny("RECOVERY_RESPONSE_FRAMING_INVALID")
    try:
        data=json.loads(reply)
    except (ValueError,UnicodeError):
        deny("RECOVERY_APPROVAL_READBACK_INVALID")
    if (type(data) is not dict or set(data)!={
        "ok","environment","source","readOnly","releaseDecision",
        "claimsSha256","requestId","ownerSubject","evidenceSha256",
        "signatureVerified","persistedIndependentOwnerDecision",
        "issuerAuthorizationGranted","dispatchPermitted"} or
        data["ok"] is not True or data["environment"]!="DEV" or
        data["source"]!="task183-independent-recovery-approval-reader" or
        data["readOnly"] is not True or data["releaseDecision"]!="NO_GO" or
        data["claimsSha256"]!=digest or
        data["requestId"]!=claims["requestId"] or
        data["ownerSubject"]!=claims["ownerSubject"] or
        data["evidenceSha256"]!=claims["evidenceSha256"] or
        data["signatureVerified"] is not False or
        data["persistedIndependentOwnerDecision"] is not True or
        data["issuerAuthorizationGranted"] is not False or
        data["dispatchPermitted"] is not False):
        deny("PERSISTED_INDEPENDENT_SIGNED_OWNER_DECISION_REQUIRED")
    return digest
'''

METHOD = '''
    def sign_recovery_approval(self,data):
        if self.role!="approval" or not exact(data,("claims",)):
            deny("RECOVERY_SIGNER_ROLE_MISMATCH")
        claims=data["claims"]
        now=int(time.time()*1000)
        digest=recovery_signed_owner_readback(claims,now)
        # Only the existing detached, separately credentialed approval
        # signer signs, after independent root-owned readback approval.
        signature=base64.urlsafe_b64encode(
            self.key.sign(recovery_signing_bytes(claims))).decode().rstrip("=")
        return {"environment":"DEV","role":"approval",
            "audience":RECOVERY_AUDIENCE,"claims":claims,
            "signatureBase64url":signature,"claimsSha256":digest,
            "signedOwnerApprovalVerified":True,
            "issuerAuthorizationGranted":False,
            "attemptIssued":False,"dispatchPermitted":False,
            "releaseDecision":"NO_GO"}
'''

def patch(source):
    markers=[
      ('WORKER="openclaw-dell-chatgpt-wake-dev"',EXTENSION),
      ('    def sign_hub(self,data):',METHOD),
      ('b"POST /sign-issuer HTTP/1.1":"issuer"','b"POST /sign-issuer HTTP/1.1":"issuer",b"POST /sign-recovery-approval HTTP/1.1":"recovery-approval"'),
      ('if not self.signer or route!=self.signer.role: deny("ROUTE_ROLE_MISMATCH")',
       'if not self.signer or (route!=self.signer.role and not (route=="recovery-approval" and self.signer.role=="approval")): deny("ROUTE_ROLE_MISMATCH")'),
      ('"issuer":self.signer.sign_issuer}[route]','"issuer":self.signer.sign_issuer,"recovery-approval":self.signer.sign_recovery_approval}[route]')
    ]
    if "RECOVERY_AUDIENCE=" in source:
        raise ValueError("RECOVERY_PATCH_ALREADY_PRESENT")
    for old,new in markers:
        if source.count(old)!=1:
            raise ValueError("ORIGINAL_SIGNER_SOURCE_DRIFT:"+old[:50])
        source=source.replace(old,old+"\n"+new if old.startswith('WORKER=') else new if old.startswith(('b"POST','if not self.signer','"issuer":')) else new+old,1)
    return source

if __name__=="__main__":
    if len(sys.argv)!=3:raise SystemExit("SOURCE_AND_DEST_REQUIRED")
    source=Path(sys.argv[1]).read_text()
    output=Path(sys.argv[2])
    if output.exists():raise SystemExit("CANDIDATE_ALREADY_EXISTS")
    output.write_text(patch(source))
    print("EXISTING_SIGNER_SCOPED_PATCH_CREATED_OFFLINE=TRUE")
