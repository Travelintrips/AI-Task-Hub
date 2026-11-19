import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,chmodSync,symlinkSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {corePreparationPoolConfigFromFiles,createCoreTaskPreparer} from '../src/lib/gpt02-core-task-preparation.mjs';
const ref='xssrfshdrtdfupgqwfdw', dir=mkdtempSync(join(tmpdir(),'gpt02-prep-files-'));
const env={NODE_ENV:'development',APP_ENV:'development',GPT02_CORE_PREP_DEV_PROJECT_REF:ref,
 GPT02_HUB_DEV_PROJECT_REF:ref,GPT02_PROD_PROJECT_REF:'nzdweipzckfszczzqtuw',
 GPT02_CORE_PREP_DEV_POOLER_HOST:'aws-1-ap-southeast-2.pooler.supabase.com'};
const ca=readFileSync(new URL('../../../scripts/dev/fixtures/supabase-root-ca-2021.crt',import.meta.url),'utf8');
const dsn=`postgresql://gpt02_core_prep_login.${ref}:SYNTHETIC_ONLY@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres`;
function put(name,value,mode=0o600){writeFileSync(join(dir,name),value,{mode,flag:'w'});chmodSync(join(dir,name),mode)}
function run(v=env){return corePreparationPoolConfigFromFiles(v,{synthetic:true,testDirectory:dir})}
test.after(()=>rmSync(dir,{recursive:true,force:true}));
test('missing credential files fail closed',()=>assert.throws(()=>run(),{code:'PREPARER_CREDENTIAL_FILE_REQUIRED'}));
test('separate restricted fixture files allow only pinned DEV preparer',()=>{
 put('preparer-dsn',dsn);put('supabase-root-ca.crt',ca);
 const c=run();assert.equal(c.max,1);assert.equal(c.ssl.rejectUnauthorized,true);assert.equal(c.application_name,'gpt02-core-preparation-DEV-only');
});
test('inline credentials are rejected even with valid restricted files',()=>assert.throws(()=>run({...env,GPT02_CORE_PREP_DATABASE_URL_DEV:dsn}),{code:'PREPARER_INLINE_CREDENTIAL_FORBIDDEN'}));
test('group or world readability is rejected',()=>{
 chmodSync(join(dir,'preparer-dsn'),0o644);
 assert.throws(()=>run(),{code:'PREPARER_CREDENTIAL_FILE_SECURITY_INVALID'});
 chmodSync(join(dir,'preparer-dsn'),0o600);
});
test('symlink is rejected',()=>{
 rmSync(join(dir,'preparer-dsn'));symlinkSync(join(dir,'supabase-root-ca.crt'),join(dir,'preparer-dsn'));
 assert.throws(()=>run(),{code:'PREPARER_CREDENTIAL_FILE_SECURITY_INVALID'});
 rmSync(join(dir,'preparer-dsn'));put('preparer-dsn',dsn);
});
test('wrong database role fails closed',()=>{
 put('preparer-dsn',dsn.replace('gpt02_core_prep_login','postgres'));
 assert.throws(()=>run(),{code:'PREPARER_DSN_SCOPE_MISMATCH'});
 put('preparer-dsn',dsn);
});
test('wrong project and non-DEV mode fail closed',()=>{
 assert.throws(()=>run({...env,GPT02_HUB_DEV_PROJECT_REF:'z'.repeat(20)}),{code:'PINNED_CST_DEV_PROJECT_REQUIRED'});
 assert.throws(()=>run({...env,NODE_ENV:'production'}),{code:'EXPLICIT_SECURE_DEV_REQUIRED'});
});
test('normal runtime with absent locked systemd credential directory fails closed',()=>assert.throws(()=>corePreparationPoolConfigFromFiles(env),{code:'PREPARER_CREDENTIAL_FILE_REQUIRED'}));

test('official factory in systemd mode rejects absent secret before pool creation',()=>{
 let constructed=false;class Pool{constructor(){constructed=true}}
 assert.throws(()=>createCoreTaskPreparer({env:{...env,GPT02_CORE_PREP_CREDENTIAL_SOURCE:'systemd'},PoolClass:Pool}),
   {code:'PREPARER_CREDENTIAL_FILE_REQUIRED'});
 assert.equal(constructed,false);
});