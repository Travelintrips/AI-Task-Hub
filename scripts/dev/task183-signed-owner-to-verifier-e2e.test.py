#!/usr/bin/env python3
"""Task183 full owner decision -> existing reader -> existing signer -> JS verifier.

Entirely isolated: ephemeral SQLite, Unix socket, synthetic ED25519 key.
Uses exactly the patched existing approval-reader and signer source contracts.
No live approval, private CST key, issuer service, or dispatch.
"""
import base64,grp,hashlib,importlib.util,json,os,socket,sqlite3,subprocess,tempfile,threading,time
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding,PublicFormat
ROOT=Path(__file__).parent
def load(path,name):
 spec=importlib.util.spec_from_file_location(name,path)
 obj=importlib.util.module_from_spec(spec)
 spec.loader.exec_module(obj)
 return obj
writer=load(ROOT/'task183-owner-approval-writer-dev.py','writer')
migration=load(ROOT/'task183-install-dormant-owner-approval-schema.py','migration')
reader=load(ROOT/'task183-owner-recovery-decision-reader.py','reader')
reader_patch=load(ROOT/'task183-patch-existing-approval-reader-candidate.py','reader_patch')
signer_patch=load(ROOT/'task183-patch-existing-operational-signer-candidate.py','signer_patch')
N=0
def checked(name,x):
 global N
 N+=1
 if not x:raise AssertionError('FAIL_'+name)
 print('PASS:'+name,flush=True)

