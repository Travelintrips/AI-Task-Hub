#!/usr/bin/env python3
import importlib.util,sqlite3,tempfile
from pathlib import Path
p=Path(__file__).with_name('task183-install-dormant-owner-approval-schema.py')
spec=importlib.util.spec_from_file_location('dormant_schema',p)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
count=0
def passed(name,ok):
 global count
 count+=1
 if not ok:raise AssertionError(name)
 print('PASS:'+name)
with tempfile.TemporaryDirectory(prefix='task183-dormant-schema-test-') as tmp:
 db=Path(tmp)/'synthetic.sqlite'
 c=sqlite3.connect(db)
 c.executescript("""CREATE TABLE gpt02_issue159_approval_intents (
    id text PRIMARY KEY, task_id integer, marker text);
  INSERT INTO gpt02_issue159_approval_intents VALUES('historical-id',159,'KEEP');
  CREATE TABLE gpt02_issue159_owner_approval_outbox(id text PRIMARY KEY);
  INSERT INTO gpt02_issue159_owner_approval_outbox VALUES('old');
  """);c.close()
 passed('INSTALL_EMPTY_SCHEMA',m.install(db)=='DORMANT_SCHEMA_INSTALLED_NO_APPROVAL')
 c=sqlite3.connect(db)
 passed('PRESERVE_ISSUE159_APPROVAL_HISTORY',
  c.execute('select * from gpt02_issue159_approval_intents').fetchall()==[('historical-id',159,'KEEP')])
 passed('PRESERVE_ISSUE159_OUTBOX',
  c.execute('select * from gpt02_issue159_owner_approval_outbox').fetchall()==[('old',)])
 passed('DORMANT_TABLES_EMPTY',
  c.execute('select count(*) from gpt02_task183_owner_recovery_decisions').fetchone()[0]==0 and
  c.execute('select count(*) from gpt02_task183_owner_recovery_outbox').fetchone()[0]==0)
 passed('IDEMPOTENCE',m.install(db)=='ALREADY_INSTALLED_EMPTY')
 passed('NO_PRODUCTION_PATH_ALLOWED',not db==m.DB)
 try:m.install(db,operational=True,backup=True)
 except ValueError:passed('OPERATIONAL_WRONG_PATH_DENIED',True)
 else:passed('OPERATIONAL_WRONG_PATH_DENIED',False)
 try:m.install(db,operational=True,backup=False)
 except ValueError:passed('OPERATIONAL_BACKUP_REQUIRED',True)
 else:passed('OPERATIONAL_BACKUP_REQUIRED',False)
 c.execute("INSERT INTO gpt02_task183_owner_recovery_decisions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
 ('fixture',183,'a'*36,'default','b'*64,'c'*64,
 'owner:fixture','d'*48,'synthetic-user','super_admin','supabase_admin_session',
 'APPROVE_RECOVERY_ATTEMPT2_ONLY',1000,100000))
 c.commit()
 try:c.execute("UPDATE gpt02_task183_owner_recovery_decisions SET decision='APPROVE'")
 except sqlite3.DatabaseError:c.rollback();passed('IMMUTABLE_DECISION_UPDATE_DENIED',True)
 else:passed('IMMUTABLE_DECISION_UPDATE_DENIED',False)
 try:c.execute("DELETE FROM gpt02_task183_owner_recovery_decisions")
 except sqlite3.DatabaseError:c.rollback();passed('IMMUTABLE_DECISION_DELETE_DENIED',True)
 else:passed('IMMUTABLE_DECISION_DELETE_DENIED',False)
 try:m.install(db)
 except ValueError:passed('NONEMPTY_APPROVAL_TABLE_REINSTALL_DENIED',True)
 else:passed('NONEMPTY_APPROVAL_TABLE_REINSTALL_DENIED',False)
 c.close()
print('RESULT',count,'PASS')
print('REAL_APPROVAL_OR_COMMAND_CREATED=FALSE')
