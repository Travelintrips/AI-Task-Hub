#!/usr/bin/env python3
"""Static review of Task183 approval-only signer systemd override.

No systemctl mutation; compares against existing production-reviewed
template source and tests that ONLY @approval loses issuer-reader prerequisite.
"""
from configparser import ConfigParser
from pathlib import Path
import tempfile,subprocess

HERE=Path(__file__).parent
candidate=HERE/'task183-approval-only-systemd-override.candidate.conf'
unit=HERE/'gpt02-existing-operational-signer-systemd-baseline.service.txt'
text=Path(unit).read_text()
source=candidate.read_text()
count=0
def check(name,yes):
 global count
 count+=1
 if not yes:raise AssertionError(name)
 print('PASS:'+name)
check('BASE_UNIT_REQUIRES_ISSUER_READER',
      'Requires=gpt02-issue159-reader.service gpt02-issue159-issuer-reader.service gpt02-issue159-approval-reader.service' in text)
check('BASE_UNIT_CONDITIONS_ISSUER_SOCKET',
      'ConditionPathExists=/run/gpt02-issuer-reader/reader.sock' in text)
sections=source.split('[Unit]',1)
check('ONE_UNIT_SECTION_ONLY',len(sections)==2 and '[Service]' not in source and '[Install]' not in source)
lines=[l.strip() for l in sections[1].splitlines() if l.strip() and not l.strip().startswith('#')]
def values(key):return [l.partition('=')[2] for l in lines if l.startswith(key+'=')]
check('RESET_BASE_REQUIRES',values('Requires')[0]=='')
check('RESET_BASE_AFTER',values('After')[0]=='')
check('RESET_BASE_CONDITIONS',values('ConditionPathExists')[0]=='')
expected='gpt02-issue159-reader.service gpt02-issue159-approval-reader.service'
check('ONLY_APPROVAL_DEPENDENCIES',values('Requires')[1]==expected)
check('APPROVAL_ORDERING_PRESERVED',values('After')[1]==expected)
check('APPROVAL_READERS_REQUIRED',
      '/run/gpt02-reader/reader.sock' in values('ConditionPathExists') and
      '/run/gpt02-approval-reader/approval.sock' in values('ConditionPathExists'))
check('APPROVAL_SIGNER_CREDENTIAL_STILL_REQUIRED',
      '/etc/credstore.encrypted/gpt02-issue159-approval-private-key.pkcs8' in values('ConditionPathExists'))
check('PINNED_TRUST_STILL_REQUIRED',
      '/etc/gpt02-dev/trust-fingerprints.json' in values('ConditionPathExists'))
check('NEVER_REFERENCES_ISSUER_READER',
      'issuer-reader' not in '\n'.join(lines))
check('DOES_NOT_CHANGE_SIGNER_EXECSTART',
      'ExecStart' not in source and 'Environment=' not in source)
check('BASE_SIGNER_STILL_HAS_NO_NEW_UNIT',
      not (HERE/'gpt02-issue159-operational-signer@.service').exists())
print('RESULT',count,'PASS')
print('NO_SYSTEMD_UNIT_MODIFIED=TRUE')
