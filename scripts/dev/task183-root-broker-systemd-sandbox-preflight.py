#!/usr/bin/env python3
"""Task183 root broker *transient systemd sandbox* preflight; no broker service activation.

Runs under a separate short-lived transient service, with the same relevant
sandbox restrictions as the disabled broker. Uses a temporary token inside
/run, substitutes its path only in process memory, loads actual trusted
modules, audits live custody read-only and never binds a broker socket.
"""
import importlib.util
import os
from pathlib import Path
import tempfile

SOURCE=Path("/opt/ai-coding-standalone-dev/qa/task183-root-broker-operational.candidate.py")
LIVE_SENTINEL=Path("/etc/gpt02-dev/task183-broker-release.approved")
LIVE_SOCKET=Path("/run/cst-task183-root-broker/broker.sock")
def main():
    if os.geteuid()!=0:raise RuntimeError("ROOT_REQUIRED")
    if LIVE_SENTINEL.exists() or LIVE_SOCKET.exists():
        raise RuntimeError("LIVE_RELEASE_OR_SOCKET_PRESENT")
    spec=importlib.util.spec_from_file_location("task183_root_preflight",SOURCE)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with tempfile.TemporaryDirectory(prefix="task183-root-sandbox-proof-",dir="/run") as tmp:
        token=Path(tmp)/"synthetic-token"
        token.write_text("CST_DEV_TASK183_BROKER_RELEASE_V1\n")
        os.chmod(token,0o400)
        module.SENTINEL=token
        modules,owner,verify=module.preflight()
        if set(modules)!={"bridge","policy","owner","verify","custody"}:
            raise RuntimeError("MODULE_CHAIN_MISMATCH")
        if not callable(owner) or not callable(verify):
            raise RuntimeError("TRUSTED_READER_OR_VERIFIER_MISSING")
        before=modules["custody"].audit(operational=True)
        if before["issuerAuthorized"] or before["dispatchPermitted"]:
            raise RuntimeError("UNEXPECTED_AUTHORITY")
        if before["total"]!=0:raise RuntimeError("LIVE_CUSTODY_NOT_EMPTY")
        # The real decision reader must fail closed for a synthetic Owner
        # without reading a private key or changing an approval record.
        if owner("recovery-approval","a"*64,"6bcd8419254dc21c0b149eb09e68a7b6da66",
                 "89950d3b8ac91aac612810325c6a219cb898a6fa41b234a477f0dbe32d85eb7b",
                 {"requestId":"6bcd8419254dc21c0b149eb09e68a7b6da66",
                  "evidenceSha256":"89950d3b8ac91aac612810325c6a219cb898a6fa41b234a477f0dbe32d85eb7b"}) is not False:
            raise RuntimeError("SYNTHETIC_OWNER_ACCEPTED")
        after=modules["custody"].audit(operational=True)
        if before!=after:raise RuntimeError("LIVE_CUSTODY_MUTATED")
    if LIVE_SENTINEL.exists() or LIVE_SOCKET.exists():
        raise RuntimeError("OPERATIONAL_RELEASE_OR_SOCKET_CREATED")
    print("TASK183_TRANSIENT_SYSTEMD_SANDBOX_PREFLIGHT=PASS")
    print("ROOT_MODULES_AND_REAL_TRUST=PASS")
    print("SYNTHETIC_OWNER_NO_GO=PASS")
    print("REAL_RECEIPT_UNCHANGED=TRUE")
    print("OPERATIONAL_SERVICE_STARTED=FALSE")
    print("PROD_CHANGED=FALSE")
if __name__=="__main__":
    main()
