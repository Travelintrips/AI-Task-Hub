import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyFourSignerTrustReadiness} from './gpt02-four-signer-trust-readiness.mjs';

const fingerprints={
 approval:'a'.repeat(64),hub:'b'.repeat(64),core:'c'.repeat(64),issuer:'d'.repeat(64)
};
const manifest=()=>({environment:'DEV',source:'root-owned-fixed-manifest',fingerprints});
const store=()=>({
 metadata:{environment:'DEV',fingerprints},
 issuerLeaseGranted:false,dispatchPermitted:false
});

test('four independent public trust roots prove readiness only, never authority',()=>{
 const r=verifyFourSignerTrustReadiness({loadManifest:manifest,loadStore:store});
 assert.equal(r.manifestVerified,true);
 assert.equal(r.publicKeysVerified,true);
 assert.equal(r.independentSignerCount,4);
 assert.equal(r.reason,'FOUR_PUBLIC_TRUST_ROOTS_PASS_NO_AUTHORITY');
 assert.equal(r.dispatchPermitted,false);
 assert.equal(r.issuerLeaseGranted,false);
 assert.equal(r.releaseDecision,'NO_GO');
});

test('missing or invalid manifest fails before public-key trust',()=>{
 for(const loadManifest of [
  ()=>{throw Error('missing')},
  ()=>({environment:'PROD',source:'root-owned-fixed-manifest',fingerprints}),
  ()=>({environment:'DEV',source:'caller',fingerprints}),
  ()=>({environment:'DEV',source:'root-owned-fixed-manifest',fingerprints:{approval:'a'}})
 ]){
  let used=false;
  const r=verifyFourSignerTrustReadiness({loadManifest,loadStore:()=>{used=true;return store();}});
  assert.equal(r.manifestVerified,false);
  assert.equal(r.publicKeysVerified,false);
  assert.equal(used,false);
  assert.equal(r.dispatchPermitted,false);
 }
});

test('missing key mount, duplicate signer or wrong environment fails closed',()=>{
 for(const loadStore of [
  ()=>{throw Error('absent')},
  ()=>({metadata:{environment:'DEV',fingerprints:{...fingerprints,issuer:fingerprints.hub}},dispatchPermitted:false}),
  ()=>({metadata:{environment:'PROD',fingerprints},dispatchPermitted:false}),
  ()=>({metadata:{environment:'DEV',fingerprints},dispatchPermitted:true})
 ]){
  const r=verifyFourSignerTrustReadiness({loadManifest:manifest,loadStore});
  assert.equal(r.manifestVerified,true);
  assert.equal(r.publicKeysVerified,false);
  assert.equal(r.independentSignerCount,0);
  assert.equal(r.dispatchPermitted,false);
  assert.equal(r.releaseDecision,'NO_GO');
 }
});

test('output never exposes PEMs or full fingerprint values',()=>{
 const r=verifyFourSignerTrustReadiness({loadManifest:manifest,loadStore:store});
 const raw=JSON.stringify(r);
 for(const v of Object.values(fingerprints))assert.equal(raw.includes(v),false);
 assert.equal(raw.includes('BEGIN PUBLIC KEY'),false);
});

test('source contains no signing, DB, task creation or dispatch path',async()=>{
 const {readFile}=await import('node:fs/promises');
 const src=await readFile(new URL('./gpt02-four-signer-trust-readiness.mjs',import.meta.url),'utf8');
 for(const bad of ['createPrivateKey','generateKeyPair','new Pool','INSERT INTO','UPDATE ','DELETE FROM',
  'sendCommand','dispatchPermitted:true','taskCreated:true'])
  assert.equal(src.includes(bad),false,bad);
});
