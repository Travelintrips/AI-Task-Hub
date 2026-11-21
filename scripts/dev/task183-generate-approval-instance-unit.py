#!/usr/bin/env python3
"""Generate exact-instance approval signer unit from trusted original template.

Do not touch the generic @.service template. Removes only the issuer-reader
dependency and issuer socket condition for @approval. All credential custody,
sandbox and ExecStart directives remain byte-for-byte identical.
"""
from pathlib import Path
import difflib,sys
BASELINE='gpt02-existing-operational-signer-systemd-baseline.service.txt'
INSTANCE='gpt02-issue159-operational-signer@approval.service'
ISSUER='gpt02-issue159-issuer-reader.service'
SOCKET='ConditionPathExists=/run/gpt02-issuer-reader/reader.sock'

def generate(original:str):
    lines=original.splitlines(keepends=True)
    output=[]
    changed=[]
    for line in lines:
        if line.startswith('After=') or line.startswith('Requires='):
            parts=line.rstrip('\n').split()
            if ISSUER in parts:
                parts.remove(ISSUER)
                new=' '.join(parts)+'\n'
                changed.append((line,new))
                output.append(new)
                continue
        if line.rstrip('\n')==SOCKET:
            changed.append((line,''))
            continue
        output.append(line)
    if len(changed)!=3:
        raise ValueError('INSTANCE_TEMPLATE_SCOPE_DRIFT')
    return ''.join(output),changed

def check(original,candidate):
    generated,changes=generate(original)
    if candidate!=generated:raise ValueError('UNTRUSTED_INSTANCE_DIFFERENCES')
    if INSTANCE not in ['gpt02-issue159-operational-signer@approval.service']:
        raise ValueError('BAD_INSTANCE_SCOPE')
    for protected in ('DynamicUser=yes','LoadCredentialEncrypted=private-key.pkcs8:',
      'ProtectSystem=strict','PrivateNetwork=yes','NoNewPrivileges=yes',
      'RestrictAddressFamilies=AF_UNIX','ExecStart=/usr/bin/python3',
      'SupplementaryGroups=gpt02-issue159-signers',
      'ConditionPathExists=/run/gpt02-reader/reader.sock',
      'ConditionPathExists=/run/gpt02-approval-reader/approval.sock'):
        if protected not in candidate:raise ValueError('PROTECTED_SETTING_CHANGED')
    return len(changes)

if __name__=='__main__':
    if len(sys.argv)!=3:raise SystemExit('BASELINE_AND_DEST_REQUIRED')
    p=Path(sys.argv[1]);dest=Path(sys.argv[2])
    if dest.exists():raise SystemExit('INSTANCE_TARGET_EXISTS')
    generated,changes=generate(p.read_text())
    check(p.read_text(),generated)
    dest.write_text(generated)
    print('SCOPED_INSTANCE_UNIT_CANDIDATE_READY',len(changes))
