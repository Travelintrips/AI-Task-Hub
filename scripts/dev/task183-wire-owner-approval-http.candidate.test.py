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
print(f"RESULT={n}/{n} PASS")
