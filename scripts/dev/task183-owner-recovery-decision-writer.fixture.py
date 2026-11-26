#!/usr/bin/env python3
"""CST-DEV Task183 independent recovery decision outbox candidate.

OFFLINE ONLY. This module is NOT connected to any HTTP route or signed
approval. It does not sign, approve on anyone's behalf or dispatch a worker.
Only an authenticated explicit Super Admin action may eventually call it.
"""
import hashlib,json,re,secrets,sqlite3,time,uuid
from pathlib import Path

CANONICAL_DOMAIN="GPT02_TASK183_RECOVERY_ISSUER_APPROVAL_V1"
FIELDS=("version","environment","audience","companyId","hubTaskId",
 "recoveryAttemptNumber","requestId","evidenceSha256","originalCoreTaskId",
 "originalHubExecutionId","originalAttemptId","ownerSubject","nonce",
 "issuedAt","expiresAt","purpose","dispatchPermitted")
UUID=re.compile(r'^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$')
SHA=re.compile(r'^[0-9a-f]{64}$')

def _fail(reason):raise ValueError(reason)
def canonical(c):
 if type(c) is not dict or set(c)!=set(FIELDS):_fail("CLAIM_SHAPE_INVALID")
 return (CANONICAL_DOMAIN+"\n"+json.dumps({k:c[k] for k in FIELDS},
     separators=(',',':'),ensure_ascii=False)).encode()

def _isolated_filename(p):
 p=Path(p)
 return (p.name=='task183-owner-approval-fixture.sqlite' and
    p.parent.name.startswith('task183-owner-writer-fixture-') and
    str(p).startswith('/tmp/') and not p.is_symlink())

def create_fixture_tables(c):
 """Only callable by isolated QA, NEVER on a live approval database."""
 dbs=c.execute('PRAGMA database_list').fetchall()
 if len(dbs)!=1 or not _isolated_filename(dbs[0][2]):
  _fail('ISOLATED_FIXTURE_DATABASE_REQUIRED')
 c.executescript("""
 CREATE TABLE gpt02_task183_owner_recovery_decisions (
  id text PRIMARY KEY,task_id integer NOT NULL CHECK(task_id=183),
  request_id text NOT NULL UNIQUE,company_id text NOT NULL CHECK(company_id='default'),
  evidence_sha256 text NOT NULL,claims_sha256 text NOT NULL UNIQUE,
  owner_subject text NOT NULL,nonce text NOT NULL UNIQUE,auth_user_id text NOT NULL,
  role_at_decision text NOT NULL CHECK(role_at_decision='super_admin'),
  auth_method text NOT NULL CHECK(auth_method='supabase_admin_session'),
  decision text NOT NULL CHECK(decision='APPROVE_RECOVERY_ATTEMPT2_ONLY'),
  recorded_at_ms integer NOT NULL,expires_at_ms integer NOT NULL,
  CHECK(expires_at_ms-recorded_at_ms<=300000)
 );
 CREATE TABLE gpt02_task183_owner_recovery_outbox (
  id text PRIMARY KEY,decision_id text UNIQUE NOT NULL REFERENCES gpt02_task183_owner_recovery_decisions(id),
  task_id integer NOT NULL CHECK(task_id=183),
  request_id text NOT NULL UNIQUE,company_id text NOT NULL CHECK(company_id='default'),
  evidence_sha256 text NOT NULL,claims_sha256 text UNIQUE NOT NULL,
  owner_subject text NOT NULL,nonce text UNIQUE NOT NULL,
  auth_user_id text NOT NULL,role_at_decision text NOT NULL,
  auth_method text NOT NULL,recorded_at_ms integer NOT NULL,expires_at_ms integer NOT NULL
 );
 CREATE TRIGGER task183_decision_no_change BEFORE UPDATE ON gpt02_task183_owner_recovery_decisions
  BEGIN SELECT RAISE(ABORT,'IMMUTABLE_OWNER_DECISION'); END;
 CREATE TRIGGER task183_decision_no_delete BEFORE DELETE ON gpt02_task183_owner_recovery_decisions
  BEGIN SELECT RAISE(ABORT,'IMMUTABLE_OWNER_DECISION'); END;
 CREATE TRIGGER task183_outbox_no_change BEFORE UPDATE ON gpt02_task183_owner_recovery_outbox
  BEGIN SELECT RAISE(ABORT,'IMMUTABLE_OUTBOX'); END;
 CREATE TRIGGER task183_outbox_no_delete BEFORE DELETE ON gpt02_task183_owner_recovery_outbox
  BEGIN SELECT RAISE(ABORT,'IMMUTABLE_OUTBOX'); END;
 """)
