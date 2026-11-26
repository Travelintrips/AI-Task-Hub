import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,verify} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {
 GPT02_SIGNER_ROLES,GPT02_SIGNER_DOMAINS,
 gpt02SignerSigningBytes,gpt02SignerContract
} from './gpt02-four-signer-contract.mjs';

const approval=Object.freeze({
 v:2,environment:'DEV',audience:'GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL',
 taskId:137,commandId:'11111111-1111-4111-8111-111111111111',
 attemptId:'22222222-2222-4222-8222-222222222222',
 nonce:'A'.repeat(44),operatorNamespace:'ai-task-hub.public.users',
 superAdminId:'fixture-super-admin',companyId:'default',
 issuedAt:1000,expiresAt:2000
});
const link=Object.freeze({
 v:1,environment:'DEV',audience:'GPT02_DUAL_ACCOUNT_COMMAND_LINK',
 linkId:'33333333-3333-4333-8333-333333333333',companyId:'default',
 hubTaskId:137,hubExecutionId:'44444444-4444-4444-8444-444444444444',
 coreTaskId:'55555555-5555-4555-8555-555555555555',
 coreCommandId:approval.commandId,attemptId:approval.attemptId,attemptNumber:1,
 assigneeId:5,accountableOwnerId:'fixture-owner',
 hubOperatorNamespace:'ai-task-hub.public.users',
 hubOperatorId:approval.superAdminId,hubRole:'super_admin',hubActive:true,
 coreOperatorNamespace:'ai-core.ai_platform.internal_users',
 coreOperatorUserId:77,coreRole:'admin',coreActive:true,corePasswordChanged:true,
 workerId:'openclaw-dell-chatgpt-wake-dev',approvalDigest:'a'.repeat(64),
 nonce:approval.nonce,issuedAt:1100,expiresAt:1900
});
const issuer=Object.freeze({
 v:1,environment:'DEV',audience:'GPT02_ISSUER_LEASE_EVIDENCE_V1',
 companyId:'default',hubTaskId:137,
 hubExecutionId:link.hubExecutionId,coreTaskId:link.coreTaskId,
 commandId:approval.commandId,attemptId:approval.attemptId,
 workerId:'openclaw-dell-chatgpt-wake-dev',
 receiptId:'66666666-6666-4666-8666-666666666666',
 linkId:link.linkId,fenceId:'77777777-7777-4777-8777-777777777777',
 approvalDigest:'a'.repeat(64),nonceDigest:'b'.repeat(64),
 issuerRole:'dev_gpt02_issuer_evidence',leaseEpoch:1,
 issuedAt:1200,expiresAt:1800
});

test('four roles expose canonical DEV domains but no authority',()=>{
 assert.deepEqual([...GPT02_SIGNER_ROLES],['approval','hub','core','issuer']);
 for(const role of GPT02_SIGNER_ROLES){
  const c=gpt02SignerContract(role);
  assert.equal(c.environment,'DEV');
  assert.equal(c.algorithm,'Ed25519');
  assert.equal(c.domain,GPT02_SIGNER_DOMAINS[role]);
  assert.equal(c.authorizationGranted,false);
  assert.equal(c.dispatchPermitted,false);
  assert.equal(c.privateKeyLoaded,false);
  assert.equal(c.signerMounted,false);
 }
});

test('signing bytes exactly match existing verifier domains',()=>{
 const a=gpt02SignerSigningBytes('approval',approval);
 const h=gpt02SignerSigningBytes('hub',link);
 const c=gpt02SignerSigningBytes('core',link);
 const i=gpt02SignerSigningBytes('issuer',issuer);
 assert.equal(a.toString('utf8').startsWith('{'),true);
 assert.equal(h.toString('utf8').startsWith('GPT02_OPERATOR_LINK_V1:hub\n'),true);
 assert.equal(c.toString('utf8').startsWith('GPT02_OPERATOR_LINK_V1:core\n'),true);
 assert.equal(i.toString('utf8').startsWith('GPT02_ISSUER_LEASE_EVIDENCE_V1\n'),true);
 assert.equal(h.equals(c),false);
});

test('synthetic Ed25519 signatures verify only against the exact domain bytes',()=>{
 const inputs=[
  ['approval',approval],['hub',link],['core',link],['issuer',issuer]
 ];
 const keys=inputs.map(()=>generateKeyPairSync('ed25519'));
 const signatures=inputs.map(([role,claims],idx)=>
  sign(null,gpt02SignerSigningBytes(role,claims),keys[idx].privateKey));
 for(let x=0;x<inputs.length;x++){
  const [role,claims]=inputs[x];
  assert.equal(verify(null,gpt02SignerSigningBytes(role,claims),
    keys[x].publicKey,signatures[x]),true);
 }
 assert.equal(verify(null,gpt02SignerSigningBytes('core',link),
   keys[1].publicKey,signatures[1]),false);
 assert.equal(verify(null,gpt02SignerSigningBytes('hub',link),
   keys[2].publicKey,signatures[2]),false);
});

test('invalid role fails before returning bytes or contract',()=>{
 assert.throws(()=>gpt02SignerSigningBytes('checkpoint',approval),
  e=>e.code==='GPT02_SIGNER_ROLE_INVALID');
 assert.throws(()=>gpt02SignerContract('checkpoint'),
  e=>e.code==='GPT02_SIGNER_ROLE_INVALID');
});

test('source has no signing, private-key loading, filesystem or network surface',async()=>{
 const src=await readFile(new URL('./gpt02-four-signer-contract.mjs',import.meta.url),'utf8');
 for(const forbidden of [
  'createPrivateKey','generateKeyPair','sign(','private.pem','PRIVATE_KEY',
  'readFile','node:fs','fetch(','http://','https://','new Pool','dispatchPermitted:true'
 ]) assert.equal(src.includes(forbidden),false,forbidden);
});
