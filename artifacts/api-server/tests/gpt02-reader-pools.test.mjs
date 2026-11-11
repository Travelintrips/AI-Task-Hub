import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createGpt02ReaderPools} from '../src/lib/gpt02-reader-pools.mjs';

const host='aws-1-ap-southeast-2.pooler.supabase.com';
const ref='xssrfshdrtdfupgqwfdw';
const ca=readFileSync(new URL('../../../scripts/dev/fixtures/supabase-root-ca-2021.crt',import.meta.url),'utf8');
const dsn=(role,password='secret-value')=>
  `postgresql://${role}.${ref}:${password}@${host}:5432/postgres`;

class FakePool{
 constructor(config){this.config=config;}
}
function env(overrides={}){
 return {
  GPT02_HUB_READER_DATABASE_URL_DEV:dsn('gpt02_hub_evidence_reader','hub-secret'),
  GPT02_CORE_READER_DATABASE_URL_DEV:dsn('gpt02_core_evidence_reader','core-secret'),
  GPT02_READER_DEV_CA:ca,
  ...overrides
 };
}
function make(overrides={}){
 return createGpt02ReaderPools({
  env:env(),
  Pool:FakePool,
  nodeEnv:'test',
  appEnv:'development',
  ...overrides
 });
}

test('builds two distinct max-one DEV reader pools without exposing DSNs',async()=>{
 const v=make();
 assert.notEqual(v.hubPool,v.corePool);
 assert.equal(v.hubPool.config.max,1);
 assert.equal(v.corePool.config.max,1);
 assert.equal(v.hubPool.config.application_name,'gpt02-hub-evidence-reader');
 assert.equal(v.corePool.config.application_name,'gpt02-core-evidence-reader');
 assert.equal(v.hubPool.config.ssl.rejectUnauthorized,true);
 assert.equal(v.corePool.config.ssl.rejectUnauthorized,true);
 assert.equal(v.hubPool.config.ssl.ca,ca);
 assert.equal(v.corePool.config.ssl.ca,ca);
 for(const p of [v.hubPool.config.options,v.corePool.config.options]){
  assert.match(p,/default_transaction_read_only=on/);
  assert.doesNotMatch(p,/search_path/);
  assert.match(p,/statement_timeout=5000/);
  assert.match(p,/lock_timeout=1000/);
  assert.match(p,/idle_in_transaction_session_timeout=10000/);
 }
 for(const pool of [v.hubPool,v.corePool]){
  const queries=[];
  await new Promise((resolve,reject)=>{
   pool.config.verify({query:async sql=>{queries.push(sql);}},error=>{
    if(error)reject(error);else resolve();
   });
  });
  assert.deepEqual(queries,['SET search_path TO pg_catalog']);
 }
 assert.equal(v.metadata.environment,'DEV');
 assert.equal(v.metadata.projectRef,ref);
 assert.equal(v.metadata.dispatchPermitted,false);
 assert.equal(JSON.stringify(v.metadata).includes('secret'),false);
});

test('missing reader DSN fails closed before constructing any pool',()=>{
 let calls=0;
 class CountPool{constructor(){calls++;}}
 assert.throws(()=>createGpt02ReaderPools({
  env:{GPT02_HUB_READER_DATABASE_URL_DEV:dsn('gpt02_hub_evidence_reader'),GPT02_READER_DEV_CA:ca},
  Pool:CountPool,nodeEnv:'test',appEnv:'development'
 }),e=>e.code==='GPT02_READER_DSN_REQUIRED');
 assert.equal(calls,0);
});

for(const [name,patch,code] of [
 ['wrong Hub role',{GPT02_HUB_READER_DATABASE_URL_DEV:dsn('postgres')},
   'GPT02_READER_DEDICATED_IDENTITY_REQUIRED'],
 ['wrong Core role',{GPT02_CORE_READER_DATABASE_URL_DEV:dsn('gpt02_hub_evidence_reader')},
   'GPT02_READER_DEDICATED_IDENTITY_REQUIRED'],
 ['wrong project suffix',{GPT02_HUB_READER_DATABASE_URL_DEV:
   `postgresql://gpt02_hub_evidence_reader.other:pw@${host}:5432/postgres`},
   'GPT02_READER_DEDICATED_IDENTITY_REQUIRED'],
 ['wrong host',{GPT02_HUB_READER_DATABASE_URL_DEV:
   `postgresql://gpt02_hub_evidence_reader.${ref}:pw@db.example.invalid:5432/postgres`},
   'GPT02_READER_CST_DEV_TARGET_REQUIRED'],
 ['wrong database',{GPT02_CORE_READER_DATABASE_URL_DEV:
   `postgresql://gpt02_core_evidence_reader.${ref}:pw@${host}:5432/production`},
   'GPT02_READER_CST_DEV_TARGET_REQUIRED'],
 ['URL user override',{GPT02_CORE_READER_DATABASE_URL_DEV:
   dsn('gpt02_core_evidence_reader')+'?user=postgres'},
   'GPT02_READER_DSN_QUERY_FORBIDDEN'],
 ['TLS downgrade query',{GPT02_HUB_READER_DATABASE_URL_DEV:
   dsn('gpt02_hub_evidence_reader')+'?sslmode=no-verify'},
   'GPT02_READER_DSN_QUERY_FORBIDDEN']
])test('rejects '+name,()=>{
 assert.throws(()=>make({env:env(patch)}),e=>e.code===code);
});

test('invalid CA, CA bundle expansion and global TLS disable are rejected',()=>{
 for(const patch of [
  {GPT02_READER_DEV_CA:'not-a-ca'},
  {GPT02_READER_DEV_CA:ca+ca},
  {NODE_TLS_REJECT_UNAUTHORIZED:'0'}
 ])assert.throws(()=>make({env:env(patch)}),e=>
   ['GPT02_READER_PINNED_CA_REQUIRED','GPT02_READER_TLS_DISABLE_FORBIDDEN'].includes(e.code));
});

test('same full DSN is rejected even in synthetic tests',()=>{
 const same=dsn('gpt02_hub_evidence_reader');
 assert.throws(()=>createGpt02ReaderPools({
  env:{
   GPT02_HUB_READER_DATABASE_URL_DEV:same,
   GPT02_CORE_READER_DATABASE_URL_DEV:same,
   GPT02_READER_DEV_CA:ca
  },
  Pool:FakePool,nodeEnv:'test',appEnv:'development'
 }),/GPT02_READER_DEDICATED_IDENTITY_REQUIRED|GPT02_READER_DISTINCT_DSNS_REQUIRED/);
});

test('operational non-DEV mode is rejected before pool creation',()=>{
 let calls=0;
 class CountPool{constructor(){calls++;}}
 assert.throws(()=>createGpt02ReaderPools({
  env:env(),Pool:CountPool,nodeEnv:'production',appEnv:'production'
 }),e=>e.code==='GPT02_READER_EXPLICIT_CST_DEV_MODE_REQUIRED');
 assert.equal(calls,0);
});

test('factory has no shared-pool fallback or dispatch surface',async()=>{
 const {readFile}=await import('node:fs/promises');
 const src=await readFile(new URL('../src/lib/gpt02-reader-pools.mjs',import.meta.url),'utf8');
 for(const forbidden of [
  'SUPABASE_DATABASE_URL_DEV','supabasePool','@workspace/db',
  'INSERT INTO','UPDATE ','DELETE FROM','dispatchPermitted:true','sendCommand'
 ])assert.equal(src.includes(forbidden),false,forbidden);
});
