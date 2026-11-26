#!/usr/bin/env python3
"""Read-only independent CST-DEV recovery issuer gate for Task 183.

Never issues a command, approval, role change, lease or new attempt.
Caller data cannot substitute for independent source readback.
"""
import importlib.util,json,sqlite3,subprocess,os,sys,time
from pathlib import Path

INTAKE='/opt/ai-coding-standalone-dev/qa/task183-recovery-review-intake-dev.py'
STORE='/var/lib/cst-dev-task183-recovery/review-requests.sqlite3'

def check_local(c, evidence, now):
    request=c.execute("SELECT request_id,requested_by,status,owner_approval_granted,issuer_grant,dispatch_permitted FROM reviews WHERE company_id='default' AND hub_task_id=183").fetchall()
    if len(request)!=1:raise ValueError('REVIEW_CARDINALITY')
    request_id,actor,state,approval,issuer,dispatch=request[0]
    if state!='PENDING_INDEPENDENT_OWNER_REVIEW' or any((approval,issuer,dispatch)):
        raise ValueError('REVIEW_STATE_DRIFT')
    sha=evidence['evidenceSha256']
    ack=c.execute("SELECT reviewer_id,evidence_sha256,decision,owner_approval_granted,issuer_grant,dispatch_permitted FROM evidence_acknowledgements WHERE request_id=?",(request_id,)).fetchall()
    if len(ack)!=1 or ack[0]!=(actor,sha,'REVIEWED_ONLY_NO_AUTHORIZATION',0,0,0):
        raise ValueError('ACK_NOT_MATCHED')
    intent=c.execute("SELECT challenge_id,actor_id,evidence_sha256,consented_at_ms,auth_source,state,signed_owner_approval,issuer_authority,nonce_issuer_consumed,attempt_issued,dispatch_permitted FROM recovery_consent_intents WHERE request_id=?",(request_id,)).fetchall()
    if len(intent)!=1:raise ValueError('CONSENT_NOT_UNIQUE')
    ch_id,owner,hash_,when,auth,state,signed,issuer,nonce_issuer,attempt,dispatch=intent[0]
    if (owner!=actor or hash_!=sha or auth!='supabase_google_identity'
      or state!='SUPERADMIN_RECOVERY_INTENT_PENDING_INDEPENDENT_ISSUER'
      or any((signed,issuer,nonce_issuer,attempt,dispatch))):
        raise ValueError('CONSENT_AUTHORITY_DRIFT')
    challenge=c.execute("SELECT request_id,actor_id,evidence_sha256,nonce_hash,created_at_ms,expires_at_ms,consumed_at_ms FROM recovery_consent_challenges WHERE challenge_id=?",(ch_id,)).fetchall()
    if len(challenge)!=1:raise ValueError('NONCE_NOT_UNIQUE')
    rid,who,digest,nonce_hash,created,expiry,consumed=challenge[0]
    if (rid!=request_id or who!=actor or digest!=sha or len(nonce_hash)!=64
      or not (created<=consumed==when<expiry and expiry-created<=300000)):
        raise ValueError('NONCE_EXACTLY_ONCE_PROOF_FAILED')
    return {'requestId':request_id,'evidenceSha256':sha,
            'signedGoogleSuperAdminIntentPresent':True,
            'singleUseNonceLocallyConsumed':True,
            'signedOwnerApprovalPresent':False,
            'issuerAuthorizationPresent':False,
            'newAttemptAuthorized':False}

def issuer_role_readonly():
    js="""const {Client}=require('/app/artifacts/api-server/node_modules/pg');
    const c=new Client({connectionString:process.env.SUPABASE_DATABASE_URL_DEV,connectionTimeoutMillis:7000});
    (async()=>{try{await c.connect();await c.query('BEGIN READ ONLY');
    const roles=['dev_gpt02_attestor_evidence','dev_gpt02_issuer_evidence','gpt02_core_prep_login'];
    const r=await c.query('SELECT rolname,rolcanlogin,rolconnlimit FROM pg_roles WHERE rolname=ANY($1::text[])',[roles]);
    const a=await c.query('SELECT usename FROM pg_stat_activity WHERE usename=ANY($1::text[])',[roles]);
    console.log(JSON.stringify({roles:r.rows,sessions:a.rows}));await c.query('ROLLBACK')}
    catch(e){console.log(JSON.stringify({error:e.code||e.name}));process.exitCode=3}
    finally{await c.end().catch(()=>{})}})()"""
    x=subprocess.run(['docker','exec','ai-task-dev-main-directdb-qa-20261121','node','-e',js],capture_output=True,text=True,timeout=20)
    if x.returncode!=0:raise ValueError('ISSUER_ROLE_DB_UNAVAILABLE')
    data=json.loads(x.stdout)
    if set(data)!={'roles','sessions'}:raise ValueError('ISSUER_ROLE_READ_INVALID')
    wanted={'dev_gpt02_attestor_evidence','dev_gpt02_issuer_evidence','gpt02_core_prep_login'}
    return (len(data['roles'])==3 and {r['rolname'] for r in data['roles']}==wanted and
        all(r['rolcanlogin'] is False and r['rolconnlimit']==0 for r in data['roles']) and
        not data['sessions'])

def preflight(intake=INTAKE, store=STORE, source=None, roles_locked=None, now_ms=None):
    if now_ms is None:now_ms=int(time.time()*1000)
    s=importlib.util.spec_from_file_location('intake',intake)
    m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
    fresh=m.source_readback() if source is None else source
    m.validate_source(fresh,now_ms)
    con=sqlite3.connect('file:'+str(store)+'?mode=ro',uri=True,timeout=4)
    try:
        row=con.execute("SELECT requested_by FROM reviews WHERE hub_task_id=183 AND company_id='default'").fetchone()
        if not row:raise ValueError('REQUEST_NOT_FOUND')
        evidence=m.review_evidence_packet({'id':row[0],'role':'super_admin','companyId':None},
                                         store_path=Path(store),actual_source=fresh,now_ms=now_ms)
        proof=check_local(con,evidence,now_ms)
    finally:con.close()
    locked=issuer_role_readonly() if roles_locked is None else roles_locked
    if not locked:status='NO_GO_ISSUER_ROLE_NOT_RELOCKED'
    elif not proof['signedOwnerApprovalPresent']:
        status='NO_GO_INDEPENDENT_SIGNED_OWNER_APPROVAL_MISSING'
    else:status='NO_GO_INDEPENDENT_ISSUER_AUTHORIZATION_MISSING'
    return {'taskId':183,'status':status,'proof':proof,'issuerRolesLocked':locked,
            'readOnly':True,'signedOwnerApprovalCreated':False,
            'issuerAuthorityGranted':False,'newAttemptCreated':False,
            'dispatchPermitted':False,'databaseWrites':False}

if __name__=='__main__':
    if os.geteuid()!=0:print('NO_GO_ROOT_REQUIRED');sys.exit(3)
    try:
        result=preflight()
        print(json.dumps(result,indent=2))
        sys.exit(2)
    except Exception as error:
        print(json.dumps({'status':'NO_GO_EVIDENCE_UNAVAILABLE',
              'errorType':type(error).__name__,'databaseWrites':False,'dispatchPermitted':False}))
        sys.exit(3)
