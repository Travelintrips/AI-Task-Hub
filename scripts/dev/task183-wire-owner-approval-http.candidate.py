#!/usr/bin/env python3
"""Add exact Task183 Owner-approval route to existing signed-session DEV broker.

Patch is source-only. Never changes running HTTP process, approval data, or
signer. The route requires an explicit POST and delegates all persistence to
the existing independently validated Owner writer.
"""
import hashlib
from pathlib import Path

PATH_LINE='OWNER_IDENTITY_STATUS_PATH="/api/ai-tasks/183/gpt02-owner-identity-readiness?companyId=default"'
ROUTE_NAME='OWNER_APPROVAL_PATH="/api/ai-tasks/183/gpt02-owner-approval?companyId=default"'
ANCHOR='''    def do_POST(self):
        if self.path in (RECOVERY_CONSENT_CHALLENGE_PATH,RECOVERY_CONSENT_PATH):'''
INSERT='''    def do_POST(self):
        if self.path==OWNER_APPROVAL_PATH:
            # Final Owner decision is different from review ACK or recovery intent.
            # Both the endpoint and the writer demand an explicit signed action.
            if (self.headers.get("Origin")!=ORIGIN or
                self.headers.get("Host")!="dev-ai-task.cstlogistic.co.id"):
                self.reply(403,{"error":"SAME_ORIGIN_REQUIRED","dispatchPermitted":False});return
            if self.headers.get("X-GPT02-Intent")!="approve-task183-recovery-attempt2-only":
                self.reply(400,{"error":"EXPLICIT_OWNER_APPROVAL_INTENT_REQUIRED",
                                "dispatchPermitted":False});return
            length=self.headers.get("Content-Length","")
            if length!=str(len(b'{"approveRecoveryAttempt2":true}')):
                self.reply(400,{"error":"EXACT_OWNER_APPROVAL_BODY_REQUIRED",
                                "dispatchPermitted":False});return
            auth=self.headers.get("Authorization","")
            if not isinstance(auth,str) or not auth.startswith("Bearer "):
                self.reply(401,{"error":"AUTHENTICATION_REQUIRED",
                                "dispatchPermitted":False});return
            if self.headers.get("X-GPT02-Successor") is not None:
                self.reply(409,{"error":"SUCCESSOR_SIGNING_PATH_NOT_READY","dispatchPermitted":False})
                return
            try:
                adapter=checked_import(ROOT/"task183-owner-approval-http.candidate.py",
                    "task183_owner_http")
                writer=checked_import(ROOT/"task183-owner-approval-writer-dev.py",
                    "task183_owner_writer")
                response=adapter.authorize_request(
                    path=self.path,headers={
                        "Origin":self.headers.get("Origin"),
                        "Host":self.headers.get("Host"),
                        "X-GPT02-Intent":self.headers.get("X-GPT02-Intent"),
                        "Content-Type":self.headers.get("Content-Type"),
                        "Content-Length":length,
                        "Authorization":auth,
                        "X-GPT02-Successor":self.headers.get("X-GPT02-Successor")},
                    body=self.rfile.read(int(length)),
                    verify_session=verify_jwt,
                    load_review=load_review_intake,
                    write_approval=writer.record)
                self.reply(201,response)
            except (ValueError,TypeError,UnicodeError,KeyError):
                self.reply(409,{"error":"OWNER_APPROVAL_REJECTED_OR_NOT_READY",
                                "dispatchPermitted":False})
            except Exception as exc:
                print("TASK183_OWNER_APPROVAL_FAIL_CLOSED",type(exc).__name__,flush=True)
                self.reply(503,{"error":"OWNER_APPROVAL_UNAVAILABLE",
                                "dispatchPermitted":False})
            return
        if self.path in (RECOVERY_CONSENT_CHALLENGE_PATH,RECOVERY_CONSENT_PATH):'''

def patched(source):
    if source.count(PATH_LINE)!=1 or source.count(ANCHOR)!=1:
        raise ValueError("HTTP_BROKER_EXACT_SOURCE_DRIFT")
    if "OWNER_APPROVAL_PATH=" in source:
        raise ValueError("OWNER_APPROVAL_ROUTE_ALREADY_INSTALLED")
    source=source.replace(PATH_LINE,PATH_LINE+"\n"+ROUTE_NAME,1)
    source=source.replace(ANCHOR,INSERT,1)
    compile(source,"task183-owner-http-candidate","exec")
    if source.count("def do_POST(self):")!=1:
        raise ValueError("HTTP_HANDLER_DUPLICATED")
    return source

def main():
    import argparse
    p=argparse.ArgumentParser()
    p.add_argument("--source",required=True)
    p.add_argument("--target",required=True)
    a=p.parse_args()
    output=Path(a.target)
    if output.exists() or output.is_symlink():
        raise SystemExit("STAGED_TARGET_ALREADY_EXISTS")
    if not str(output).startswith("/opt/ai-coding-standalone-dev/qa/task183-owner-http-stage-"):
        raise SystemExit("ONLY_STAGED_DEV_PATH_ALLOWED")
    old=Path(a.source).read_text()
    output.write_text(patched(old))
    print("TASK183_OWNER_HTTP_ROUTE_CANDIDATE_STAGED=TRUE")
    print("LIVE_HTTP_SERVER_CHANGED=FALSE")

if __name__=="__main__":main()
