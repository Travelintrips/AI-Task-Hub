import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {canonicalDevCheckpointReceipt,verifyDevCheckpointReceipt} from '../src/lib/dev-checkpoint-crypto.ts';
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const publicKeyDerBase64=publicKey.export({format:'der',type:'spki'}).toString('base64');
const unsigned={version:1,jobId:'job-1',commandId:'cmd-1',correlationId:'corr-1',checkpointId:'cp-1',sopVersion:'sop-v1',nextStepId:'step-2',issuedAt:'2026-10-27T08:00:00.000Z'};
const receipt={...unsigned,signature:sign(null,Buffer.from(canonicalDevCheckpointReceipt(unsigned)),privateKey).toString('base64')};
test('accepts real Ed25519 receipt',()=>assert.equal(verifyDevCheckpointReceipt(receipt,publicKeyDerBase64),true));
test('rejects altered next step and job identity',()=>{
  assert.equal(verifyDevCheckpointReceipt({...receipt,nextStepId:'step-3'},publicKeyDerBase64),false);
  assert.equal(verifyDevCheckpointReceipt({...receipt,jobId:'job-2'},publicKeyDerBase64),false);
});
test('rejects forged signatures and missing trusted key',()=>{
 assert.equal(verifyDevCheckpointReceipt({...receipt,signature:'A'.repeat(88)},publicKeyDerBase64),false);
 assert.equal(verifyDevCheckpointReceipt(receipt,undefined),false);
});
