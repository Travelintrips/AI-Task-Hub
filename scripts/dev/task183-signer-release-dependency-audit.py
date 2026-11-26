#!/usr/bin/env python3
"""Task183 DEV approval signer release-dependency audit, read-only.

Check why the existing Issue159 approval signer cannot be safely activated
for Task183 until the trust chain and independent issuer reader are ready.
Never starts units, loads encrypted private key or changes DB.
"""
import os,stat,subprocess,sqlite3,json
from pathlib import Path

DB=Path('/opt/ai-coding-standalone-dev/tasks.db')
SERVICE='gpt02-issue159-operational-signer@approval.service'
ISSUER='gpt02-issue159-issuer-reader.service'
VERIFIER='gpt02-issue159-verifier.service'
APPROVAL='gpt02-issue159-approval-reader.service'

def _read_service(name,field):
    p=subprocess.run(['systemctl','show',name,'-p',field,'--value'],
       capture_output=True,text=True,timeout=8)
    if p.returncode!=0:raise RuntimeError('SYSTEMD_READ_UNAVAILABLE')
    return p.stdout.strip()
def readiness():
    if os.geteuid()!=0:raise ValueError('ROOT_READ_ONLY_AUDIT_REQUIRED')
    stat_db=os.lstat(DB)
    if (not stat.S_ISREG(stat_db.st_mode) or stat.S_ISLNK(stat_db.st_mode)
        or stat_db.st_uid!=0 or stat.S_IMODE(stat_db.st_mode)!=0o600):
        raise ValueError('ROOT_APPROVAL_DB_CUSTODY_INVALID')
    c=sqlite3.connect('file:'+str(DB)+'?mode=ro',uri=True,timeout=3)
    try:
        c.execute('PRAGMA query_only=ON')
        counts={}
        for t in ('gpt02_task183_owner_recovery_decisions',
                  'gpt02_task183_owner_recovery_outbox'):
            counts[t]=c.execute('SELECT COUNT(*) FROM '+t).fetchone()[0]
    finally:c.close()
    service_active=_read_service(SERVICE,'ActiveState')=='active'
    issuer_active=_read_service(ISSUER,'ActiveState')=='active'
    verifier_active=_read_service(VERIFIER,'ActiveState')=='active'
    approval_active=_read_service(APPROVAL,'ActiveState')=='active'
    requires=_read_service(SERVICE,'Requires')
    conditions=_read_service(SERVICE,'Conditions')
    prereq=ISSUER in requires
    issuer_socket=Path('/run/gpt02-issuer-reader/reader.sock').is_socket()
    if any(counts.values()):
        decision='NO_GO_REVIEW_NEW_OWNER_APPROVAL'
    elif service_active:
        decision='NO_GO_APPROVAL_SIGNER_ACTIVE_WITHOUT_DECISION'
    elif not approval_active or not verifier_active:
        decision='NO_GO_INDEPENDENT_READERS_UNAVAILABLE'
    elif prereq and (not issuer_active or not issuer_socket):
        decision='NO_GO_SIGNER_START_DEPENDS_ON_INACTIVE_ISSUER_READER'
    else:
        decision='NO_GO_REAL_OWNER_SIGNATURE_MISSING'
    return {'taskId':183,'companyId':'default','status':decision,
      'approvalDecisionCount':counts['gpt02_task183_owner_recovery_decisions'],
      'approvalOutboxCount':counts['gpt02_task183_owner_recovery_outbox'],
      'operationalSignerActive':service_active,
      'approvalReaderActive':approval_active,
      'independentVerifierActive':verifier_active,
      'issuerReaderActive':issuer_active,
      'issuerReaderSocketPresent':issuer_socket,
      'signerRequiresIssuerReader':prereq,
      'ownerSignatureCreated':False,'issuerAuthorized':False,
      'dispatchPermitted':False,'readOnly':True}
if __name__=='__main__':
    try:print(json.dumps(readiness(),indent=2))
    except Exception as e:
        print(json.dumps({'taskId':183,'status':'NO_GO_DEPENDENCY_AUDIT_UNAVAILABLE',
           'errorType':type(e).__name__,'readOnly':True,
           'issuerAuthorized':False,'dispatchPermitted':False}))
        raise SystemExit(3)
