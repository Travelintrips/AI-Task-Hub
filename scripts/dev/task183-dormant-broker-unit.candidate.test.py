#!/usr/bin/env python3
"""Review the dormant Task183 systemd candidate without starting any service."""
from pathlib import Path
import ast
import configparser

HERE=Path(__file__).resolve().parent
UNIT=HERE/"task183-dormant-root-broker.candidate.service"
LAUNCHER=HERE/"task183-dormant-broker-launcher.py"
cfg=configparser.ConfigParser(interpolation=None,strict=True)
cfg.read(UNIT)
n=0
def verify(label,success):
 global n
 assert success,label
 n+=1
 print("PASS:"+label)
u=cfg["Unit"];s=cfg["Service"];i=cfg["Install"]
verify("MANUAL_START_REFUSED",u.get("RefuseManualStart")=="yes")
verify("MANUAL_STOP_REFUSED",u.get("RefuseManualStop")=="yes")
verify("MISSING_RELEASE_SENTINEL_BLOCKS",u.get("ConditionPathExists","").endswith("task183-broker-release.approved"))
# ConfigParser loses duplicate ConditionPathExists values; check all raw lines too.
raw=UNIT.read_text().splitlines()
conditions=[x.split("=",1)[1] for x in raw if x.startswith("ConditionPathExists=")]
verify("ALL_THREE_CONDITIONS",len(conditions)==3)
verify("NO_FAKE_SENTINEL_INSTALLER",not any("touch " in x or "mkdir " in x for x in raw))
verify("ROOT_BOUND",s.get("User")=="root" and s.get("Group")=="root")
verify("PRIVATE_NETWORK",s.get("PrivateNetwork")=="yes")
verify("READONLY_FILESYSTEM",s.get("ProtectSystem")=="strict")
verify("NO_CAPABILITIES",s.get("CapabilityBoundingSet")=="")
verify("NO_RESTART",s.get("Restart")=="no")
verify("SIGNER_UNMODIFIED",all("gpt02_issue159_operational_signer.py" not in x for x in raw))
verify("NO_ISSUER_DEPENDENCY",all("issuer" not in x.lower() for x in raw))
verify("LAUNCHER_REQUIRES_EXACT_FILE",s.get("ExecStart")=="/usr/bin/python3 /opt/ai-coding-standalone-dev/qa/task183-dormant-broker-launcher.py")
tree=ast.parse(LAUNCHER.read_text())
names={x.id for x in ast.walk(tree) if isinstance(x,ast.Name)}
verify("NO_UNIX_SERVER_IN_LAUNCHER",not ({"socket","socketserver"}&names))
verify("FAIL_CLOSED_MANDATORY", "TASK183_NO_GO_OPERATIONAL_BROKER_NOT_IMPLEMENTED" in LAUNCHER.read_text())
print(f"RESULT={n}/{n} PASS")
print("NO_SERVICE_STARTED=TRUE")
