import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,chmodSync,symlinkSync,linkSync,rmSync,openSync,closeSync,fstatSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {handoff,readOperatorSecret} from './gpt02-preparer-credential-file-handoff.mjs';

const ref='xssrfshdrtdfupgqwfdw';
const secret='S'.repeat(50);
const base={
 NODE_ENV:'development',APP_ENV:'development',
 GPT02_CORE_PREP_DEV_PROJECT_REF:ref,
 GPT02_HUB_DEV_PROJECT_REF:ref,
 GPT02_PROD_PROJECT_REF:'p'.repeat(20),
 GPT02_CORE_PREP_DEV_POOLER_HOST:'aws-1-ap-southeast-2.pooler.supabase.com'
};
function fileFixture(content=secret){
 const dir=mkdtempSync(join(tmpdir(),'gpt02-credential-fixture-'));
 const file=join(dir,'dev-preparer-password');
 writeFileSync(file,content,{mode:0o600});
 chmodSync(file,0o600);
 return {file,dir,cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}
const testSafe=(code)=>assert.equal(code.releaseDecision,'NO_GO');

test('missing credential file, missing environment and shared DSN never invoke a connection',async()=>{
 let requests=0;
 const p=async()=>{requests++;throw Error('MUST_NOT_CONNECT')};
 for(const patch of [
  {},{GPT02_CORE_PREP_SECRET_FILE:''},{GPT02_CORE_PREP_SECRET_FILE:'relative/file'},
  {GPT02_CORE_PREP_SECRET_FILE:'/no/such/file'},
  {GPT02_CORE_PREP_SECRET_FILE:'/no/such/file',GPT02_CORE_PREP_DATABASE_URL_DEV:'postgres://postgres:fake@localhost/postgres'},
 ]){
  const result=await handoff({...base,...patch},{probeFn:p});
  testSafe(result);
  assert.equal(result.permissionsVerified,false);
 }
 assert.equal(requests,0);
});

test('empty, unsafe, unlocked, wrong-project and PROD configuration is blocked before file reads',async()=>{
 const f=fileFixture();
 try{
  let calls=0;
  const p=()=>{calls++;return {permissionsVerified:true}};
  const variants=[
   {NODE_ENV:'production'},{APP_ENV:'production'},
   {NODE_TLS_REJECT_UNAUTHORIZED:'0'},
   {GPT02_CORE_PREP_DEV_PROJECT_REF:'p'.repeat(20)},
   {GPT02_HUB_DEV_PROJECT_REF:'p'.repeat(20)},
   {GPT02_PROD_PROJECT_REF:ref},
   {GPT02_CORE_PREP_DEV_POOLER_HOST:'127.0.0.1'},
   {GPT02_CORE_PREP_DEV_POOLER_HOST:'db.'+ref+'.supabase.co'},
   {GPT02_CORE_PREP_DEV_POOLER_HOST:'aws-1-ap-southeast-2.pooler.supabase.com.evil.org'},
   {GPT02_CORE_PREP_DATABASE_URL_DEV:'postgres://postgres:password@localhost/postgres'}
  ];
  for(const patch of variants){
   const result=await handoff({...base,GPT02_CORE_PREP_SECRET_FILE:f.file,...patch},{probeFn:p,approvedRoot:f.dir});
   testSafe(result);assert.equal(result.permissionsVerified,false);
  }
  assert.equal(calls,0);
 }finally{f.cleanup()}
});

test('strict ownership and mode reject world/group, symlinks and hardlinks',()=>{
 const f=fileFixture();
 try{
  // A normal file under /tmp is never an approved secret source in production.
  assert.throws(()=>readOperatorSecret(f.file));
  assert.equal(readOperatorSecret(f.file,{approvedRoot:f.dir}),secret);
  assert.throws(()=>readOperatorSecret(f.dir+'/../wrong-target',{approvedRoot:f.dir}));
  chmodSync(f.file,0o644);
  assert.throws(()=>readOperatorSecret(f.file,{approvedRoot:f.dir}));
  chmodSync(f.file,0o660);
  assert.throws(()=>readOperatorSecret(f.file,{approvedRoot:f.dir}));
  chmodSync(f.file,0o700);
  assert.throws(()=>readOperatorSecret(f.file,{approvedRoot:f.dir}));
  chmodSync(f.file,0o600);
  const link=join(f.dir,'symlink');
  symlinkSync(f.file,link);
  assert.throws(()=>readOperatorSecret(link,{approvedRoot:f.dir}));
  const hard=join(f.dir,'hardlink');
  linkSync(f.file,hard);
  assert.throws(()=>readOperatorSecret(f.file,{approvedRoot:f.dir}));
  assert.throws(()=>readOperatorSecret(hard,{approvedRoot:f.dir}));
 }finally{f.cleanup()}
});

test('bad content never reaches database client',async()=>{
 for(const bad of ['', 'a'.repeat(20), 'a'.repeat(129),
  'a'.repeat(42)+'\r\n', 'a'.repeat(45)+'!','a'.repeat(45)+'\nmore',
  'a'.repeat(45)+' ','a'.repeat(45)+'\0']){
  const f=fileFixture(bad);
  try{
   let requests=0;
   const r=await handoff({...base,GPT02_CORE_PREP_SECRET_FILE:f.file},{approvedRoot:f.dir,probeFn:()=>{requests++;return {permissionsVerified:true}}});
   testSafe(r);assert.equal(r.permissionsVerified,false);assert.equal(requests,0);
  }finally{f.cleanup()}
 }
});

test('one newline is accepted, secret supplied only in in-memory DSN, never stdout',async()=>{
 const f=fileFixture(secret+'\n');
 try{
  assert.equal(readOperatorSecret(f.file,{approvedRoot:f.dir}),secret);
  let count=0;let called=false;
  const result=await handoff({...base,GPT02_CORE_PREP_SECRET_FILE:f.file},{
   approvedRoot:f.dir,probeFn:async env=>{
    count++;
    const u=new URL(env.GPT02_CORE_PREP_DATABASE_URL_DEV);
    assert.equal(u.username,'gpt02_core_prep_login.'+ref);
    assert.equal(u.hostname,base.GPT02_CORE_PREP_DEV_POOLER_HOST);
    assert.equal(u.pathname,'/postgres');assert.equal(u.port,'5432');
    assert.equal(u.password,secret);
    assert.equal(env.GPT02_CORE_PREP_DEV_PROJECT_REF,ref);
    assert.ok(env.GPT02_CORE_PREP_DEV_CA.startsWith('-----BEGIN CERTIFICATE-----'));
    called=true;
    return {releaseDecision:'NO_GO',dispatchPermitted:false,scopedLoginAuthenticated:true,permissionsVerified:true};
   }
  });
  assert.equal(called,true);assert.equal(count,1);
  assert.equal(result.permissionsVerified,true);testSafe(result);
  assert.equal(result.dispatchPermitted,false);
  assert.equal(JSON.stringify(result).includes(secret),false);
 }finally{f.cleanup()}
});

test('errors are sanitized; no retry, no credentials in logs',async()=>{
 const f=fileFixture();
 try{
  let count=0;
  const result=await handoff({...base,GPT02_CORE_PREP_SECRET_FILE:f.file},{
   approvedRoot:f.dir,probeFn:async()=>{count++;throw Error('leak:'+secret)}
  });
  assert.equal(count,1);testSafe(result);
  assert.equal(result.permissionsVerified,false);
  assert.equal(JSON.stringify(result).includes(secret),false);
 }finally{f.cleanup()}
});

test('actual absent-credential path does not touch a DB or authorize DELL',async()=>{
 const result=await handoff({...base});
 testSafe(result);
 for(const key of ['dormantFunctionInvoked','taskCreated','commandCreated','signedApprovalGranted',
  'issuerLeaseGranted','dispatchPermitted','lifecyclePermitted'])
  assert.equal(result[key],false,key);
 assert.equal(result.scopedLoginAuthenticated,false);
});
