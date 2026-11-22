#!/usr/bin/env python3
"""One-shot post-decision handoff after authenticated Task183 Owner POST.

NEVER grants authority, retries after failure, calls this module on startup,
or fabricates Owner approval. This is called ONLY after the existing writer
commits exact Owner decision and matching outbox. No signing happens if
the independently authorized release gate is absent.
"""
from pathlib import Path
import os
import stat
import subprocess

REQUEST="6bcd8419254dc21c0b149eb09e68a7b6da66"
HANDOFF=Path("/opt/ai-coding-standalone-dev/qa/task183-owner-signer-one-shot.candidate.py")
LIMIT=16

class HandoffDenied(RuntimeError):pass

def validate_writer_result(decision):
    if (type(decision) is not dict or
        decision.get("requestId")!=REQUEST or
        decision.get("recorded") is not True or
        decision.get("ownerDecisionStored") is not True or
        decision.get("cryptographicOwnerSignatureCreated") is not False or
        decision.get("issuerAuthorized") is not False or
        decision.get("attemptIssued") is not False or
        decision.get("dispatchPermitted") is not False or
        decision.get("releaseDecision")!="NO_GO"):
        raise HandoffDenied("UNTRUSTED_COMMITTED_OWNER_DECISION")

def run_handoff(decision,*,runner=None,path=HANDOFF):
    validate_writer_result(decision)
    if os.geteuid()!=0:raise HandoffDenied("ROOT_SERVER_REQUIRED")
    p=Path(path)
    st=os.lstat(p)
    if (not stat.S_ISREG(st.st_mode) or p.is_symlink() or
        st.st_uid!=0 or st.st_gid!=0 or stat.S_IMODE(st.st_mode)!=0o400):
        raise HandoffDenied("ONE_SHOT_SCRIPT_SOURCE_UNTRUSTED")
    if runner is None:runner=subprocess.run
    try:
        proc=runner(["/usr/bin/python3",str(p),"--execute"],
            capture_output=True,text=True,timeout=LIMIT,check=False)
    except (OSError,subprocess.SubprocessError):
        return {"taskId":183,"ownerDecisionStored":True,
            "signedEvidenceVerified":False,"manualReviewRequired":True,
            "issuerAuthorized":False,"dispatchPermitted":False,
            "releaseDecision":"NO_GO"}
    # Handoff prints this line ONLY after detached Ed25519 signature
    # and durable broker receipt have BOTH verified.
    success=(proc.returncode==0 and
        proc.stdout.count("TASK183_ONE_SHOT_HANDOFF=PASS")==1 and
        "ISSUER_AUTHORIZED=FALSE" in proc.stdout and
        "DISPATCH_PERMITTED=FALSE" in proc.stdout)
    return {"taskId":183,"ownerDecisionStored":True,
        "signedEvidenceVerified":success,
        "manualReviewRequired":not success,
        "issuerAuthorized":False,"dispatchPermitted":False,
        "releaseDecision":"NO_GO"}
