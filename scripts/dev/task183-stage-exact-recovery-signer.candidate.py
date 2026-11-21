#!/usr/bin/env python3
"""Stage an exact-source Task183 recovery-only signer with a real Unix gate.

No active signer file, private key, credential, systemd unit or decision changed.
Output is a candidate only, refuses source drift and existing target.
"""
import argparse,hashlib
from pathlib import Path
import importlib.util
BASE_SHA="c004af2cffa54e834e4d40c33f5cdb947cbfbff63f72deae08c22c50411f9dce"
GATE="/opt/ai-coding-standalone-dev/qa/task183-signer-unix-gate.candidate.py"
HERE=Path(__file__).resolve().parent
sp=importlib.util.spec_from_file_location("task183_patch",HERE/"task183-patch-existing-signer-two-phase.candidate.py")
patcher=importlib.util.module_from_spec(sp);sp.loader.exec_module(patcher)
OLD='''    Handler.signer=Signer(role,key,public)'''
NEW='''    # Task183 is recovery-only. No other existing signer role is modified.
    task183_gate=None
    if role=="approval":
        import importlib.util as _task183_import
        import stat as _task183_stat
        _task183_path=Path("/opt/ai-coding-standalone-dev/qa/task183-signer-unix-gate.candidate.py")
        _task183_st=os.lstat(_task183_path)
        if (not _task183_stat.S_ISREG(_task183_st.st_mode) or
            _task183_stat.S_ISLNK(_task183_st.st_mode) or
            _task183_st.st_uid!=0 or
            _task183_st.st_gid!=__import__("grp").getgrnam("gpt02-issue159-signers").gr_gid or
            _task183_stat.S_IMODE(_task183_st.st_mode)!=0o440):
            deny("TASK183_GATE_SOURCE_CUSTODY_DENIED")
        _task183_spec=_task183_import.spec_from_file_location("task183_unix_gate",str(_task183_path))
        _task183_mod=_task183_import.module_from_spec(_task183_spec)
        _task183_spec.loader.exec_module(_task183_mod)
        task183_gate=_task183_mod.SignerGate()
    Handler.signer=Signer(role,key,public,task183_gate=task183_gate)'''

def make(original):
    if hashlib.sha256(original.encode()).hexdigest()!=BASE_SHA:
        raise ValueError("EXACT_SIGNER_BASELINE_SHA_MISMATCH")
    patch=patcher.patch(original)
    if patch.count(OLD)!=1:
        raise ValueError("EXACT_SIGNER_CONSTRUCTOR_DRIFT")
    result=patch.replace(OLD,NEW,1)
    if result.count("self.key.sign(recovery_signing_bytes(claims))")!=0:
        raise ValueError("RECOVERY_DIRECT_SIGN_REMAINS")
    if result.count('self.key.sign(signing_bytes("approval",c))')!=1:
        raise ValueError("ISSUE159_APPROVAL_CHANGED")
    return result

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--source",required=True)
    p.add_argument("--target",required=True)
    a=p.parse_args()
    output=Path(a.target)
    if output.exists() or output.is_symlink():
        raise SystemExit("CANDIDATE_TARGET_EXISTS")
    if not str(output).startswith("/opt/ai-coding-standalone-dev/qa/task183-stage-"):
        raise SystemExit("SCOPED_STAGE_DIRECTORY_REQUIRED")
    output.write_text(make(Path(a.source).read_text()))
    print("TASK183_EXACT_SIGNER_RECOVERY_GATE_STAGED=TRUE")
    print("LIVE_SIGNER_CHANGED=FALSE")

if __name__=="__main__":main()
