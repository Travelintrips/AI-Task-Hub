#!/usr/bin/env python3
"""Static release-gate safety regression for Task183 operational broker.

No socket, authorization, service start, signing, database writes or secrets.
"""
import ast
import configparser
from pathlib import Path

HERE=Path(__file__).resolve().parent
UNIT=HERE/"task183-root-broker-operational.candidate.service"
SOURCE=HERE/"task183-root-broker-operational.candidate.py"
n=0
def check(label,yes):
    global n
    assert yes,label
    n+=1;print("PASS:"+label)
c=configparser.ConfigParser(interpolation=None,strict=False)
c.read(UNIT)
raw=UNIT.read_text()
src=SOURCE.read_text()
ast.parse(src)
service=c["Service"]
unit=c["Unit"]
check("ROOT_USER",service.get("User")=="root" and service.get("Group")=="gpt02-issue159-signers")
check("SERVICE_DISABLED_BY_RELEASE_SENTINEL", "ConditionPathExists=/etc/gpt02-dev/task183-broker-release.approved" in raw)
check("MANUAL_START_REFUSED",unit.get("RefuseManualStart")=="yes")
check("MANUAL_STOP_REFUSED",unit.get("RefuseManualStop")=="yes")
check("RESTART_DISABLED",service.get("Restart")=="no")
check("PRIVATE_NETWORK",service.get("PrivateNetwork")=="yes")
check("READONLY_SYSTEM",service.get("ProtectSystem")=="strict")
check("NO_CAP_CHOWN_SOCKET_GROUP_FROM_SYSTEMD", "os.chown(" not in src and "socket_stat.st_gid!=gid" in src and service.get("UMask")=="0007")
check("SCOPED_WRITER_PATH",service.get("ReadWritePaths")=="/var/lib/cst-dev-task183-recovery")
check("RUNTIME_DIRECTORY",service.get("RuntimeDirectory")=="cst-task183-root-broker" and service.get("RuntimeDirectoryMode")=="0750")
check("NO_CAPABILITIES",service.get("CapabilityBoundingSet")=="" and service.get("AmbientCapabilities")=="")
check("NO_NEW_PRIVILEGES",service.get("NoNewPrivileges")=="yes")
check("AF_UNIX_ONLY",service.get("RestrictAddressFamilies")=="AF_UNIX")
check("EXACT_EXECSTART",service.get("ExecStart")=="/usr/bin/python3 /opt/ai-coding-standalone-dev/qa/task183-root-broker-operational.candidate.py")
check("SOURCE_PINS_RECEIPT_STORE",'DB=Path("/var/lib/cst-dev-task183-recovery/signature-custody.sqlite3")' in src)
check("SOURCE_PINS_RUNTIME_SOCKET",'SOCKET=SOCKET_DIR/"broker.sock"' in src)
check("SOURCE_REQUIRES_RELEASE_TOKEN",'CST_DEV_TASK183_BROKER_RELEASE_V1' in src)
check("SOURCE_REQUIRES_ROOT",'ROOT_BROKER_CUSTODY_REQUIRED' in src)
check("SOURCE_REQUIRES_IMMUTABLE_RECOVERY_AUDIT",'verify_custody_recovery(state)' in src and 'TASK183_CUSTODY_RECOVERY_COUNTS_INVALID' in src)
check("SOURCE_ENFORCES_PEER_POLICY",'server.peer_verifier=modules["policy"].authenticated_peer' in src)
check("SOURCE_READS_OWNER_INDEPENDENTLY",'make_recovery_authorizer(operational=True)' in src)
check("SOURCE_VERIFIES_PINNED_PUBLIC_KEY",'make_verifier(operational=True)' in src)
check("SOURCE_NEVER_LOADS_PRIVATE_SIGNING_KEY","private-key.pkcs8" not in src and "Ed25519PrivateKey" not in src)
check("SOURCE_LEAVES_ISSUER_DISPATCH_ABSENT","sign_issuer" not in src and "dispatch_command" not in src)
print(f"RESULT={n}/{n} PASS")
print("NO_OPERATIONAL_SERVICE_STARTED=TRUE")
