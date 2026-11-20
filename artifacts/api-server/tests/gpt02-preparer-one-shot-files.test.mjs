import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,writeFileSync,readFileSync,chmodSync,symlinkSync,linkSync,
  rmSync
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {corePreparationPoolConfigFromOneShotFiles,createCoreTaskPreparer}
  from '../src/lib/gpt02-core-task-preparation.mjs';

const ref='xssrfshdrtdfupgqwfdw';
const dir=mkdtempSync(join(tmpdir(),'gpt02-task183-once-'));
const env={
 NODE_ENV:'development',APP_ENV:'development',GPT02_CORE_PREP_DEV_PROJECT_REF:ref,
 GPT02_HUB_DEV_PROJECT_REF:ref,GPT02_PROD_PROJECT_REF:'nzdweipzckfszczzqtuw',
 GPT02_CORE_PREP_DEV_POOLER_HOST:'aws-1-ap-southeast-2.pooler.supabase.com'
};
const ca=readFileSync(new URL('../../../scripts/dev/fixtures/supabase-root-ca-2021.crt',import.meta.url),'utf8');
const dsn='postgresql://gpt02_core_prep_login.'+ref+
  ':SYNTHETIC_ONLY@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres';
function put(name,value){
 chmodSync(dir,0o700);
 rmSync(join(dir,name),{force:true});
 writeFileSync(join(dir,name),value,{mode:0o400,flag:'wx'});
 chmodSync(join(dir,name),0o400);
 chmodSync(dir,0o500);
}
function synthetic(v=env){return corePreparationPoolConfigFromOneShotFiles(v,{
 synthetic:true,testDirectory:dir
})}
test.before(()=>{
 put('preparer-dsn',dsn);
 put('supabase-root-ca.crt',ca);
});
test.after(()=>{chmodSync(dir,0o700);rmSync(dir,{recursive:true,force:true})});

test('one-shot DEV scope accepts exactly dedicated file credentials and pinned TLS',()=>{
 const c=synthetic();
 assert.equal(c.max,1);assert.equal(c.ssl.rejectUnauthorized,true);
 assert.equal(c.application_name,'gpt02-core-preparation-DEV-only');
 assert.match(c.connectionString,/gpt02_core_prep_login/);
});
test('PROD and inline environment credentials are refused',()=>{
 for(const x of [
  {...env,NODE_ENV:'production'},
  {...env,APP_ENV:'production'},
  {...env,GPT02_CORE_PREP_DATABASE_URL_DEV:dsn},
  {...env,GPT02_CORE_PREP_DEV_CA:ca},
  {...env,NODE_TLS_REJECT_UNAUTHORIZED:'0'},
 ]){
  assert.throws(()=>synthetic(x));
 }
});
test('directory must have fixed safe mode and current UID',()=>{
 chmodSync(dir,0o700);
 assert.throws(()=>synthetic(),{code:'PREPARER_ONE_SHOT_CUSTODY_UNSAFE'});
 chmodSync(dir,0o500);
 assert.equal(synthetic().max,1);
});
test('world/group readable file cannot be loaded',()=>{
 chmodSync(join(dir,'preparer-dsn'),0o440);
 assert.throws(()=>synthetic(),{code:'PREPARER_ONE_SHOT_CUSTODY_UNSAFE'});
 chmodSync(join(dir,'preparer-dsn'),0o400);
});
test('symlink and hardlink are both rejected, without following aliases',()=>{
 chmodSync(dir,0o700);
 rmSync(join(dir,'preparer-dsn'));
 symlinkSync(join(dir,'supabase-root-ca.crt'),join(dir,'preparer-dsn'));
 chmodSync(dir,0o500);
 assert.throws(()=>synthetic(),{code:'PREPARER_ONE_SHOT_CUSTODY_UNSAFE'});
 put('preparer-dsn',dsn);
 chmodSync(dir,0o700);
 linkSync(join(dir,'preparer-dsn'),join(dir,'preparer-copy'));
 chmodSync(dir,0o500);
 assert.throws(()=>synthetic(),{code:'PREPARER_ONE_SHOT_CUSTODY_UNSAFE'});
 chmodSync(dir,0o700);
 rmSync(join(dir,'preparer-copy'));
 chmodSync(dir,0o500);
 assert.equal(synthetic().max,1);
});
test('different role, wrong tenant, and wrong pooler remain blocked',()=>{
 for(const text of [dsn.replace('gpt02_core_prep_login','postgres'),
  dsn.replace(ref,'f'.repeat(20)),
  dsn.replace('aws-1-ap-southeast-2','db')]){
  put('preparer-dsn',text);
  assert.throws(()=>synthetic());
 }
 put('preparer-dsn',dsn);
});
test('operational one-shot factory never falls back to host files, inline password, or root',()=>{
 let constructed=0;
 class Pool{constructor(){constructed++}}
 const v={...env,GPT02_CORE_PREP_CREDENTIAL_SOURCE:'dev-one-shot-mount'};
 assert.throws(()=>createCoreTaskPreparer({env:v,PoolClass:Pool}));
 assert.throws(()=>createCoreTaskPreparer({env:{
  ...v,GPT02_CORE_PREP_DATABASE_URL_DEV:dsn
 },PoolClass:Pool}));
 assert.equal(constructed,0);
});
