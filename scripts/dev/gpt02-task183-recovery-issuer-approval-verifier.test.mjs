import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {canonicalIssuerRecoveryApproval,verifyIssuerRecoveryApproval,
 RECOVERY_ISSUER_APPROVAL_DOMAIN} from './gpt02-task183-recovery-issuer-approval-verifier.mjs';
const NOW=1795269500000;
const facts={
 requestId:'6bcd8419254dc21c0b149eb09e68a7b6da66',
 evidenceSha256:'89950d3b8ac91aac612810325c6a219cb898a6fa41b234a477f0dbe32d85eb7b',
 coreTaskId:'faf682ad-d8e8-4888-95bc-e2e32ea13e92',
 hubExecutionId:'96459064-0231-4d38-889b-419d7df52764',
 attemptId:'8f5ab85a-8300-4118-a14c-5fc701ae5a7c',
 ownerSubject:'owner:synthetic-owner-fixture',
 superAdminIntentRecorded:true,nonceAlreadyConsumed:false
};
const claims={
 version:1,environment:'DEV',audience:RECOVERY_ISSUER_APPROVAL_DOMAIN,
 companyId:'default',hubTaskId:183,recoveryAttemptNumber:2,
 requestId:facts.requestId,evidenceSha256:facts.evidenceSha256,
 originalCoreTaskId:facts.coreTaskId,originalHubExecutionId:facts.hubExecutionId,
 originalAttemptId:facts.attemptId,ownerSubject:facts.ownerSubject,
 nonce:'A'.repeat(44),issuedAt:NOW-10000,expiresAt:NOW+100000,
 purpose:'PREPARE_ATTEMPT2_ONLY',dispatchPermitted:false
};
const keys=generateKeyPairSync('ed25519');
const trustedSha=createHash('sha256').update(keys.publicKey.export({format:'der',type:'spki'})).digest('hex');
const signClaims=c=>sign(null,Buffer.from(canonicalIssuerRecoveryApproval(c)),
 keys.privateKey).toString('base64url');
const signature=signClaims(claims);
const call=(c=claims,extra={})=>verifyIssuerRecoveryApproval({
 claims:c,signatureBase64url:signClaims(c),pinnedOwnerPublicKey:keys.publicKey,
 pinnedOwnerSpkiSha256:trustedSha,trustedFacts:facts,now:NOW,...extra
});
test('synthetic Owner signature verifies but grants zero operational permission',()=>{
 const v=call();assert.equal(v.verified,true);
 assert.equal(v.reason,'CRYPTOGRAPHICALLY_VALID_NOT_PERSISTED');
 assert.equal(v.approvalDigest.length,64);
 for(const x of ['ownerApprovalPersisted','issuerAuthorized','attemptIssued','dispatchPermitted'])
  assert.equal(v[x],false,x);
 assert.equal(v.nonceIssuerConsumed,false);
});
const negatives=[
 ['foreign tenant',{companyId:'other'}],
 ['wrong task',{hubTaskId:184}],
 ['attempt 3',{recoveryAttemptNumber:3}],
 ['production',{environment:'PROD'}],
 ['legacy Issue159 domain',{audience:'GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL'}],
 ['review-only signing domain',{audience:'GPT02_TASK183_EXPIRED_PREPARATION_RECOVERY_REVIEW_V1'}],
 ['changed Core',{originalCoreTaskId:'11111111-1111-4111-8111-111111111111'}],
 ['changed Hub',{originalHubExecutionId:'11111111-1111-4111-8111-111111111111'}],
 ['changed attempt',{originalAttemptId:'11111111-1111-4111-8111-111111111111'}],
 ['changed request',{requestId:'0'.repeat(36)}],
 ['changed SHA',{evidenceSha256:'f'.repeat(64)}],
 ['changed Owner',{ownerSubject:'owner:other-person'}],
 ['changed nonce',{nonce:'bad'}],
 ['dispatch flag',{dispatchPermitted:true}],
 ['incorrect purpose',{purpose:'DISPATCH'}],
 ['expired',{expiresAt:NOW-1}],
 ['issued too far in future',{issuedAt:NOW+40000}],
 ['too-long lease',{expiresAt:NOW+400000}]
];
for(const [name,patch] of negatives){
 test('deny '+name,()=>{
   const out=call({...claims,...patch});
   assert.equal(out.verified,false,name);
   assert.equal(out.issuerAuthorized,false);
 });
}
test('deny unknown extra field',()=>{
 const out=verifyIssuerRecoveryApproval({claims:{...claims,force:true},signatureBase64url:signature,
 pinnedOwnerPublicKey:keys.publicKey,pinnedOwnerSpkiSha256:trustedSha,trustedFacts:facts,now:NOW});
 assert.equal(out.verified,false);
});
test('deny missing claim',()=>{
 const c={...claims};delete c.hubTaskId;
 const out=verifyIssuerRecoveryApproval({claims:c,signatureBase64url:signature,
 pinnedOwnerPublicKey:keys.publicKey,pinnedOwnerSpkiSha256:trustedSha,trustedFacts:facts,now:NOW});
 assert.equal(out.verified,false);
});
test('deny valid signature without independently verified Owner identity',()=>{
 assert.equal(call(claims,{trustedFacts:{...facts,ownerSubject:'owner:not-the-same'}}).verified,false);
});
test('deny intent not recorded in trusted readback',()=>{
 assert.equal(call(claims,{trustedFacts:{...facts,superAdminIntentRecorded:false}}).verified,false);
});
test('deny consumed issuer nonce',()=>{
 assert.equal(call(claims,{trustedFacts:{...facts,nonceAlreadyConsumed:true}}).verified,false);
});
test('deny forged signature',()=>{
 const other=generateKeyPairSync('ed25519');
 const forged=sign(null,Buffer.from(canonicalIssuerRecoveryApproval(claims)),other.privateKey).toString('base64url');
 assert.equal(call(claims,{signatureBase64url:forged}).verified,false);
});
test('deny mutated payload using original valid signature',()=>{
 assert.equal(call({...claims,nonce:'B'.repeat(44)},{signatureBase64url:signature}).verified,false);
});
test('deny unpinned public key',()=>{
 const other=generateKeyPairSync('ed25519');
 assert.equal(call(claims,{pinnedOwnerPublicKey:other.publicKey}).verified,false);
});
test('deny revoked or missing pinned fingerprint',()=>{
 assert.equal(call(claims,{pinnedOwnerSpkiSha256:undefined}).verified,false);
});
test('deny RSA key',()=>{
 const rsa=generateKeyPairSync('rsa',{modulusLength:2048});
 assert.equal(call(claims,{pinnedOwnerPublicKey:rsa.publicKey}).verified,false);
});
test('no private keys/network/database/mutation inside verifier',async()=>{
 const src=await readFile(new URL('./gpt02-task183-recovery-issuer-approval-verifier.mjs',import.meta.url),'utf8');
 for(const f of ['generateKeyPair','createPrivateKey','sign(','new Pool','fetch(','http://',
 'https://','INSERT INTO','dispatchAllowed:true','grantRole'])
 assert.equal(src.includes(f),false,f);
});
