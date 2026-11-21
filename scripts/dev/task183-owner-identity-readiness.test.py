#!/usr/bin/env python3
"""Synthetic Owner identity links, no live app session or database writes."""
import importlib.util,sqlite3,tempfile,time
from pathlib import Path
p=Path(__file__).with_name('task183-owner-identity-readiness.py')
spec=importlib.util.spec_from_file_location('owner_gate_test',p)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
NOW=1800000000000
actor={'id':'google_synthetic_owner','role':'super_admin','companyId':None,
 'authSupabaseId':'11111111-1111-4111-8111-111111111111',
 'authSource':'supabase_google_identity','authVerifiedAt':NOW-10000,
 'email':'synthetic@example.invalid'}
count=0
def good(name,valid):
 global count
 count+=1
 if not valid:raise AssertionError(name)
 print('PASS '+name)
with tempfile.TemporaryDirectory(prefix='task183-owner-link-readonly-') as tmp:
 path=Path(tmp)/'links.sqlite'
 db=sqlite3.connect(path)
 db.executescript('''
 CREATE TABLE gpt02_issue159_admin_operator_links(
  auth_user_id text,hub_operator_id text,email text,enabled integer);
 CREATE TABLE admin_identities(user_id text,role text,enabled integer);
 ''')
 db.execute('INSERT INTO gpt02_issue159_admin_operator_links VALUES(?,?,?,?)',
  (actor['authSupabaseId'],actor['id'],actor['email'],1))
 db.execute('INSERT INTO admin_identities VALUES(?,?,?)',(actor['authSupabaseId'],'super_admin',1))
 db.commit()
 def check(x=actor):
  return m.eligible_owner(x,db_path=path,operational=False,now_ms=NOW)
 real=check()
 good('CORRECT_SIGNED_ACCOUNT_MAP',real['eligible'] is True and real['readOnly'] is True)
 good('NEVER_APPROVAL_OR_DISPATCH',real['approvalDecisionCreated'] is False and
   real['issuerAuthorized'] is False and real['cryptographicOwnerSignatureVerified'] is False and real['dispatchPermitted'] is False)
 for label,change in [
  ('FOREIGN_OWNER',{'id':'google_wrong'}),
  ('WRONG_COMPANY',{'companyId':'foreign'}),
  ('WRONG_SUPABASE_SUB',{'authSupabaseId':'22222222-2222-4222-8222-222222222222'}),
  ('WRONG_EMAIL',{'email':'unrelated@example.invalid'}),
  ('WRONG_ROLE',{'role':'admin'}),
  ('NO_GOOGLE',{'authSource':'manual'}),
  ('EXPIRED_GOOGLE_SESSION',{'authVerifiedAt':NOW-9*86400000})]:
  try:check({**actor,**change})
  except ValueError:good('DENY_'+label,True)
  else:good('DENY_'+label,False)
 db.execute('UPDATE admin_identities SET enabled=0');db.commit()
 try:check()
 except ValueError:good('DENY_DISABLED_SUPERADMIN',True)
 else:good('DENY_DISABLED_SUPERADMIN',False)
 db.execute('UPDATE admin_identities SET enabled=1')
 db.execute('INSERT INTO gpt02_issue159_admin_operator_links VALUES(?,?,?,?)',
  (actor['authSupabaseId'],actor['id'],actor['email'],1));db.commit()
 try:check()
 except ValueError:good('DENY_DUPLICATE_IDENTITY_LINK',True)
 else:good('DENY_DUPLICATE_IDENTITY_LINK',False)
 try:m.eligible_owner(actor,db_path=path,operational=True,now_ms=NOW)
 except ValueError:good('DENY_UNPINNED_APPROVAL_DB',True)
 else:good('DENY_UNPINNED_APPROVAL_DB',False)
 db.close()
print('TOTAL',count,'PASS')
print('NO_LIVE_DECISION_OR_DATABASE_WRITE=TRUE')
