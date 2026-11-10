import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,mkdirSync,writeFileSync,chmodSync,symlinkSync,linkSync,readFileSync,rmSync
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {loadGpt02DevTrustManifest} from '../src/lib/gpt02-dev-trust-manifest.mjs';

const uid=typeof process.getuid==='function'?process.getuid():0;
const pins=()=>({
 approval:'a'.repeat(64),
 hub:'b'.repeat(64),
 core:'c'.repeat(64),
 issuer:'d'.repeat(64)
});
function fixture(){
 const base=mkdtempSync(join(tmpdir(),'gpt02-manifest-'));
 const dir=join(base,'etc-gpt02-dev');
 mkdirSync(dir,{mode:0o700});
 const path=join(dir,'trust-fingerprints.json');
 writeFileSync(path,JSON.stringify(pins())+'\n',{mode:0o400});
 return {base,dir,path};
}
const clean=x=>rmSync(x.base,{recursive:true,force:true});

test('loads exact four distinct fingerprints from a restricted manifest',()=>{
 const x=fixture();
 try{
  const v=loadGpt02DevTrustManifest({path:x.path,ownerUid:uid});
  assert.equal(v.environment,'DEV');
  assert.equal(v.source,'root-owned-fixed-manifest');
  assert.deepEqual(v.fingerprints,pins());
 }finally{clean(x)}
});

for(const [label,mutate,code] of [
 ['duplicate fingerprint',p=>({...p,issuer:p.hub}),'TRUST_FINGERPRINT_MANIFEST_INVALID'],
 ['missing fingerprint',p=>{const {issuer,...rest}=p;return rest;},'TRUST_FINGERPRINT_MANIFEST_INVALID'],
 ['extra field',p=>({...p,extra:'e'.repeat(64)}),'TRUST_FINGERPRINT_MANIFEST_INVALID'],
 ['uppercase fingerprint',p=>({...p,approval:'A'.repeat(64)}),'TRUST_FINGERPRINT_MANIFEST_INVALID']
])test('rejects '+label,()=>{
 const x=fixture();
 try{
  writeFileSync(x.path,JSON.stringify(mutate(pins()))+'\n',{mode:0o400});
  assert.throws(()=>loadGpt02DevTrustManifest({path:x.path,ownerUid:uid}),e=>e.code===code);
 }finally{clean(x)}
});

test('rejects group/world-writable manifest directory',()=>{
 const x=fixture();
 try{
  chmodSync(x.dir,0o720);
  assert.throws(()=>loadGpt02DevTrustManifest({path:x.path,ownerUid:uid}),
    e=>e.code==='TRUST_MANIFEST_DIRECTORY_UNSAFE');
 }finally{clean(x)}
});

test('rejects group/world-writable manifest file',()=>{
 const x=fixture();
 try{
  chmodSync(x.path,0o620);
  assert.throws(()=>loadGpt02DevTrustManifest({path:x.path,ownerUid:uid}),
    e=>e.code==='TRUST_MANIFEST_FILE_UNSAFE');
 }finally{clean(x)}
});

test('rejects symlink and hardlink manifest substitution',()=>{
 const x=fixture();
 try{
  const target=join(x.dir,'target.json');
  const sym=join(x.dir,'sym.json');
  const hard=join(x.dir,'hard.json');
  writeFileSync(target,JSON.stringify(pins())+'\n',{mode:0o400});
  symlinkSync(target,sym);
  linkSync(target,hard);
  assert.throws(()=>loadGpt02DevTrustManifest({path:sym,ownerUid:uid}),
    e=>e.code==='TRUST_MANIFEST_FILE_UNAVAILABLE');
  assert.throws(()=>loadGpt02DevTrustManifest({path:hard,ownerUid:uid}),
    e=>e.code==='TRUST_MANIFEST_FILE_UNSAFE');
 }finally{clean(x)}
});

test('operational DEV cannot redirect the fixed manifest path',()=>{
 const moduleUrl=new URL('../src/lib/gpt02-dev-trust-manifest.mjs',import.meta.url).href;
 const subprocess=`
  import {loadGpt02DevTrustManifest} from ${JSON.stringify(moduleUrl)};
  try{
    loadGpt02DevTrustManifest({path:'/tmp/attacker-manifest.json',ownerUid:0});
    process.stdout.write('UNEXPECTED_PASS');
  }catch(e){process.stdout.write(e.code||e.message);}
 `;
 const out=spawnSync(process.execPath,['--input-type=module','-e',subprocess],{
  encoding:'utf8',env:{...process.env,NODE_ENV:'development',APP_ENV:'development'},timeout:5000
 });
 assert.equal(out.status,0,out.stderr);
 assert.equal(out.stdout,'GPT02_FIXED_DEV_TRUST_MANIFEST_REQUIRED');
});

test('manifest loader contains no signing, private-key, database, network or dispatch capability',()=>{
 const c=readFileSync(new URL('../src/lib/gpt02-dev-trust-manifest.mjs',import.meta.url),'utf8');
 for(const bad of ['privateKey','sign(', 'new Pool','db.query','fetch(', 'sendCommand',
  'dispatchCommand','INSERT INTO','UPDATE ','DELETE FROM','ALTER ROLE'])
  assert.equal(c.includes(bad),false,bad);
});
