#!/usr/bin/env python3
"""Install dormant Task183 OWNER recovery decision/outbox schema only in DEV.

NO approval issuance, signing, signer activation or worker dispatch. Fail
closed on custody drift and existing unknown tables. Transactional DDL and
rollback-safe backup. No API route or caller-controlled payload.
"""
from pathlib import Path
import os,sqlite3,stat,sys,time

DB=Path('/opt/ai-coding-standalone-dev/tasks.db')
BACKUP_DIR=Path('/opt/ai-coding-standalone-dev/qa/backup')
DDL="""
CREATE TABLE gpt02_task183_owner_recovery_decisions(
 id TEXT PRIMARY KEY,
 task_id INTEGER NOT NULL CHECK(task_id=183),
 request_id TEXT NOT NULL UNIQUE CHECK(length(request_id)=36),
 company_id TEXT NOT NULL CHECK(company_id='default'),
 evidence_sha256 TEXT NOT NULL CHECK(length(evidence_sha256)=64),
 claims_sha256 TEXT NOT NULL UNIQUE CHECK(length(claims_sha256)=64),
 owner_subject TEXT NOT NULL CHECK(substr(owner_subject,1,6)='owner:'),
 nonce TEXT NOT NULL UNIQUE CHECK(length(nonce)>=32),
 auth_user_id TEXT NOT NULL,
 role_at_decision TEXT NOT NULL CHECK(role_at_decision='super_admin'),
 auth_method TEXT NOT NULL CHECK(auth_method='supabase_admin_session'),
 decision TEXT NOT NULL CHECK(decision='APPROVE_RECOVERY_ATTEMPT2_ONLY'),
 recorded_at_ms INTEGER NOT NULL,
 expires_at_ms INTEGER NOT NULL,
 CHECK(expires_at_ms>recorded_at_ms AND expires_at_ms-recorded_at_ms<=300000)
);
CREATE TABLE gpt02_task183_owner_recovery_outbox(
 id TEXT PRIMARY KEY,
 decision_id TEXT NOT NULL UNIQUE REFERENCES gpt02_task183_owner_recovery_decisions(id),
 task_id INTEGER NOT NULL CHECK(task_id=183),
 request_id TEXT NOT NULL UNIQUE CHECK(length(request_id)=36),
 company_id TEXT NOT NULL CHECK(company_id='default'),
 evidence_sha256 TEXT NOT NULL,
 claims_sha256 TEXT NOT NULL UNIQUE,
 owner_subject TEXT NOT NULL,
 nonce TEXT NOT NULL UNIQUE,
 auth_user_id TEXT NOT NULL,
 role_at_decision TEXT NOT NULL,
 auth_method TEXT NOT NULL,
 recorded_at_ms INTEGER NOT NULL,
 expires_at_ms INTEGER NOT NULL
);
CREATE TRIGGER task183_decision_no_update BEFORE UPDATE ON gpt02_task183_owner_recovery_decisions
 BEGIN SELECT RAISE(ABORT,'IMMUTABLE_OWNER_DECISION'); END;
CREATE TRIGGER task183_decision_no_delete BEFORE DELETE ON gpt02_task183_owner_recovery_decisions
 BEGIN SELECT RAISE(ABORT,'IMMUTABLE_OWNER_DECISION'); END;
CREATE TRIGGER task183_outbox_no_update BEFORE UPDATE ON gpt02_task183_owner_recovery_outbox
 BEGIN SELECT RAISE(ABORT,'IMMUTABLE_OWNER_OUTBOX'); END;
CREATE TRIGGER task183_outbox_no_delete BEFORE DELETE ON gpt02_task183_owner_recovery_outbox
 BEGIN SELECT RAISE(ABORT,'IMMUTABLE_OWNER_OUTBOX'); END;
"""
OBJECTS=('gpt02_task183_owner_recovery_decisions','gpt02_task183_owner_recovery_outbox',
'task183_decision_no_update','task183_decision_no_delete',
'task183_outbox_no_update','task183_outbox_no_delete')
def verify_file(p,operational):
 st=os.lstat(p)
 if not stat.S_ISREG(st.st_mode) or stat.S_ISLNK(st.st_mode):
  raise ValueError('NOT_A_SECURE_SQLITE_FILE')
 if operational and (Path(p)!=DB or st.st_uid!=0 or st.st_gid!=0 or stat.S_IMODE(st.st_mode)!=0o600):
  raise ValueError('DEV_DB_CUSTODY_OR_PATH_DRIFT')
def install(path,*,operational=False,backup=False):
 path=Path(path)
 if path==DB and not operational:raise ValueError('LIVE_DB_REQUIRES_EXPLICIT_OPERATIONAL_MODE')
 verify_file(path,operational)
 if operational and not backup:raise ValueError('BACKUP_REQUIRED')
 con=sqlite3.connect(str(path),timeout=3,isolation_level=None)
 try:
  con.execute('PRAGMA busy_timeout=3000')
  present=con.execute("SELECT name FROM sqlite_master WHERE name IN ("+
    ','.join('?' for _ in OBJECTS)+")",OBJECTS).fetchall()
  if len(present)==len(OBJECTS):
   for table in OBJECTS[:2]:
    if con.execute('SELECT count(*) FROM '+table).fetchone()[0]!=0:
     raise ValueError('RECOVERY_APPROVAL_HISTORY_EXISTS')
   return 'ALREADY_INSTALLED_EMPTY'
  if present:raise ValueError('PARTIAL_RECOVERY_SCHEMA_DRIFT')
  if operational:
   BACKUP_DIR.mkdir(mode=0o700,exist_ok=True)
   bstat=BACKUP_DIR.stat()
   if bstat.st_uid!=0 or stat.S_IMODE(bstat.st_mode)!=0o700:
    raise ValueError('BACKUP_DIRECTORY_CUSTODY_INVALID')
   dest=BACKUP_DIR/('tasks-before-task183-dormant-schema-'+time.strftime('%Y%m%d-%H%M%S',time.gmtime())+'.sqlite')
   if dest.exists():raise ValueError('BACKUP_ALREADY_EXISTS')
   b=sqlite3.connect(str(dest))
   try:
    con.backup(b)
   finally:b.close()
   os.chmod(dest,0o600)
   print('BACKUP_CREATED='+str(dest),flush=True)
  # executescript wraps statement execution; these DDL statements do not
  # mutate any existing Issue159 table or row.
  con.executescript('BEGIN IMMEDIATE;'+DDL+'COMMIT;')
  names={r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE name IN ("+
    ','.join('?' for _ in OBJECTS)+")",OBJECTS)}
  if names!=set(OBJECTS):raise RuntimeError('DORMANT_SCHEMA_INSTALL_MISMATCH')
  for table in OBJECTS[:2]:
   if con.execute('SELECT count(*) FROM '+table).fetchone()[0]!=0:
    raise RuntimeError('UNAUTHORIZED_APPROVAL_ROW_CREATED')
  return 'DORMANT_SCHEMA_INSTALLED_NO_APPROVAL'
 finally:con.close()

if __name__=='__main__':
 if sys.argv[1:]!=['--install-dev'] or os.geteuid()!=0:
  print('USE_ROOT_EXACT_DEV_INSTALL_ONLY');sys.exit(3)
 print(install(DB,operational=True,backup=True))
