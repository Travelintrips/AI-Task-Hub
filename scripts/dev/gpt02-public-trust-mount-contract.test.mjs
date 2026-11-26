import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=new URL('../../',import.meta.url);
const read=async p=>readFile(new URL(p,root),'utf8');

test('DEV trust override mounts only public trust read-only',async()=>{
 const yml=await read('deploy/hostinger/docker-compose.development.trust.yml');
 assert.match(yml,/source: \$\{GPT02_PUBLIC_TRUST_DIR_HOST:-\/run\/credentials\/gpt02-dev\}/);
 assert.match(yml,/target: \/run\/credentials\/gpt02-dev/);
 assert.match(yml,/source: \$\{GPT02_PUBLIC_TRUST_CONFIG_DIR_HOST:-\/etc\/gpt02-dev\}/);
 assert.match(yml,/target: \/etc\/gpt02-dev/);
 assert.equal((yml.match(/read_only: true/g)||[]).length,2);
 for(const forbidden of ['credstore','private-key','pkcs8','/etc/ai-task','production.env'])
  assert.equal(yml.toLowerCase().includes(forbidden.toLowerCase()),false,forbidden);
});

test('deploy activates trust override only for explicit development opt-in',async()=>{
 const sh=await read('deploy/hostinger/deploy.sh');
 assert.match(sh,/\[ "\$TARGET" = "development" \]/);
 assert.match(sh,/GPT02_PUBLIC_TRUST_MOUNT_ENABLED:-false/);
 assert.match(sh,/docker-compose\.development\.trust\.yml/);
 assert.match(sh,/COMPOSE_FILES\+=\(-f "\$TRUST_OVERRIDE"\)/);
 assert.match(sh,/trust-fingerprints\.json/);
 assert.equal(sh.includes('/etc/credstore.encrypted'),false);
 assert.equal(sh.includes('private-key.pkcs8'),false);
 const syntax=spawnSync('bash',['-n',fileURLToPath(new URL('deploy/hostinger/deploy.sh',root))],{encoding:'utf8'});
 assert.equal(syntax.status,0,syntax.stderr||syntax.stdout);
});

test('development env defaults trust mount off and production example stays untouched',async()=>{
 const dev=await read('deploy/hostinger/compose.development.env.example');
 const prod=await read('deploy/hostinger/compose.production.env.example');
 assert.match(dev,/^GPT02_PUBLIC_TRUST_MOUNT_ENABLED=false$/m);
 assert.match(dev,/^GPT02_PUBLIC_TRUST_DIR_HOST=\/run\/credentials\/gpt02-dev$/m);
 assert.match(dev,/^GPT02_PUBLIC_TRUST_CONFIG_DIR_HOST=\/etc\/gpt02-dev$/m);
 assert.equal(prod.includes('GPT02_PUBLIC_TRUST_MOUNT_ENABLED'),false);
 assert.equal(prod.includes('GPT02_PUBLIC_TRUST_DIR_HOST'),false);
 assert.equal(prod.includes('GPT02_PUBLIC_TRUST_CONFIG_DIR_HOST'),false);
});

test('mount contract cannot grant signer or dispatch authority',async()=>{
 const all=[
  await read('deploy/hostinger/docker-compose.development.trust.yml'),
  await read('deploy/hostinger/deploy.sh'),
  await read('deploy/hostinger/compose.development.env.example')
 ].join('\n');
 for(const forbidden of [
  'GPT02_ISSUE159_APPROVAL_PRIVATE',
  'GPT02_ISSUE159_HUB_PRIVATE',
  'GPT02_ISSUE159_CORE_PRIVATE',
  'GPT02_ISSUE159_ISSUER_PRIVATE',
  'SIGNING_ENABLED=true',
  'DISPATCH_ENABLED=true'
 ]) assert.equal(all.includes(forbidden),false,forbidden);
});

