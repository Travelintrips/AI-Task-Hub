#!/usr/bin/env python3
"""Task183 owner approval writer - explicit, signed-session, bounded DEV only.

No HTTP, no secret handling, no signer/issuer activation. The caller must have
validated an actual signed Google Super Admin JWT and an explicit action.
Fails closed on unknown schema, actor, source drift or pre-existing approval.
The only write is one atomic decision + matching outbox in root-owned DEV
approval DB. No implicit approval from review/intent or fixture flags.
"""
import hashlib,importlib.util,json,os,re,secrets,sqlite3,stat,time,uuid
from pathlib import Path

LIVE_DB=Path('/opt/ai-coding-standalone-dev/tasks.db')
CLAIMS=('version','environment','audience','companyId','hubTaskId',
        'recoveryAttemptNumber','requestId','evidenceSha256',
        'originalCoreTaskId','originalHubExecutionId','originalAttemptId',
        'ownerSubject','nonce','issuedAt','expiresAt','purpose','dispatchPermitted')
AUDIENCE='GPT02_TASK183_RECOVERY_ISSUER_APPROVAL_V1'
REQUEST='6bcd8419254dc21c0b149eb09e68a7b6da66'
SHA='89950d3b8ac91aac612810325c6a219cb898a6fa41b234a477f0dbe32d85eb7b'
UUID_RE=re.compile(r'^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$')
HEX=re.compile(r'^[0-9a-f]{64}$')
APPROVAL='APPROVE_RECOVERY_ATTEMPT2_ONLY'

def _deny(message):raise ValueError(message)

def _actor(actor,now):
 if (type(actor) is not dict or actor.get('role')!='super_admin'
     or actor.get('companyId') not in (None,'default')
     or actor.get('authSource')!='supabase_google_identity'
     or not re.fullmatch(r'google_[A-Za-z0-9_-]{6,120}',str(actor.get('id','')))
     or not UUID_RE.fullmatch(str(actor.get('authSupabaseId','')).lower())
     or not re.fullmatch(r'[^@\s]+@[^@\s]+',str(actor.get('email','')))
     or type(actor.get('authVerifiedAt')) is not int
     or actor['authVerifiedAt']>now+30000
     or actor['authVerifiedAt']<now-8*86400000):
  _deny('SIGNED_SUPERADMIN_IDENTITY_REQUIRED')

def _evidence(e):
 required=('requestId','evidenceSha256','originalCoreTaskId',
           'originalHubExecutionId','originalAttemptId')
 if type(e) is not dict or set(e)!=set(required):_deny('EVIDENCE_SHAPE_INVALID')
 if e['requestId']!=REQUEST or e['evidenceSha256']!=SHA:_deny('ORIGINAL_PROOF_DRIFT')
 for name in required[2:]:
  if not UUID_RE.fullmatch(str(e[name])):_deny('ORIGINAL_ATTEMPT_ID_INVALID')
 if len({e[n] for n in required[2:]})!=3:_deny('ORIGINAL_ATTEMPT_IDS_NOT_DISTINCT')

def _canonical(c):
 if type(c) is not dict or set(c)!=set(CLAIMS):_deny('CLAIMS_SHAPE_INVALID')
 return (AUDIENCE+'\n'+json.dumps({k:c[k] for k in CLAIMS},
             ensure_ascii=False,separators=(',',':'))).encode()

def prepare(actor,evidence,now_ms,nonce=None):
 _actor(actor,now_ms);_evidence(evidence)
 nonce=secrets.token_urlsafe(36) if nonce is None else nonce
 if type(nonce) is not str or not re.fullmatch(r'[A-Za-z0-9_-]{48}',nonce):
  _deny('NONCE_INVALID')
 c={'version':1,'environment':'DEV','audience':AUDIENCE,
    'companyId':'default','hubTaskId':183,'recoveryAttemptNumber':2,
    'requestId':REQUEST,'evidenceSha256':SHA,
    'originalCoreTaskId':evidence['originalCoreTaskId'],
    'originalHubExecutionId':evidence['originalHubExecutionId'],
    'originalAttemptId':evidence['originalAttemptId'],
    'ownerSubject':'owner:'+actor['id'],'nonce':nonce,
    'issuedAt':now_ms,'expiresAt':now_ms+120000,
    'purpose':'PREPARE_ATTEMPT2_ONLY','dispatchPermitted':False}
 return c,hashlib.sha256(_canonical(c)).hexdigest()

