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
