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
