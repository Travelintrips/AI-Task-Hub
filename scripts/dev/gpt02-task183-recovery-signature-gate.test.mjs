import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {canonicalRecoveryReview,verifyTask183RecoverySignature} from './gpt02-task183-recovery-signature-gate.mjs';

const clock=Date.parse('2026-11-21T12:00:00Z');
const original={
 coreTaskId:'faf682ad-d8e8-4888-95bc-e2e32ea13e92',
 hubExecutionId:'96459064-0231-4d38-889b-419d7df52764',
 attemptId:'8f5ab85a-8300-4118-a14c-5fc701ae5a7c',
 expiresAt:'2026-11-21T11:25:28.870Z',
 recoveryPreviouslyRequested:false
};
const claims={
 version:1,environment:'DEV',
 audience:'GPT02_TASK183_EXPIRED_PREPARATION_RECOVERY_REVIEW_V1',
 companyId:'default',hubTaskId:183,
 originalCoreTaskId:original.coreTaskId,
 originalHubExecutionId:original.hubExecutionId,
 originalAttemptId:original.attemptId,
 originalReservationExpiresAt:original.expiresAt,
 recoveryAttemptNumber:2,recoveryPurpose:'REVIEW_ONLY_NO_DISPATCH',
 ownerSubject:'owner:synthetic-fixture',nonce:'synthetic_nonce_with_32_chars_abcd',
 issuedAt:clock-20000,expiresAt:clock+120000
};
const keys=generateKeyPairSync('ed25519');
const pub=keys.publicKey;
const digest=createHash('sha256').update(pub.export({format:'der',type:'spki'})).digest('hex');
function encode(c,key=keys.privateKey){
 return sign(null,Buffer.from(canonicalRecoveryReview(c)),key).toString('base64url');
}
const sig=encode(claims);
const verify=(c=claims,overrides={})=>verifyTask183RecoverySignature({
 claims:c,signature:encode(c),
 serverPinnedPublicKey:pub,serverPinnedSpkiSha256:digest,
 expectedOriginal:original,expectedOwnerSubject:claims.ownerSubject,now:clock,...overrides
});
test('valid synthetic Ed25519 review STILL does not authorize an attempt',()=>{
 const r=verify();
 assert.equal(r.verified,true);
 assert.equal(r.approvalGranted,false);
 assert.equal(r.dispatchPermitted,false);
 assert.equal(r.canIssueAttempt,false);
});
const changes=[
 ['foreign tenant',{companyId:'other'}],
 ['other task',{hubTaskId:184}],
 ['other attempt number',{recoveryAttemptNumber:3}],
 ['prod environment',{environment:'PROD'}],
 ['incorrect original core',{originalCoreTaskId:'11111111-1111-4111-8111-111111111111'}],
 ['incorrect original hub',{originalHubExecutionId:'11111111-1111-4111-8111-111111111111'}],
 ['incorrect original attempt',{originalAttemptId:'11111111-1111-4111-8111-111111111111'}],
 ['unexpired source',{originalReservationExpiresAt:'2026-11-21T13:25:28.870Z'}],
 ['wrong audience',{audience:'GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL'}],
 ['wrong purpose',{recoveryPurpose:'DISPATCH'}],
 ['missing owner',{ownerSubject:'owner:'}],
 ['expired signature',{expiresAt:clock-1}],
 ['overlong window',{expiresAt:clock+700000}],
 ['future issue',{issuedAt:clock+60000}],
 ['wrong nonce',{nonce:'X'}]
];
for(const [label,delta] of changes)
 test('fail closed: '+label,()=>{
  const r=verify({...claims,...delta});
  assert.equal(r.verified,false,label);
  assert.equal(r.canIssueAttempt,false);
 });
test('untrusted extra request fields rejected',()=>{
 const r=verifyTask183RecoverySignature({claims:{...claims,dispatchPermitted:true},signature:sig,serverPinnedPublicKey:pub,serverPinnedSpkiSha256:digest,expectedOriginal:original,expectedOwnerSubject:claims.ownerSubject,now:clock});
 assert.equal(r.verified,false);
});
test('untrusted absent request fields rejected',()=>{
 const c={...claims};delete c.hubTaskId;
 assert.equal(verifyTask183RecoverySignature({claims:c,signature:sig,serverPinnedPublicKey:pub,serverPinnedSpkiSha256:digest,expectedOriginal:original,expectedOwnerSubject:claims.ownerSubject,now:clock}).verified,false);
});
test('wrong signature, even with plausible claims, rejected',()=>{
 const altered={...claims,nonce:'another_valid_nonce_32chars_aaaa'};
 const r=verifyTask183RecoverySignature({
  claims:altered,signature:sig,serverPinnedPublicKey:pub,
  serverPinnedSpkiSha256:digest,expectedOriginal:original,expectedOwnerSubject:claims.ownerSubject,now:clock
 });
 assert.equal(r.verified,false);
});
test('different key and fingerprint rejected',()=>{
 const other=generateKeyPairSync('ed25519');
 const r=verify(claims,{serverPinnedPublicKey:other.publicKey});
 assert.equal(r.verified,false);
});
test('non Ed25519 public key rejected',()=>{
 const rsa=generateKeyPairSync('rsa',{modulusLength:2048});
 const r=verify(claims,{serverPinnedPublicKey:rsa.publicKey});
 assert.equal(r.verified,false);
});
test('valid signer cannot use an untrusted Owner subject',()=>{
 const r=verify(claims,{expectedOwnerSubject:'owner:another-real-owner'});
 assert.equal(r.verified,false);
 assert.equal(r.canIssueAttempt,false);
});
test('missing trusted Owner mapping denies a valid signature',()=>{
 const r=verify(claims,{expectedOwnerSubject:null});
 assert.equal(r.verified,false);
});
test('reused attempt cannot be accepted even with valid signature',()=>{
 const r=verify(claims,{expectedOriginal:{...original,recoveryPreviouslyRequested:true}});
 assert.equal(r.verified,false);
});
test('missing server-pinned identity is rejected',()=>{
 const r=verify(claims,{serverPinnedPublicKey:null});
 assert.equal(r.verified,false);
});
test('no private keys, network, DB or dispatch in production verifier module',async()=>{
 const {readFile}=await import('node:fs/promises');
 const s=await readFile(new URL('./gpt02-task183-recovery-signature-gate.mjs',import.meta.url),'utf8');
 for(const term of ['generateKeyPair','sign(','createPrivateKey','new Pool','fetch(','http://','https://','INSERT INTO','ALTER ROLE'])
  assert.equal(s.includes(term),false,term);
});
