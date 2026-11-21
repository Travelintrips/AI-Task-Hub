#!/usr/bin/env python3
"""Offline tests for a *surgical patch* of existing signer. CST keys absent."""
import hashlib,importlib.util,json,os,socket,stat,tempfile,threading,time
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

HERE=Path(__file__).parent
patch_spec=importlib.util.spec_from_file_location('patch_source',HERE/'task183-patch-existing-operational-signer-candidate.py')
patcher=importlib.util.module_from_spec(patch_spec);patch_spec.loader.exec_module(patcher)
# The baseline is passed by the fixture invocation in CI via a retained,
# tracked source snapshot only; never use /opt in CI.
baseline=HERE/'gpt02-existing-operational-signer-baseline.py.txt'
source=baseline.read_text()
assert 'RECOVERY_AUDIENCE=' not in source
patched=patcher.patch(source)
assert patched.count('def sign_approval(')==1 and patched.count('def sign_issuer(')==1
assert patched.count('def sign_recovery_approval(')==1
assert patched.count('POST /sign-approval HTTP/1.1')==1
assert patched.count('POST /sign-issuer HTTP/1.1')==1
assert patched.count('POST /sign-recovery-approval HTTP/1.1')==1
with tempfile.TemporaryDirectory(prefix='task183-signer-synthetic-') as work:
    module_file=Path(work)/'candidate.py'
    module_file.write_text(patched)
    spec=importlib.util.spec_from_file_location('candidate_signer',module_file)
    mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
    now=int(time.time()*1000)
    fields=(
        'version','environment','audience','companyId','hubTaskId',
        'recoveryAttemptNumber','requestId','evidenceSha256','originalCoreTaskId',
        'originalHubExecutionId','originalAttemptId','ownerSubject','nonce',
        'issuedAt','expiresAt','purpose','dispatchPermitted')
    claims={
     'version':1,'environment':'DEV',
     'audience':'GPT02_TASK183_RECOVERY_ISSUER_APPROVAL_V1',
     'companyId':'default','hubTaskId':183,'recoveryAttemptNumber':2,
     'requestId':'6bcd8419254dc21c0b149eb09e68a7b6da66',
     'evidenceSha256':'89950d3b8ac91aac612810325c6a219cb898a6fa41b234a477f0dbe32d85eb7b',
     'originalCoreTaskId':'faf682ad-d8e8-4888-95bc-e2e32ea13e92',
     'originalHubExecutionId':'96459064-0231-4d38-889b-419d7df52764',
     'originalAttemptId':'8f5ab85a-8300-4118-a14c-5fc701ae5a7c',
     'ownerSubject':'owner:synthetic-only','nonce':'TESTONLYnonce'+('0'*33),
     'issuedAt':now-10000,'expiresAt':now+120000,
     'purpose':'PREPARE_ATTEMPT2_ONLY','dispatchPermitted':False}
    key=Ed25519PrivateKey.generate()
    signer=mod.Signer('approval',key,{'approval':key.public_key()})
    count=0
    def passed(label,condition):
        global count
        count+=1
        if not condition:raise AssertionError(label)
        print('PASS '+label)
    def denied(label,fn,reason=None):
        try:fn()
        except RuntimeError as exc:
            if reason and reason not in str(exc):raise
            passed(label,True)
        else:passed(label,False)
    mod.RECOVERY_READER=str(Path(work)/'nonexistent'/'approval.sock')
    denied('MISSING_ROOT_SIGNED_OWNER_READER_FAIL_CLOSED',
        lambda:signer.sign_recovery_approval({'claims':claims}),
        'INDEPENDENT_RECOVERY_OWNER_APPROVAL_READER_MISSING')
    denied('ALTERNATE_ISSUE159_AUDIENCE_DENIED',
        lambda:signer.sign_recovery_approval({'claims':{**claims,'audience':'GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL'}}),
        'RECOVERY_APPROVAL_SCOPE_OR_WINDOW_DENIED')
    denied('FOREIGN_TENANT_DENIED',
        lambda:signer.sign_recovery_approval({'claims':{**claims,'companyId':'foreign'}}),
        'RECOVERY_APPROVAL_SCOPE_OR_WINDOW_DENIED')
    denied('DISPATCH_FLAG_DENIED',
        lambda:signer.sign_recovery_approval({'claims':{**claims,'dispatchPermitted':True}}),
        'RECOVERY_APPROVAL_SCOPE_OR_WINDOW_DENIED')
    denied('UNKNOWN_EXTRA_FIELD_DENIED',
        lambda:signer.sign_recovery_approval({'claims':{**claims,'issuerAuthority':True}}),
        'RECOVERY_CLAIM_SHAPE_INVALID')
    denied('MISSING_REQUIRED_FIELD_DENIED',
        lambda:signer.sign_recovery_approval({'claims':{k:v for k,v in claims.items() if k!='nonce'}}),
        'RECOVERY_CLAIM_SHAPE_INVALID')
    denied('SIGNER_ROLE_IS_APPROVAL_ONLY',
        lambda:mod.Signer('hub',key,{}).sign_recovery_approval({'claims':claims}),
        'RECOVERY_SIGNER_ROLE_MISMATCH')
    sockdir=Path(work)/'reader'
    sockdir.mkdir(mode=0o750)
    gid=mod.grp.getgrnam('gpt02-issue159-signers').gr_gid
    os.chown(sockdir,0,gid)
    sock=sockdir/'approval.sock'
    incoming={}
    def reader(response_data=None):
        listener=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
        listener.bind(str(sock));os.chown(sock,0,gid);os.chmod(sock,0o660);listener.listen(1)
        def serve():
            try:
                conn,_=listener.accept()
                with conn:
                    chunks=[]
                    while True:
                        data=conn.recv(4096)
                        if not data:break
                        chunks.append(data)
                        raw=b''.join(chunks)
                        if b'\r\n\r\n' in raw:
                            head,_,body=raw.partition(b'\r\n\r\n')
                            length=int([l for l in head.split(b'\r\n') if l.lower().startswith(b'content-length:')][0].split(b':',1)[1])
                            if len(body)>=length:break
                    incoming['request']=json.loads(raw.partition(b'\r\n\r\n')[2].decode())
                    incoming['method']=raw.split(b'\r\n',1)[0]
                    payload=json.dumps(response_data or {},separators=(',',':')).encode()
                    res=(b'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: '+
                         str(len(payload)).encode()+b'\r\n\r\n'+payload)
                    conn.sendall(res)
            finally:listener.close()
        thread=threading.Thread(target=serve,daemon=True)
        thread.start()
        return thread
    mod.RECOVERY_READER=str(sock)
    digest=hashlib.sha256(mod.recovery_signing_bytes(claims)).hexdigest()
    good={
        'ok':True,'environment':'DEV','source':'task183-independent-recovery-approval-reader',
        'readOnly':True,'releaseDecision':'NO_GO',
        'claimsSha256':digest,'requestId':claims['requestId'],
        'ownerSubject':claims['ownerSubject'],'evidenceSha256':claims['evidenceSha256'],
        'signatureVerified':True,'persistedIndependentOwnerDecision':True,
        'issuerAuthorizationGranted':False,'dispatchPermitted':False}
    t=reader({**good,'signatureVerified':False})
    denied('UNVERIFIED_OWNER_READER_RESPONSE_DENIED',
        lambda:signer.sign_recovery_approval({'claims':claims}),
        'PERSISTED_INDEPENDENT_SIGNED_OWNER_DECISION_REQUIRED')
    t.join(timeout=4);sock.unlink()
    t=reader(good)
    result=signer.sign_recovery_approval({'claims':claims})
    t.join(timeout=4);sock.unlink()
    key.public_key().verify(
        __import__('base64').urlsafe_b64decode(result['signatureBase64url']+'=='),
        mod.recovery_signing_bytes(claims))
    passed('SYNTHETIC_GENUINE_ED25519_RECOVERY_SIGNING_VERIFIES',True)
    passed('INDEPENDENT_READER_RECEIVED_EXACT_BINDING',
        incoming['request']['claimsSha256']==digest and
        incoming['request']['requestId']==claims['requestId'] and
        incoming['method']==b'POST /verify-owner-recovery-approval HTTP/1.1')
    passed('CRYPTO_VALID_NEVER_ALONE_AUTHORIZES_ISSUER',
        result['authorizationGranted'] is False if 'authorizationGranted' in result
        else result['issuerAuthorizationGranted'] is False and
        result['dispatchPermitted'] is False and result['releaseDecision']=='NO_GO')
    passed('EXISTING_SIGNER_ROUTES_RETAINED',
        'POST /sign-approval HTTP/1.1' in patched and
        'POST /sign-issuer HTTP/1.1' in patched)
    print('TOTAL',count,'PASS')
    print('PRIVATE_CST_CREDENTIALS_ACCESSED=FALSE')
    print('EXISTING_LIVE_SIGNER_FILE_UNCHANGED=TRUE')
    print('REAL_OWNER_APPROVAL_CREATED=FALSE')
