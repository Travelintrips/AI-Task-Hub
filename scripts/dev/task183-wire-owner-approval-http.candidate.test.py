#!/usr/bin/env python3
"""Verify owner HTTP source patch is strictly additive, without live services."""
import ast,importlib.util
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("owner_patch",HERE/"task183-wire-owner-approval-http.candidate.py")
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
base=(HERE/"task183-before-owner-approval-http.baseline.py.txt").read_text()
current=(HERE/"task183-single-click-broker-dev.py").read_text()
candidate=p.patched(base)
n=0
def check(label,ok):
 global n
 assert ok,label
 n+=1;print("PASS:"+label)
def funcmap(src):
 tree=ast.parse(src)
 handler=next(x for x in tree.body if isinstance(x,ast.ClassDef) and x.name=="Handler")
 return {m.name:ast.get_source_segment(src,m) for m in handler.body if isinstance(m,ast.FunctionDef)}
orig=funcmap(base);new=funcmap(candidate)
# The deployed source contains a separately reviewed fail-closed readiness
# gate. Subtract only that explicitly identified addition, then verify the
# original route patch is otherwise byte-for-byte preserved.
prefix="OWNER_APPROVAL_READINESS_PATH="
suffix="RECOVERY_CHALLENGE_BODY="
i=current.index(prefix);j=current.index(suffix,i)
normal=current[:i]+current[j:]
start="        if self.path==OWNER_APPROVAL_READINESS_PATH:"
end="        if self.path==OWNER_IDENTITY_STATUS_PATH:"
i=normal.index(start);j=normal.index(end,i)
normal=normal[:i]+normal[j:]
normal=normal.replace("verify_session=verify_task183_owner_session,",
                      "verify_session=verify_jwt,")
normal=normal.replace('''                # Verify root-only one-shot source BEFORE committing the
                # irreversible Owner decision. Never discover missing code
                # after the 120-second signed window has begun.
                after=checked_import(ROOT/"task183-owner-after-decision.candidate.py",
                    "task183_owner_after_decision")
''','')
normal=normal.replace('''                # The signed-session POST is the ONLY trigger. After the
                # writer atomically commits, invoke one detached signing
                # handoff immediately inside the 120-second Owner window.
                # On uncertain outcomes, return 202 for manual reconciliation:
                # never retry the irreversible Owner decision/signature.
                try:
                    result=after.run_handoff(response)
                except Exception as exc:
                    print("TASK183_OWNER_SIGNATURE_HANDOFF_FAILED",type(exc).__name__,flush=True)
                    result={"taskId":183,"ownerDecisionStored":True,
                            "signedEvidenceVerified":False,"manualReviewRequired":True,
                            "issuerAuthorized":False,"dispatchPermitted":False,
                            "releaseDecision":"NO_GO"}
                self.reply(201 if result["signedEvidenceVerified"] is True else 202,result)''',
                '''                self.reply(201,response)''')
check("NEW_POST_OWNER_ONE_SHOT_HANDOFF_PRESENT",
      'result=after.run_handoff(response)' in current and
      'self.reply(201 if result["signedEvidenceVerified"] is True else 202,result)' in current)

check("DEPLOYED_ORIGINAL_OWNER_PATCH_PRESERVED",candidate==normal)
check("NEW_BACKEND_OWNER_READINESS_EXISTS",
      "def task183_owner_signing_ready():" in current and
      "def verify_task183_owner_session(token):" in current)
check("POST_OWNERSHIP_CHECK_USES_READINESS",
      "verify_session=verify_task183_owner_session," in current)
check("GET_OWNER_READINESS_READONLY",
      "if self.path==OWNER_APPROVAL_READINESS_PATH:" in current and
      '"readOnly":True' in current)
check("SHORT_LIVED_APPROVAL_PROTECTED",
      'TASK183_SIGNER_BROKER_NOT_READY' in current and
      'cst-task183-root-broker.service' in current and
      'gpt02-issue159-operational-signer@approval.service' in current)
check("ORIGINAL_ROUTES_PRESERVED",orig["do_GET"]==new["do_GET"])
check("NO_OTHER_HANDLER_MUTATION",all(orig[n]==new[n] for n in orig if n!="do_POST"))
check("EXACT_ADDITIVE_OWNER_ROUTE",'if self.path==OWNER_APPROVAL_PATH:' in new["do_POST"])
check("SAME_ORIGIN_CHECK",'"Origin")!=ORIGIN' in new["do_POST"])
check("SIGNED_JWT_REQUIRED",'verify_session=verify_jwt' in new["do_POST"])
check("WRITER_IS_TRUSTED", 'write_approval=writer.record' in new["do_POST"])
check("NO_PASSED_CLIENT_ACTOR",'"actor":self.' not in new["do_POST"])
check("EXPLICIT_ACTION_BODY",'{"approveRecoveryAttempt2":true}' in candidate)
check("RELEASE_STAYS_NO_GO",'"dispatchPermitted":False' in new["do_POST"])
check("SINGLE_POST_HANDLER",candidate.count("def do_POST(self):")==1)
try:p.patched(candidate)
except ValueError:check("SECOND_PATCH_REFUSED",True)
else:check("SECOND_PATCH_REFUSED",False)
compile(candidate,"patched-owner-broker","exec")
check("SYNTAX_VALID",True)
# Exercise the actual Owner POST branch with no live credentials or services.
import io
from types import SimpleNamespace
branch=next(node for node in ast.walk(ast.parse(current))
            if isinstance(node,ast.If) and ast.unparse(node.test)=="self.path == OWNER_APPROVAL_PATH")
probe=ast.parse("def submit(self): pass")
probe.body[0].body=branch.body
calls={"writer":0,"signer":0}
def committed(**_):
 calls["writer"]+=1
 return {"ownerDecisionStored":True}
def failed_signer(_):
 calls["signer"]+=1
 raise RuntimeError("test handoff failure")
modules={"task183_owner_http":SimpleNamespace(authorize_request=committed),
         "task183_owner_writer":SimpleNamespace(record=None),
         "task183_owner_after_decision":SimpleNamespace(run_handoff=failed_signer)}
scope={"ORIGIN":"https://dev-ai-task.cstlogistic.co.id","ROOT":HERE,
       "checked_import":lambda path,alias:modules[alias],
       "verify_task183_owner_session":None,"load_review_intake":None}
exec(compile(ast.fix_missing_locations(probe),"<isolated Owner POST>","exec"),scope)
body=b'{"approveRecoveryAttempt2":true}'
replies=[]
scope["submit"](SimpleNamespace(path="/isolated",rfile=io.BytesIO(body),
 headers={"Origin":scope["ORIGIN"],"Host":"dev-ai-task.cstlogistic.co.id",
          "Content-Length":str(len(body)),"Authorization":"Bearer synthetic",
          "X-GPT02-Intent":"approve-task183-recovery-attempt2-only"},
 reply=lambda status,result:replies.append((status,result))))
check("POST_COMMIT_EXCEPTION_RETURNS_MANUAL_REVIEW",replies==[(202,{
 "taskId":183,"ownerDecisionStored":True,"signedEvidenceVerified":False,
 "manualReviewRequired":True,"issuerAuthorized":False,"dispatchPermitted":False,
 "releaseDecision":"NO_GO"})])
check("POST_COMMIT_EXCEPTION_DOES_NOT_RETRY",calls=={"writer":1,"signer":1})
print(f"RESULT={n}/{n} PASS")
