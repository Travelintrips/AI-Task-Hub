#!/usr/bin/env python3
"""Task183 explicit Owner approval HTTP adapter; candidate only, no live route.

This module is designed for the EXISTING authenticated DEV HTTP broker.
The caller supplies authenticated headers and raw request body, but actor and
historical evidence are obtained ONLY from trusted callbacks. Neither are
accepted from client JSON. No automatic approval or signer invocation.
"""
import json
import re

PATH="/api/ai-tasks/183/gpt02-owner-approval?companyId=default"
ORIGIN="https://dev-ai-task.cstlogistic.co.id"
HOST="dev-ai-task.cstlogistic.co.id"
INTENT="approve-task183-recovery-attempt2-only"
BODY=b'{"approveRecoveryAttempt2":true}'

class ApprovalRejected(ValueError):pass

def authorize_request(*,path,headers,body,verify_session,load_review,write_approval):
    if path!=PATH:
        raise ApprovalRejected("NOT_FOUND")
    if not isinstance(headers,dict) or type(body) is not bytes:
        raise ApprovalRejected("HTTP_REQUEST_SHAPE_DENIED")
    if (headers.get("Origin")!=ORIGIN or headers.get("Host")!=HOST):
        raise ApprovalRejected("SAME_ORIGIN_REQUIRED")
    if (headers.get("X-GPT02-Intent")!=INTENT):
        raise ApprovalRejected("EXPLICIT_APPROVAL_INTENT_REQUIRED")
    if headers.get("Content-Type","").split(";")[0].strip()!="application/json":
        raise ApprovalRejected("CONTENT_TYPE_INVALID")
    if body!=BODY or headers.get("Content-Length")!=str(len(BODY)):
        raise ApprovalRejected("EXACT_APPROVAL_BODY_REQUIRED")
    auth=headers.get("Authorization","")
    if not isinstance(auth,str) or not auth.startswith("Bearer "):
        raise ApprovalRejected("AUTHENTICATION_REQUIRED")
    if not all(callable(x) for x in (verify_session,load_review,write_approval)):
        raise ApprovalRejected("TRUSTED_SERVER_CALLBACKS_REQUIRED")
    # JWT is verified by the same server-side routine used by the current DEV
    # Super Admin paths. Ignore all client-provided actor and evidence fields.
    actor=verify_session(auth[7:])
    if (type(actor) is not dict or actor.get("role")!="super_admin" or
        actor.get("companyId") not in (None,"default") or
        actor.get("authSource")!="supabase_google_identity"):
        raise ApprovalRejected("VERIFIED_GOOGLE_SUPERADMIN_REQUIRED")
    reader=load_review()
    packet=reader.review_evidence_packet(actor)
    consent=reader.get_recovery_consent_state(actor)
    if (type(packet) is not dict or packet.get("readOnly") is not True or
        packet.get("ownerApprovalGranted") is not False or
        packet.get("dispatchPermitted") is not False or
        type(consent) is not dict or consent.get("recorded") is not True or
        consent.get("state")!="SUPERADMIN_RECOVERY_INTENT_PENDING_INDEPENDENT_ISSUER" or
        consent.get("issuerAuthority") is not False or
        consent.get("dispatchPermitted") is not False):
        raise ApprovalRejected("INDEPENDENT_REVIEW_AND_CONSENT_REQUIRED")
    evidence=packet.get("evidence")
    if type(evidence) is not dict:
        raise ApprovalRejected("TRUSTED_EVIDENCE_REQUIRED")
    expected={"requestId":evidence.get("requestId"),
              "evidenceSha256":packet.get("evidenceSha256"),
              "originalCoreTaskId":evidence.get("coreTaskId"),
              "originalHubExecutionId":evidence.get("hubExecutionId"),
              "originalAttemptId":evidence.get("originalAttemptId")}
    if any(not isinstance(v,str) or not v for v in expected.values()):
        raise ApprovalRejected("INCOMPLETE_IMMUTABLE_EVIDENCE")
    # This is the ONLY possible write, triggered by a genuine authenticated
    # user POST. Writer revalidates Owner identity, original evidence and DB.
    successor=headers.get("X-GPT02-Successor")
    options={}
    if successor is not None:
        if (not isinstance(successor,str) or not re.fullmatch("[0-9a-f]{36}",successor)
            or successor==expected["requestId"]):
            raise ApprovalRejected("INVALID_SUCCESSOR_REFERENCE")
        options["successor_request"]=successor
    result=write_approval(actor=actor,evidence=expected,explicit_action=True,**options)
    if (type(result) is not dict or result.get("recorded") is not True or
        result.get("ownerDecisionStored") is not True or
        (successor is not None and result.get("requestId")!=successor) or
        result.get("cryptographicOwnerSignatureCreated") is not False or
        result.get("issuerAuthorized") is not False or
        result.get("attemptIssued") is not False or
        result.get("dispatchPermitted") is not False or
        result.get("releaseDecision")!="NO_GO"):
        raise ApprovalRejected("OWNER_WRITER_CONTRACT_INVALID")
    return {"taskId":183,"ownerDecisionStored":True,"requestId":result["requestId"],
            "recorded":True,"cryptographicOwnerSignatureCreated":False,
            "attemptIssued":False,"issuerAuthorized":False,
            "dispatchPermitted":False,"releaseDecision":"NO_GO"}