def _db(db_path,operational):
 p=Path(db_path)
 if operational and p!=LIVE_DB:_deny('DEV_APPROVAL_DB_PINNED')
 if p.is_symlink():_deny('APPROVAL_DB_SYMLINK')
 try:st=p.stat()
 except OSError:_deny('APPROVAL_DB_MISSING_OR_UNAVAILABLE')
 if not stat.S_ISREG(st.st_mode):_deny('APPROVAL_DB_NOT_REGULAR')
 if operational and (st.st_uid!=0 or st.st_gid!=0 or stat.S_IMODE(st.st_mode)!=0o600):
  _deny('APPROVAL_DB_CUSTODY_INVALID')
 return p

def _verify_original_authoritative_evidence(actor,evidence,now_ms):
 """Real only: recheck current signed review, consent, DB and owner role."""
 for source_name,source_file in (
   ('owner_gate','/opt/ai-coding-standalone-dev/qa/task183-owner-identity-readiness.py'),
   ('review_intake','/opt/ai-coding-standalone-dev/qa/task183-recovery-review-intake-dev.py')):
  p=Path(source_file)
  st=os.lstat(p)
  if p.is_symlink() or st.st_uid!=0 or stat.S_IMODE(st.st_mode)!=0o400:
   _deny('INDEPENDENT_SOURCE_CUSTODY_INVALID')
  spec=importlib.util.spec_from_file_location(source_name,p)
  mod=importlib.util.module_from_spec(spec)
  spec.loader.exec_module(mod)
  if source_name=='owner_gate':
   identity=mod.eligible_owner(actor,now_ms=now_ms)
   if identity.get('eligible') is not True or identity.get('dispatchPermitted') is not False:
    _deny('OWNER_IDENTITY_NOT_VERIFIED')
  else:
   packet=mod.review_evidence_packet(actor,now_ms=now_ms)
   status=mod.get_recovery_consent_state(actor)
   e=packet['evidence']
   expected={'requestId':e['requestId'],'evidenceSha256':packet['evidenceSha256'],
    'originalCoreTaskId':e['coreTaskId'],
    'originalHubExecutionId':e['hubExecutionId'],
    'originalAttemptId':e['originalAttemptId']}
   if (evidence!=expected or status.get('recorded') is not True or
       status.get('state')!='SUPERADMIN_RECOVERY_INTENT_PENDING_INDEPENDENT_ISSUER'
       or status.get('issuerAuthority') is not False or
       status.get('dispatchPermitted') is not False):
    _deny('HISTORICAL_REVIEW_OR_CONSENT_MISMATCH')
 return True

