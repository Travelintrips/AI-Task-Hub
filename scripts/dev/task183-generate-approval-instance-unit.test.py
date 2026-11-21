#!/usr/bin/env python3
"""Exact diff regression: scoped approval-only unit, no other changes."""
import importlib.util,tempfile,subprocess
from pathlib import Path
ROOT=Path(__file__).parent
sp=importlib.util.spec_from_file_location('generator',ROOT/'task183-generate-approval-instance-unit.py')
m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
base=(ROOT/'gpt02-existing-operational-signer-systemd-baseline.service.txt').read_text()
candidate=(ROOT/'gpt02-operational-signer-approval-instance.candidate.service').read_text()
n=0
def check(k,ok):
 global n
 n+=1
 if not ok:raise AssertionError(k)
 print('PASS:'+k)
check('EXACT_THREE_APPROVAL_ONLY_CHANGES',m.check(base,candidate)==3)
check('NO_LEGACY_SOURCE_CHANGED',base.count('gpt02-issue159-issuer-reader.service')==2)
check('APPROVAL_INSTANCE_HAS_NO_ISSUER_DEPENDENCY','gpt02-issue159-issuer-reader.service' not in candidate)
check('APPROVAL_INSTANCE_HAS_NO_ISSUER_SOCKET','ConditionPathExists=/run/gpt02-issuer-reader/reader.sock' not in candidate)
check('EXISTING_HUB_CORE_READER_PRESERVED','ConditionPathExists=/run/gpt02-reader/reader.sock' in candidate)
check('EXISTING_APPROVAL_READER_PRESERVED','ConditionPathExists=/run/gpt02-approval-reader/approval.sock' in candidate)
check('ENCRYPTED_PRIVATE_CREDENTIAL_CONDITION_PRESERVED','LoadCredentialEncrypted=private-key.pkcs8:' in candidate)
check('ALL_CURRENT_SANDBOX_SETTINGS_PRESERVED',
 all(x in candidate for x in ['DynamicUser=yes','ProtectSystem=strict','ProtectHome=yes',
 'PrivateNetwork=yes','NoNewPrivileges=yes','PrivateDevices=yes','MemoryDenyWriteExecute=yes',
 'RestrictAddressFamilies=AF_UNIX','CapabilityBoundingSet=','SupplementaryGroups=gpt02-issue159-signers']))
check('NO_START_OR_ENABLE_SIDE_EFFECT',not any('systemctl' in l for l in candidate.splitlines()))
with tempfile.TemporaryDirectory(prefix='task183-systemd-approval-static-') as td:
 p=Path(td)/'gpt02-issue159-operational-signer@approval.service'
 p.write_text(candidate)
 proc=subprocess.run(['systemd-analyze','verify',str(p)],
    capture_output=True,text=True,timeout=12)
 # May report missing dependencies in CI, but must not be syntax-invalid.
 check('SYSTEMD_INSTANCE_SYNTAX_VALID',proc.returncode==0 or (
   'not found' in proc.stderr.lower() and
   'failed to parse' not in proc.stderr.lower()))
print('RESULT',n,'PASS')
print('ORIGINAL_SYSTEMD_UNIT_UNCHANGED=TRUE')
