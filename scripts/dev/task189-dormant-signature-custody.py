#!/usr/bin/env python3
"""Task189 durable receipt custody — dormant DEV only.

Creates a root-owned empty one-use signer outbox in the existing Task189
recovery directory. NO signer call, no approval, no issuer lease or dispatch.
The only supported operational command is --install-dormant or --audit.
A separate, reviewed supervisor would need to implement the two-phase
RESERVED->COMPLETED transition before any real Owner approval is accepted.
"""
import argparse,os,sqlite3,stat,sys
from pathlib import Path

STORE=Path('/var/lib/cst-dev-task189-recovery/signature-custody.sqlite3')
ROOT=Path('/var/lib/cst-dev-task189-recovery')
DDL="""
CREATE TABLE IF NOT EXISTS signature_receipts (
  approval_digest TEXT PRIMARY KEY CHECK(length(approval_digest)=64),
  request_id TEXT NOT NULL UNIQUE CHECK(length(request_id)=36),
  evidence_sha256 TEXT NOT NULL CHECK(length(evidence_sha256)=64),
  state TEXT NOT NULL CHECK(state IN ('RESERVED','COMPLETED')),
  reserved_at_ms INTEGER NOT NULL,
  signed_at_ms INTEGER,
  signature_base64url TEXT,
  signature_sha256 TEXT,
  issuer_authorized INTEGER NOT NULL DEFAULT 0 CHECK(issuer_authorized=0),
  dispatch_permitted INTEGER NOT NULL DEFAULT 0 CHECK(dispatch_permitted=0),
  CHECK ((state='RESERVED' AND signed_at_ms IS NULL AND signature_base64url IS NULL
          AND signature_sha256 IS NULL)
         OR (state='COMPLETED' AND signed_at_ms IS NOT NULL
          AND signature_base64url IS NOT NULL AND signature_sha256 IS NOT NULL))
);
CREATE TRIGGER IF NOT EXISTS signature_receipt_no_delete
 BEFORE DELETE ON signature_receipts
 BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SIGNER_RECEIPT'); END;
CREATE TRIGGER IF NOT EXISTS signature_receipt_no_bad_update
 BEFORE UPDATE ON signature_receipts
 WHEN NOT (
   OLD.state='RESERVED' AND NEW.state='COMPLETED'
   AND OLD.approval_digest=NEW.approval_digest
   AND OLD.request_id=NEW.request_id
   AND OLD.evidence_sha256=NEW.evidence_sha256
   AND OLD.reserved_at_ms=NEW.reserved_at_ms
   AND NEW.signed_at_ms>=OLD.reserved_at_ms
   AND NEW.issuer_authorized=0 AND NEW.dispatch_permitted=0)
 BEGIN SELECT RAISE(ABORT,'INVALID_SIGNER_RECEIPT_TRANSITION'); END;
"""

def _guard(p,operational):
    p=Path(p)
    if operational:
        if os.geteuid()!=0 or p!=STORE:
            raise ValueError('ROOT_EXACT_DEV_CUSTODY_REQUIRED')
        d=ROOT
        st=os.lstat(d)
        if not stat.S_ISDIR(st.st_mode) or stat.S_ISLNK(st.st_mode) or st.st_uid!=0 or stat.S_IMODE(st.st_mode)!=0o700:
            raise ValueError('RECOVERY_DIRECTORY_CUSTODY_DRIFT')
    return p

def install(*,path=STORE,operational=True):
    p=_guard(path,operational)
    if p.exists() or p.is_symlink():
        st=os.lstat(p)
        if not stat.S_ISREG(st.st_mode) or stat.S_ISLNK(st.st_mode):
            raise ValueError('CUSTODY_STORE_NOT_REGULAR')
        if operational and (st.st_uid!=0 or st.st_gid!=0 or stat.S_IMODE(st.st_mode)!=0o600):
            raise ValueError('CUSTODY_STORE_NOT_ROOT_0600')
    elif operational:
        fd=os.open(str(p),os.O_RDWR|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        os.close(fd)
    db=sqlite3.connect(str(p),timeout=4,isolation_level=None)
    try:
        db.execute('PRAGMA busy_timeout=4000')
        db.execute('PRAGMA synchronous=FULL')
        db.execute('PRAGMA journal_mode=DELETE')
        existing=db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='signature_receipts'").fetchone()
        if existing is None:
            db.executescript('BEGIN IMMEDIATE;'+DDL+'COMMIT;')
        if audit(path=p,operational=operational)['total']!=0:
            raise ValueError('LIVE_SIGNATURE_ALREADY_EXISTS_MANUAL_REVIEW')
        return {'installed':True,'total':0,'signerEnabled':False,
                'issuerAuthorized':False,'dispatchPermitted':False}
    finally:db.close()

def audit(*,path=STORE,operational=True):
    p=_guard(path,operational)
    if not p.exists():return {'installed':False,'total':0,'unresolved':0,'completed':0,
                              'issuerAuthorized':False,'dispatchPermitted':False}
    st=os.lstat(p)
    if not stat.S_ISREG(st.st_mode) or stat.S_ISLNK(st.st_mode):
        raise ValueError('SIGNATURE_CUSTODY_SOURCE_INVALID')
    if operational and (st.st_uid!=0 or st.st_gid!=0 or stat.S_IMODE(st.st_mode)!=0o600):
        raise ValueError('SIGNATURE_CUSTODY_ROOT_0600_REQUIRED')
    c=sqlite3.connect('file:'+str(p)+'?mode=ro',uri=True,timeout=4)
    try:
        c.execute('PRAGMA query_only=ON')
        names={r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='trigger'").fetchall()}
        required={'signature_receipt_no_delete','signature_receipt_no_bad_update'}
        if not required.issubset(names):raise ValueError('IMMUTABLE_RECEIPT_TRIGGERS_MISSING')
        counts=c.execute("""SELECT COUNT(*),
          sum(case when state='RESERVED' then 1 else 0 end),
          sum(case when state='COMPLETED' then 1 else 0 end),
          sum(case when issuer_authorized!=0 or dispatch_permitted!=0 then 1 else 0 end)
          FROM signature_receipts""").fetchone()
        if counts[3]:raise ValueError('SIGNATURE_CUSTODY_UNEXPECTED_AUTHORITY')
        return {'installed':True,'total':counts[0],'unresolved':counts[1] or 0,
                'completed':counts[2] or 0,'issuerAuthorized':False,
                'dispatchPermitted':False,'readOnly':True}
    finally:c.close()

def main():
    a=argparse.ArgumentParser()
    options=a.add_mutually_exclusive_group(required=True)
    options.add_argument('--install-dormant',action='store_true')
    options.add_argument('--audit',action='store_true')
    args=a.parse_args()
    result=install() if args.install_dormant else audit()
    print('TASK189_DORMANT_SIGNER_CUSTODY='+str(result))
if __name__=='__main__':
    try:main()
    except Exception as exc:
        print('TASK189_CUSTODY_NO_GO='+type(exc).__name__)
        sys.exit(3)
