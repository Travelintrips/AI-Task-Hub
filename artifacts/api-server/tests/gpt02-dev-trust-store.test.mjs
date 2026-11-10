import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,chmodSync,rmSync,readFileSync,renameSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadGpt02DevTrustStore} from '../src/lib/gpt02-dev-trust-store.mjs';

const files={approval:'approval-public.pem',hub:'hub-identity-public.pem',
 core:'core-identity-public.pem',issuer:'issuer-public.pem'};
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'gpt02-trust-fixture-'));
 chmodSync(dir,0o700);
 const pins={},publicKeys={};
 for(const [name,file] of Object.entries(files)){
  const {publicKey}=generateKeyPairSync('ed25519');
  const pem=publicKey.export({type:'spki',format:'pem'}).toString();
  const digest=createHash('sha256').update(publicKey.export({type:'spki',format:'der'})).digest('hex');
  pins[name]=digest;publicKeys[name]=pem;
  writeFileSync(join(dir,file),pem,{mode:0o600});
 }
 return {dir,pins,publicKeys,cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}
const load=x=>loadGpt02DevTrustStore({root:x.dir,expectedFingerprints:x.pins});
function expectedError(fn,code){
 assert.throws(fn,e=>e?.code===code,code);
}
test('four independently pinned public keys are loaded, but can never grant dispatch',()=>{
 const x=fixture();try{
  const result=load(x);
  assert.equal(Object.isFrozen(result),true);
  assert.deepEqual(result.metadata.fingerprints,x.pins);
  assert.equal(result.approvalPublicKeyPem,x.publicKeys.approval);
  assert.equal(result.hubPublicKeyPem,x.publicKeys.hub);
  assert.equal(result.corePublicKeyPem,x.publicKeys.core);
  assert.equal(result.issuerPublicKeyPem,x.publicKeys.issuer);
  assert.equal(result.dispatchPermitted,false);
  assert.equal(result.issuerLeaseGranted,false);
 }finally{x.cleanup()}
});
test('a missing manifest and unknown or duplicated signer role is never trusted',()=>{
 const x=fixture();try{
  expectedError(()=>loadGpt02DevTrustStore({root:x.dir}),'TRUST_MANIFEST_DIRECTORY_NOT_FOUND');
  expectedError(()=>loadGpt02DevTrustStore({root:x.dir,expectedFingerprints:{...x.pins,extra:'x'}}),
   'TRUST_FINGERPRINT_MANIFEST_INVALID');
  expectedError(()=>loadGpt02DevTrustStore({root:x.dir,expectedFingerprints:{...x.pins,issuer:x.pins.hub}}),
   'TRUST_FINGERPRINT_MANIFEST_INVALID');
 }finally{x.cleanup()}
});
test('a swapped or unauthorized signing public key is detected by immutable fingerprint',()=>{
 const x=fixture();try{
  const {publicKey}=generateKeyPairSync('ed25519');
  writeFileSync(join(x.dir,files.issuer),publicKey.export({type:'spki',format:'pem'}),{mode:0o600});
  expectedError(()=>load(x),'TRUST_FINGERPRINT_MISMATCH');
 }finally{x.cleanup()}
});
test('trust directory is private and file permissions cannot be group/world readable',()=>{
 const x=fixture();try{
  chmodSync(x.dir,0o755);
  expectedError(()=>load(x),'TRUST_STORE_DIRECTORY_UNSAFE');
  chmodSync(x.dir,0o700);
  chmodSync(join(x.dir,files.approval),0o644);
  expectedError(()=>load(x),'TRUST_PUBLIC_KEY_FILE_UNSAFE');
 }finally{x.cleanup()}
});
test('symlinked public key file cannot be loaded despite valid PEM and digest',()=>{
 const x=fixture();try{
  renameSync(join(x.dir,files.core),join(x.dir,'core-real.pem'));
  symlinkSync(join(x.dir,'core-real.pem'),join(x.dir,files.core));
  expectedError(()=>load(x),'TRUST_PUBLIC_KEY_UNAVAILABLE');
 }finally{x.cleanup()}
});
test('missing file and private key content are rejected without leaking file content',()=>{
 const x=fixture();try{
  const path=join(x.dir,files.hub);
  unlinkSync(path);
  expectedError(()=>load(x),'TRUST_PUBLIC_KEY_UNAVAILABLE');
  const {privateKey}=generateKeyPairSync('ed25519');
  writeFileSync(path,privateKey.export({type:'pkcs8',format:'pem'}).toString(),{mode:0o600});
  expectedError(()=>load(x),'TRUST_PUBLIC_KEY_FORMAT_REJECTED');
 }finally{x.cleanup()}
});
test('four physically duplicated keys are disallowed even if manifest is forged',()=>{
 const x=fixture();try{
  writeFileSync(join(x.dir,files.issuer),x.publicKeys.hub,{mode:0o600});
  expectedError(()=>load(x),'TRUST_FINGERPRINT_MISMATCH');
 }finally{x.cleanup()}
});
test('source has no signing, secret logging, network or worker-dispatch code',()=>{
 const src=readFileSync(new URL('../src/lib/gpt02-dev-trust-store.mjs',import.meta.url),'utf8');
 for(const absent of ['privateKey','sign(', 'db.query','new Pool','fetch(', 'submitAiTask','dispatchCommand','sendCommand','ALTER ROLE','GRANT EXECUTE']){
  assert.equal(src.includes(absent),false,absent);
 }
});
