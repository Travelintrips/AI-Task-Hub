import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,chmodSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {corePreparationPoolConfigFromFiles,corePreparationPoolConfigFromDockerReadonlyFiles,createCoreTaskPreparer} from '../src/lib/gpt02-core-task-preparation.mjs';

const ref='xssrfshdrtdfupgqwfdw';
const host='aws-1-ap-southeast-2.pooler.supabase.com';
const goodDsn=`postgresql://gpt02_core_prep_login.${ref}:SYNTHETIC_NOT_A_SECRET@${host}:5432/postgres`;
const ca=readFileSync(new URL('../../../scripts/dev/fixtures/supabase-root-ca-2021.crt',import.meta.url),'utf8');
const env=Object.freeze({APP_ENV:'development',NODE_ENV:'development',
 GPT02_CORE_PREP_DEV_PROJECT_REF:ref,GPT02_HUB_DEV_PROJECT_REF:ref,
 GPT02_PROD_PROJECT_REF:'nzdweipzckfszczzqtuw',
 GPT02_CORE_PREP_DEV_POOLER_HOST:host});
function fixture(t, dsn=goodDsn, cert=ca){
 const directory=mkdtempSync(path.join(tmpdir(),'task183-prep-'));chmodSync(directory,0o700);
 const ds=path.join(directory,'preparer-dsn'),root=path.join(directory,'supabase-root-ca.crt');
 writeFileSync(ds,dsn,{mode:0o600}); writeFileSync(root,cert,{mode:0o600});
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 return {directory,ds,root};
}
function call(e,directory){return corePreparationPoolConfigFromFiles(e,{synthetic:true,testDirectory:directory});}

test('custody-only synthetic fixture has exactly the pinned CST-DEV identity and no extra privilege',t=>{
 const {directory}=fixture(t);
 const c=call(env,directory);
 assert.equal(c.max,1);assert.equal(c.ssl.rejectUnauthorized,true);
 assert.equal(c.application_name,'gpt02-core-preparation-DEV-only');
 assert.equal(new URL(c.connectionString).username,`gpt02_core_prep_login.${ref}`);
});
test('file custody refuses inline API secrets and foreign PROD/tenant host',t=>{
 const {directory}=fixture(t);
 for(const patch of [{GPT02_CORE_PREP_DATABASE_URL_DEV:goodDsn},{GPT02_CORE_PREP_DEV_CA:ca},
  {NODE_ENV:'production'},{GPT02_CORE_PREP_DEV_PROJECT_REF:'nzdweipzckfszczzqtuw'},
  {GPT02_CORE_PREP_DEV_POOLER_HOST:'localhost'}, {NODE_TLS_REJECT_UNAUTHORIZED:'0'}])
  assert.throws(()=>call({...env,...patch},directory));
});
test('file custody refuses wrong role, wrong port, query string and nonpinned CA',t=>{
 for(const [dsn,cert] of [[goodDsn.replace('gpt02_core_prep_login','postgres'),ca],
  [goodDsn.replace(':5432',':6543'),ca],
  [goodDsn+'?sslmode=disable',ca],
  [goodDsn,'-----BEGIN CERTIFICATE-----\\nsynthetic\\n-----END CERTIFICATE-----']]){
   const {directory}=fixture(t,dsn,cert);
   assert.throws(()=>call(env,directory));
 }
});
test('file custody refuses world-readable and symlink credential files',t=>{
 const {directory,ds,root}=fixture(t);
 chmodSync(ds,0o644);assert.throws(()=>call(env,directory));
 chmodSync(ds,0o600);rmSync(root);symlinkSync(ds,root);
 assert.throws(()=>call(env,directory));
});
test('operational directory is fixed and synthetic helper cannot silently override it',t=>{
 const {directory}=fixture(t);
 assert.throws(()=>corePreparationPoolConfigFromFiles(env,{testDirectory:directory}));
 assert.throws(()=>corePreparationPoolConfigFromFiles({...env,NODE_ENV:'production'}, {synthetic:true,testDirectory:directory}));
});
test('custody service is disabled and network isolated; never a task writer',()=>{
 const unit=readFileSync(new URL('../../../deploy/systemd/gpt02-core-preparer.service',import.meta.url),'utf8');
 for(const text of ['RefuseManualStart=yes','PrivateNetwork=yes','Type=oneshot',
  'NoNewPrivileges=yes','LoadCredentialEncrypted=preparer-dsn:',
  'ConditionPathExists=/opt/ai-task-gpt02-preparer/current/scripts/dev/gpt02-preparer-custody-only.mjs'])
   assert.ok(unit.includes(text),text);
 assert.doesNotMatch(unit,/Restart=always|WantedBy=/);
 const source=readFileSync(new URL('../../../scripts/dev/gpt02-preparer-custody-only.mjs',import.meta.url),'utf8');
 assert.match(source,/corePreparationPoolConfigFromFiles/);
 assert.match(source,/databaseConnectionAttempted:false/);
 assert.match(source,/preparationAttempted:false/);
 assert.match(source,/dispatchPermitted:false/);
});

test('live preparation flag refuses legacy inline credentials before a database pool exists',()=>{
 let created=0;
 class Pool { constructor(){created++} }
 const candidate={...env,GPT02_CORE_PREPARATION_ENABLED:'true',
   GPT02_CORE_PREP_DATABASE_URL_DEV:goodDsn,GPT02_CORE_PREP_DEV_CA:ca};
 assert.throws(()=>createCoreTaskPreparer({env:candidate,PoolClass:Pool}),
   e=>e.code==='PREPARER_FILE_CUSTODY_REQUIRED');
 assert.equal(created,0);
});
test('file-custody live mode refuses missing host credentials without constructing a pool',()=>{
 let created=0;
 class Pool { constructor(){created++} }
 const candidate={...env,GPT02_CORE_PREPARATION_ENABLED:'true',
   GPT02_CORE_PREP_CREDENTIAL_SOURCE:'systemd'};
 assert.throws(()=>createCoreTaskPreparer({env:candidate,PoolClass:Pool}),
   e=>e.code==='PREPARER_CREDENTIAL_FILE_REQUIRED');
 assert.equal(created,0);
});


test('nonroot docker-readonly custody refuses missing RO bind mount before constructing a pool',()=>{
 let pools=0;
 class Pool{constructor(){pools++}}
 const config={...env,GPT02_CORE_PREPARATION_ENABLED:'true',
   GPT02_CORE_PREP_CREDENTIAL_SOURCE:'docker-readonly'};
 assert.throws(()=>createCoreTaskPreparer({env:config,PoolClass:Pool}),
   e=>e.code==='PREPARER_DOCKER_READONLY_MOUNT_REQUIRED'||
      e.code==='PREPARER_NONROOT_CONTAINER_REQUIRED');
 assert.equal(pools,0);
});

test('docker-readonly mode rejects any inline DSN or TLS override before filesystem access',()=>{
 const config={...env,GPT02_CORE_PREP_CREDENTIAL_SOURCE:'docker-readonly',
   GPT02_CORE_PREP_DATABASE_URL_DEV:goodDsn};
 assert.throws(()=>corePreparationPoolConfigFromDockerReadonlyFiles(config),
   e=>e.code==='PREPARER_INLINE_CREDENTIAL_FORBIDDEN');
});