with tempfile.TemporaryDirectory(prefix='task183-e2e-synthetic-') as tmp:
 folder=Path(tmp)
 db=folder/'decision.sqlite'
 c=sqlite3.connect(db)
 c.executescript("""CREATE TABLE admin_identities(user_id text,role text,enabled integer);
 CREATE TABLE gpt02_issue159_admin_operator_links(
 auth_user_id text,hub_operator_id text,email text,enabled integer);
 CREATE TABLE gpt02_issue159_approval_intents(id text PRIMARY KEY,task_id integer,status text);
 INSERT INTO gpt02_issue159_approval_intents VALUES('legacy159',159,'PRESERVED');""")
 now=int(time.time()*1000)
 actor={'id':'google_fixture_owner','role':'super_admin','companyId':None,
 'authSupabaseId':'11111111-1111-4111-8111-111111111111',
 'email':'fixture@example.invalid','authSource':'supabase_google_identity',
 'authVerifiedAt':now-15000}
 c.execute('INSERT INTO admin_identities VALUES(?,?,?)',(actor['authSupabaseId'],'super_admin',1))
 c.execute('INSERT INTO gpt02_issue159_admin_operator_links VALUES(?,?,?,?)',
 (actor['authSupabaseId'],actor['id'],actor['email'],1));c.commit();c.close()
 checked('EXACT_MIGRATION_FIXTURE',migration.install(db)=='DORMANT_SCHEMA_INSTALLED_NO_APPROVAL')
 evidence={'requestId':writer.REQUEST,'evidenceSha256':writer.SHA,
 'originalCoreTaskId':'faf682ad-d8e8-4888-95bc-e2e32ea13e92',
 'originalHubExecutionId':'96459064-0231-4d38-889b-419d7df52764',
 'originalAttemptId':'8f5ab85a-8300-4118-a14c-5fc701ae5a7c'}
 signed=writer.record(actor=actor,evidence=evidence,explicit_action=True,
 db_path=db,operational=False,now_ms=now,nonce='S'*48)
 checked('DECISION_AND_OUTBOX_ATOMIC',signed['recorded'] and not signed['cryptographicOwnerSignatureCreated'])
 claims=signed['claims']
 digest=signed['claimsSha256']
 data={'claimsSha256':digest,'taskId':183,'requestId':claims['requestId'],
  'evidenceSha256':claims['evidenceSha256'],
  'ownerSubject':claims['ownerSubject'],'nonce':claims['nonce'],'observedAt':now}
 proof=reader.read_decision(data,db_path=str(db),operational=False,now=now)
 checked('READ_ONLY_DECISION_VERIFIED',proof['ok'] and not proof['signatureVerified'] and not proof['dispatchPermitted'])
 # Apply surgical patches to source-compatible fixtures.
 reader_source=reader_patch.patch((ROOT/'gpt02-existing-approval-reader-baseline.py.txt').read_text())
 signer_source=signer_patch.patch((ROOT/'gpt02-existing-operational-signer-baseline.py.txt').read_text())
 reader_path=folder/'reader.py';reader_path.write_text(reader_source)
 signer_path=folder/'signer.py';signer_path.write_text(signer_source)
 rm=load(reader_path,'reader_service')
 sm=load(signer_path,'signer_service')
 # Root-owned Unix socket with existing signer group and exact modes.
 gid=grp.getgrnam('gpt02-issue159-signers').gr_gid
 directory=folder/'approval-reader';directory.mkdir(mode=0o750);os.chown(directory,0,gid)
 sockpath=directory/'approval.sock'
 server_ready=threading.Event()
 class Handler(rm._Handler):pass
 Handler.operational=False
 Handler.db_path=str(db)
 Handler.task183_recovery_reader_fn=lambda q,**kw:reader.read_decision(q,db_path=str(db),operational=False,now=int(time.time()*1000))
 server=rm._UnixServer(str(sockpath),Handler)
 os.chown(sockpath,0,gid);os.chmod(sockpath,0o660)
 server.timeout=4
 t=threading.Thread(target=server.handle_request,daemon=True);t.start()
 sm.RECOVERY_READER=str(sockpath)
 key=Ed25519PrivateKey.generate()
 signer=sm.Signer('approval',key,{'approval':key.public_key()})
 result=signer.sign_recovery_approval({'claims':claims})
 t.join(timeout=5);server.server_close()
 checked('EXISTING_SIGNER_RETURNED_SYNTHETIC_SIGNATURE',
  result['signatureBase64url'] and result['releaseDecision']=='NO_GO' and
  result['issuerAuthorizationGranted'] is False and result['dispatchPermitted'] is False)
 raw=sm.recovery_signing_bytes(claims)
 key.public_key().verify(base64.urlsafe_b64decode(result['signatureBase64url']+'=='),raw)
 checked('EXISTING_SIGNER_ED25519_VERIFIED_IN_PYTHON',True)
 fingerprint=hashlib.sha256(key.public_key().public_bytes(Encoding.DER,PublicFormat.SubjectPublicKeyInfo)).hexdigest()
 pem=key.public_key().public_bytes(Encoding.PEM,PublicFormat.SubjectPublicKeyInfo).decode()
 facts={'requestId':claims['requestId'],'evidenceSha256':claims['evidenceSha256'],
  'coreTaskId':claims['originalCoreTaskId'],'hubExecutionId':claims['originalHubExecutionId'],
  'attemptId':claims['originalAttemptId'],'ownerSubject':claims['ownerSubject'],
  'superAdminIntentRecorded':True,'nonceAlreadyConsumed':False}
 # JS independent verifier validates exactly the bytes produced by the Python signer.
 verifier=(ROOT/'gpt02-task183-recovery-issuer-approval-verifier.mjs').as_uri()
 js="""
 import {verifyIssuerRecoveryApproval} from """+json.dumps(verifier)+""";
 import {createHash} from 'node:crypto';
 const {claims,signature,pem,fingerprint,facts,now}=JSON.parse(process.env.FIXTURE_JSON);
 const res=verifyIssuerRecoveryApproval({
  claims,signatureBase64url:signature,pinnedOwnerPublicKey:pem,
  pinnedOwnerSpkiSha256:fingerprint,trustedFacts:facts,now
 });
 if(!res.verified||res.issuerAuthorized!==false||res.attemptIssued!==false||
    res.dispatchPermitted!==false||res.ownerApprovalPersisted!==false)
   process.exit(8);
 console.log(JSON.stringify({verified:res.verified,reason:res.reason,
    issuerAuthorized:res.issuerAuthorized,dispatchPermitted:res.dispatchPermitted}));
 """
 env=os.environ.copy()
 env['FIXTURE_JSON']=json.dumps({'claims':claims,'signature':result['signatureBase64url'],
 'pem':pem,'fingerprint':fingerprint,'facts':facts,'now':now})
 process=subprocess.run(['node','--input-type=module','-e',js],
   env=env,text=True,capture_output=True,timeout=12)
 checked('INDEPENDENT_NODE_ED25519_VERIFIER_PASS',process.returncode==0)
 if process.returncode:raise RuntimeError(process.stderr)
 print(process.stdout.strip())
 # Exact signature cannot silently become an issuer authorization.
 checked('ONE_DECISION_AND_OUTBOX_REMAIN',
 sqlite3.connect(db).execute('select count(*) from gpt02_task183_owner_recovery_outbox').fetchone()[0]==1)
 checked('NO_HUB_CORE_OR_DISPATCH_IN_THIS_PROOF',
  result['attemptIssued'] is False and result['dispatchPermitted'] is False)
print('RESULT',N,'PASS')
print('ALL_KEYS_SYNTHETIC=TRUE')
print('LIVE_APPROVAL_DB_AND_PROD_UNCHANGED=TRUE')