test('DEV health success also requires four pinned Ed25519 public roots inside the container',async()=>{
 const sh=await read('deploy/hostinger/deploy.sh');
 const healthy=sh.indexOf('if [ "$status" = "healthy" ]; then');
 const verify=sh.indexOf('GPT02_TRUST_VERIFY_JS');
 assert.ok(healthy>=0&&verify>healthy,'mount verifier must run after DEV health check');
 assert.match(sh,/docker exec -i "\$CONTAINER_NAME" node - <<'GPT02_TRUST_VERIFY_JS'/);
 assert.match(sh,/GPT02_DEV_PUBLIC_TRUST_VERIFIED_FOUR_ROOTS_NO_DISPATCH/);
 assert.match(sh,/GPT02 DEV public trust verification failed; deployment remains NO-GO/);
 const extracted=sh.match(/<<'GPT02_TRUST_VERIFY_JS'\n([\s\S]*?)\nGPT02_TRUST_VERIFY_JS/);
 assert.ok(extracted,'exact runtime verifier heredoc present');
 const script=extracted[1];
 const {Script}=await import('node:vm');
 assert.doesNotThrow(()=>new Script(script),'runtime JS syntax');
 for(const required of [
  'crypto.createPublicKey','asymmetricKeyType !== "ed25519"',
  'createHash("sha256")','type: "spki"','new Set(fingerprints).size !== 4',
  'PUBLIC_TRUST_FINGERPRINT_MISMATCH','PUBLIC_TRUST_UNEXPECTED_FILES',
  'process.getuid()','process.exitCode = 2'
 ]) assert.ok(script.includes(required),required);
 for(const forbidden of [
  'createPrivateKey','private-key','pkcs8','sign(',
  'fetch(','http://','https://','dispatchPermitted:true'
 ]) assert.equal(script.includes(forbidden),false,forbidden);
});

test('exact deployment verifier passes and fails closed on synthetic roots without real secrets',async()=>{
 const source=await read('deploy/hostinger/deploy.sh');
 const match=source.match(/<<'GPT02_TRUST_VERIFY_JS'\n([\s\S]*?)\nGPT02_TRUST_VERIFY_JS/);
 assert.ok(match);
 const js=match[1];
 const {runInNewContext}=await import('node:vm');
 const {generateKeyPairSync,createHash,createPublicKey}=await import('node:crypto');
 const dir='/run/credentials/gpt02-dev';
 const manifestPath='/etc/gpt02-dev/trust-fingerprints.json';
 const names={
  approval:'approval-public.pem',hub:'hub-identity-public.pem',
  core:'core-identity-public.pem',issuer:'issuer-public.pem'
 };
 const keys={};
 const pins={};
 for(const [role,filename] of Object.entries(names)){
  const key=generateKeyPairSync('ed25519').publicKey;
  keys[dir+'/'+filename]=key.export({format:'pem',type:'spki'}).toString();
  pins[role]=createHash('sha256')
   .update(key.export({format:'der',type:'spki'})).digest('hex');
 }
 const makeStat=(kind,uid,mode)=>({
  uid,mode,nlink:1,isSymbolicLink:()=>false,
  isDirectory:()=>kind==='dir',isFile:()=>kind==='file'
 });
 function execute({wrongFingerprint=false,unexpectedFile=false,wrongKeyOwner=false}={}){
  const expected={...pins};
  if(wrongFingerprint)expected.issuer='0'.repeat(64);
  const fs={
   lstatSync(path){
    if(path===dir)return makeStat('dir',1000,0o40700);
    if(path===manifestPath)return makeStat('file',0,0o100644);
    if(Object.hasOwn(keys,path))
     return makeStat('file',wrongKeyOwner?0:1000,0o100600);
    throw Error('UNEXPECTED_PATH');
   },
   readdirSync(path){
    assert.equal(path,dir);
    return unexpectedFile?[...Object.values(names),'private-key.pkcs8']:
     Object.values(names);
   },
   readFileSync(path){
    if(path===manifestPath)return JSON.stringify(expected);
    if(Object.hasOwn(keys,path))return keys[path];
    throw Error('UNEXPECTED_READ');
   }
  };
  const processStub={getuid:()=>1000,exitCode:0};
  const logs=[],errors=[];
  runInNewContext(js,{
   require(name){
    if(name==='node:fs')return fs;
    if(name==='node:crypto')return {createHash,createPublicKey};
    throw Error('UNEXPECTED_REQUIRE');
   },
   process:processStub,
   console:{log:(m)=>logs.push(String(m)),error:(m)=>errors.push(String(m))}
  },{timeout:2000});
  return {code:processStub.exitCode,logs,errors};
 }
 const pass=execute();
 assert.equal(pass.code,0);
 assert.deepEqual(pass.logs,['GPT02_DEV_PUBLIC_TRUST_VERIFIED_FOUR_ROOTS_NO_DISPATCH']);
 assert.deepEqual(pass.errors,[]);
 for(const [caseName,input,reason] of [
  ['wrong fingerprint',{wrongFingerprint:true},'PUBLIC_TRUST_FINGERPRINT_MISMATCH'],
  ['unexpected private-looking file',{unexpectedFile:true},'PUBLIC_TRUST_UNEXPECTED_FILES'],
  ['wrong key owner',{wrongKeyOwner:true},'PUBLIC_TRUST_KEY_FILE_UNSAFE']
 ]){
  const failed=execute(input);
  assert.equal(failed.code,2,caseName);
  assert.deepEqual(failed.logs,[],caseName);
  assert.ok(failed.errors.some(e=>e.includes(reason)),caseName);
 }
});