def record(*,actor,evidence,explicit_action,db_path=LIVE_DB,
           operational=True,now_ms=None,nonce=None,successor_request=None):
 """The explicit action must come only from authenticated UI POST server code.

 This module cannot validate a JWT itself. The invoking HTTP handler must
 authenticate signed JWT, origin, exact body and CSRF first; do not expose
 the module or permit requester-supplied actor/evidence/DB paths.
 """
 if explicit_action is not True:_deny('EXPLICIT_OWNER_APPROVAL_REQUIRED')
 now_ms=int(time.time()*1000) if now_ms is None else now_ms
 p=_db(db_path,operational)
 if operational:
  _verify_original_authoritative_evidence(actor,evidence,now_ms)
 claims,digest=prepare(actor,evidence,now_ms,nonce)
 con=sqlite3.connect(str(p),timeout=5,isolation_level=None)
 try:
  con.execute('PRAGMA busy_timeout=5000')
  con.execute('PRAGMA foreign_keys=ON')
  con.execute('BEGIN IMMEDIATE')
  existing = 0
  if successor_request is not None:
   if not isinstance(successor_request,str) or not re.fullmatch('[a-f0-9]{36}',successor_request) or successor_request==REQUEST:
    _deny('INVALID_SUCCESSOR_REQUEST')
   reader_path=Path(__file__).resolve().with_name("task183-owner-recovery-decision-reader.py")
   if operational:
    info=reader_path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid or info.st_gid or stat.S_IMODE(info.st_mode)!=0o400:
     _deny("INDEPENDENT_SOURCE_CUSTODY_INVALID")
   spec=importlib.util.spec_from_file_location("task183_lineage_reader",reader_path)
   reader=importlib.util.module_from_spec(spec)
   spec.loader.exec_module(reader)
   chain=reader.reserved_predecessors(con,successor_request,now_ms)
   if (not chain or chain[-1][2]!=actor["authSupabaseId"] or chain[-1][3]!=claims["ownerSubject"]
       or any(row[4]==claims["nonce"] for row in chain)):
    _deny("MATCHING_SUCCESSOR_RESERVATION_REQUIRED")
   claims['requestId']=successor_request
   digest=hashlib.sha256(_canonical(claims)).hexdigest()
   existing=len(chain)
  for table in ('gpt02_task183_owner_recovery_decisions',
                'gpt02_task183_owner_recovery_outbox'):
   if not con.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",(table,)).fetchone():
    _deny('DORMANT_APPROVAL_SCHEMA_NOT_INSTALLED')
   if con.execute('SELECT count(*) FROM '+table).fetchone()[0]!=existing:
    _deny('EXISTING_APPROVAL_MUST_NOT_BE_REPLAYED')
  rows=con.execute("""
    SELECT l.auth_user_id,a.role,a.enabled,l.enabled
      FROM gpt02_issue159_admin_operator_links l
      JOIN admin_identities a ON a.user_id=l.auth_user_id
     WHERE l.hub_operator_id=? AND l.auth_user_id=?
       AND lower(l.email)=lower(?)
    """,(actor['id'],actor['authSupabaseId'],actor['email'])).fetchall()
  if len(rows)!=1 or rows[0]!=(actor['authSupabaseId'],'super_admin',1,1):
   _deny('OWNER_GOOGLE_OPERATOR_MAPPING_INVALID')
  decision_id=str(uuid.uuid4());outbox_id=str(uuid.uuid4())
  cols=(183,claims['requestId'],'default',SHA,digest,claims['ownerSubject'],
        claims['nonce'],actor['authSupabaseId'],'super_admin',
        'supabase_admin_session',APPROVAL,now_ms,claims['expiresAt'])
  con.execute('INSERT INTO gpt02_task183_owner_recovery_decisions VALUES ('+
      ','.join('?'*14)+')',(decision_id,*cols))
  outbox=(decision_id,*cols[:10],cols[11],cols[12])
  con.execute('INSERT INTO gpt02_task183_owner_recovery_outbox VALUES ('+
      ','.join('?'*14)+')',(outbox_id,*outbox))
  if con.execute("SELECT count(*) FROM gpt02_task183_owner_recovery_decisions").fetchone()[0]!=existing+1:
   _deny('DECISION_CARDINALITY_FAILED')
  if con.execute("SELECT count(*) FROM gpt02_task183_owner_recovery_outbox").fetchone()[0]!=existing+1:
   _deny('OUTBOX_CARDINALITY_FAILED')
  con.execute('COMMIT')
  return {'requestId':claims['requestId'],'decisionId':decision_id,
    'claims':claims,'claimsSha256':digest,
    'recorded':True,'ownerDecisionStored':True,
    'cryptographicOwnerSignatureCreated':False,
    'issuerAuthorized':False,'attemptIssued':False,
    'dispatchPermitted':False,'releaseDecision':'NO_GO'}
 except:
  if con.in_transaction:con.execute('ROLLBACK')
  raise
 finally:con.close()
