#!/usr/bin/env python3
"""Task183 nested-module custody fails closed before broker socket creation."""
import importlib.util, os, stat, tempfile
from pathlib import Path

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("broker",HERE/"task183-root-broker-operational.candidate.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
count=0
def ok(label,value):
 global count
 assert value,label
 count+=1
 print("PASS:"+label)
def denied(label,run):
 try:run()
 except (RuntimeError,OSError):ok(label,True)
 else:ok(label,False)
if os.geteuid()!=0:raise SystemExit("ROOT_ONLY_ISOLATED_CUSTODY_TEST")
with tempfile.TemporaryDirectory(prefix="task183-indirect-custody-") as td:
 root=Path(td)
 for filename in m.INDIRECT_MODULES:
  p=root/filename
  p.write_text("# synthetic only\n")
  os.chown(p,0,0);os.chmod(p,0o400)
 ok("ALL_SYNTHETIC_ROOT_ONLY_IMPORTS_ACCEPTED",m.verify_indirect_module_custody(root))
 first=root/m.INDIRECT_MODULES[0]
 os.chmod(first,0o644)
 denied("GROUP_OR_WORLD_READABLE_DENIED",lambda:m.verify_indirect_module_custody(root))
 os.chmod(first,0o400)
 first.unlink()
 first.symlink_to(root/m.INDIRECT_MODULES[1])
 denied("SYMLINK_DENIED",lambda:m.verify_indirect_module_custody(root))
 first.unlink();first.write_text("# synthetic\n");os.chmod(first,0o400)
 for name in m.INDIRECT_MODULES[1:]:
  os.chmod(root/name,0o440)
  denied("UNTRUSTED_MODE_"+name,lambda:m.verify_indirect_module_custody(root))
  os.chmod(root/name,0o400)
 ok("RESTORED_CUSTODY_ACCEPTED",m.verify_indirect_module_custody(root))
 first.unlink()
 denied("MISSING_MODULE_DENIED",lambda:m.verify_indirect_module_custody(root))
print("RESULT="+str(count)+"/"+str(count)+" PASS")
print("ONLY_TEMP_FILES_MODIFIED=TRUE")