def build_claims(evidence,actor,now_ms,nonce=None):
 if type(evidence) is not dict or set(evidence)!={
 'requestId','evidenceSha256','originalCoreTaskId',
 'originalHubExecutionId','originalAttemptId'}:
  _fail('INDEPENDENT_EVIDENCE_MISSING')
 if (type(actor) is not dict or actor.get('role')!='super_admin' or
    not str(actor.get('id','')).startswith('google_')):
  _fail('SIGNED_SUPERADMIN_REQUIRED')
 if (actor.get('authSource')!='supabase_google_identity' or
    type(actor.get('authVerifiedAt')) is not int):
  _fail('SIGNED_OAUTH_SESSION_REQUIRED')
 if (not SHA.fullmatch(evidence['evidenceSha256']) or
    not re.fullmatch(r'[a-f0-9]{36}',evidence['requestId'])):
  _fail('EVIDENCE_DIGEST_INVALID')
 for k in ('originalCoreTaskId','originalHubExecutionId','originalAttemptId'):
  if type(evidence[k]) is not str or not UUID.fullmatch(evidence[k]):
   _fail('EVIDENCE_ID_INVALID')
 if not now_ms>=actor['authVerifiedAt']>now_ms-8*86400000:
  _fail('AUTH_SESSION_EXPIRED')
 if type(now_ms) is not int:_fail('TRUSTED_SERVER_CLOCK_REQUIRED')
 nonce=secrets.token_urlsafe(36) if nonce is None else nonce
 if not re.fullmatch(r'[A-Za-z0-9_-]{48}',nonce):_fail('NONCE_LENGTH_INVALID')
 return {'version':1,'environment':'DEV','audience':CANONICAL_DOMAIN,
  'companyId':'default','hubTaskId':183,'recoveryAttemptNumber':2,
  'requestId':evidence['requestId'],'evidenceSha256':evidence['evidenceSha256'],
  'originalCoreTaskId':evidence['originalCoreTaskId'],
  'originalHubExecutionId':evidence['originalHubExecutionId'],
  'originalAttemptId':evidence['originalAttemptId'],
  'ownerSubject':'owner:'+actor['id'],'nonce':nonce,
  'issuedAt':now_ms,'expiresAt':now_ms+120000,
  'purpose':'PREPARE_ATTEMPT2_ONLY','dispatchPermitted':False}

def record_fixture_decision(db_path,*,actor,evidence,now_ms,
                            verified_explicit_approval=False):
 """Fixture-only. Never permit a generic HTTP or implicit review to call."""
 if verified_explicit_approval is not True:
  _fail('EXPLICIT_USER_OWNER_APPROVAL_REQUIRED')
 claims=build_claims(evidence,actor,now_ms)
 digest=hashlib.sha256(canonical(claims)).hexdigest()
 p=Path(db_path)
 if not _isolated_filename(p):
  _fail('ISOLATED_DB_REQUIRED')
 c=sqlite3.connect(str(p),timeout=5,isolation_level=None)
 try:
  c.execute('BEGIN IMMEDIATE')
  admin=c.execute("""SELECT l.auth_user_id,a.role,a.enabled,l.enabled
    FROM gpt02_issue159_admin_operator_links l
    JOIN admin_identities a ON a.user_id=l.auth_user_id
    WHERE l.hub_operator_id=? AND l.auth_user_id=?""",
    (actor['id'],actor.get('authSupabaseId'))).fetchall()
  if len(admin)!=1 or admin[0][1:]!=('super_admin',1,1):
   _fail('OWNER_IDENTITY_LINK_NOT_UNIQUE_OR_DISABLED')
  decision_id=str(uuid.uuid4())
  outbox_id=str(uuid.uuid4())
  cols=(183,claims['requestId'],'default',claims['evidenceSha256'],digest,
   claims['ownerSubject'],claims['nonce'],admin[0][0],'super_admin',
   'supabase_admin_session','APPROVE_RECOVERY_ATTEMPT2_ONLY',
   now_ms,claims['expiresAt'])
  c.execute('INSERT INTO gpt02_task183_owner_recovery_decisions VALUES ('+
    ','.join('?' for _ in range(14))+')',(decision_id,*cols))
  outbox_cols=(decision_id,*cols[:10],cols[11],cols[12])
  c.execute('INSERT INTO gpt02_task183_owner_recovery_outbox VALUES ('+
    ','.join('?' for _ in range(14))+')',(outbox_id,*outbox_cols))
  c.execute('COMMIT')
  return {'decisionId':decision_id,'claims':claims,
   'claimsSha256':digest,'persisted':True,
   'signedOwnerApproval':False,'issuerAuthorized':False,
   'attemptIssued':False,'dispatchPermitted':False}
 except:
  if c.in_transaction:c.execute('ROLLBACK')
  raise
 finally:c.close()
