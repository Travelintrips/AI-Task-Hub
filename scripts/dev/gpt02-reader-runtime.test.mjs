import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createGpt02ReaderRuntimeServer,listenGpt02ReaderRuntimeSocket}
 from './gpt02-reader-runtime.mjs';

function request(socketPath,{method='GET',url='/health',body,headers={}}={}){
 return new Promise((resolve,reject)=>{
  const req=http.request({
   socketPath,path:url,method,headers:{
    ...(body===undefined?{}:{'content-type':'application/json'}),
    ...headers
   }
  },res=>{
   const chunks=[];
   res.on('data',x=>chunks.push(x));
   res.on('end',()=>{
    let json;
    try{json=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{}
    resolve({status:res.statusCode,headers:res.headers,body:json});
   });
  });
  req.on('error',reject);
  if(body!==undefined)req.write(typeof body==='string'?body:JSON.stringify(body));
  req.end();
 });
}
async function fixture({reader,preSignReader,verify}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gpt02-reader-runtime-'));
 fs.chownSync(dir,process.getuid(),process.getgid());
 fs.chmodSync(dir,0o2750);
 const socket=path.join(dir,'reader.sock');
 const server=createGpt02ReaderRuntimeServer({
  reader:reader||(async query=>({prepared:{hubTaskId:query.hubTaskId}})),
  preSignReader:preSignReader||(async query=>({prepared:{hubTaskId:query.hubTaskId}})),
  verify:verify||(async()=>({
   hub:{role:'gpt02_hub_evidence_reader'},
   core:{role:'gpt02_core_evidence_reader'},
   separateBackends:true
  })),
 });
 await listenGpt02ReaderRuntimeSocket(server,socket,process.getgid());
 return {dir,socket,server,async close(){
  await new Promise(resolve=>server.close(resolve));
  try{fs.rmSync(dir,{recursive:true,force:true})}catch{}
 }};
}

test('serves health only over a private Unix socket',async()=>{
 const f=await fixture();
 try{
  const st=fs.lstatSync(f.socket);
  assert.equal(st.isSocket(),true);
  assert.equal(st.mode&0o777,0o660);
  assert.equal(st.gid,process.getgid());
  assert.equal(fs.statSync(f.dir).mode&0o7777,0o2750);
  const result=await request(f.socket);
  assert.equal(result.status,200);
  assert.equal(result.body.ok,true);
  assert.equal(result.body.environment,'DEV');
  assert.equal(result.body.hubRole,'gpt02_hub_evidence_reader');
  assert.equal(result.body.coreRole,'gpt02_core_evidence_reader');
  assert.equal(result.body.twoSessionsVerified,true);
  assert.equal(result.body.dispatchPermitted,false);
  assert.equal(result.body.signingPermitted,false);
  assert.equal(typeof f.server.address(),'string');
 }finally{await f.close()}
});

test('forwards only a bounded trusted-facts JSON request to the reader',async()=>{
 let received;
 const f=await fixture({reader:async query=>{received=query;return {facts:'read-only'}}});
 try{
  const query={companyId:'default',hubTaskId:137,commandCandidateId:'a',
   attemptId:'b',linkId:'c',linkDigest:'d',approvalDigest:'e'};
  const result=await request(f.socket,{method:'POST',url:'/trusted-facts',body:query});
  assert.equal(result.status,200);
  assert.deepEqual(received,query);
  assert.deepEqual(result.body.facts,{facts:'read-only'});
  assert.equal(result.body.dispatchPermitted,false);
  assert.equal(result.body.signingPermitted,false);
 }finally{await f.close()}
});

test('forwards bounded pre-sign facts without granting signing or dispatch',async()=>{
 let received;
 const f=await fixture({preSignReader:async query=>{received=query;return {stage:'pre-sign-read-only'}}});
 try{
  const query={companyId:'default',hubTaskId:147,
   commandCandidateId:'9ebbd7d8-1d9d-4aa7-b168-ec86767c989b',
   attemptId:'420a9938-0d6d-441d-a990-60abb35258c0'};
  const result=await request(f.socket,{method:'POST',url:'/pre-sign-facts',body:query});
  assert.equal(result.status,200);
  assert.deepEqual(received,query);
  assert.deepEqual(result.body.facts,{stage:'pre-sign-read-only'});
  assert.equal(result.body.signingPermitted,false);
  assert.equal(result.body.authorizationGranted,false);
  assert.equal(result.body.dispatchPermitted,false);
  assert.equal(result.body.releaseDecision,'NO_GO');
 }finally{await f.close()}
});

test('rejects malformed JSON, oversized requests, wrong content type and wrong paths',async()=>{
 const f=await fixture();
 try{
  assert.equal((await request(f.socket,{method:'POST',url:'/trusted-facts',body:'{bad'})).status,400);
  assert.equal((await request(f.socket,{method:'POST',url:'/trusted-facts',body:'{}',
   headers:{'content-type':'text/plain'}})).status,400);
  assert.equal((await request(f.socket,{method:'POST',url:'/trusted-facts',body:'x'.repeat(9000)})).status,413);
  assert.equal((await request(f.socket,{method:'GET',url:'/not-found'})).status,404);
  assert.equal((await request(f.socket,{method:'GET',url:'/trusted-facts'})).status,404);
 }finally{await f.close()}
});

test('health fails closed and never reports ready after verifier error',async()=>{
 const f=await fixture({verify:async()=>{throw Object.assign(new Error('secret detail'),{code:'TWO_INDEPENDENT_RESTRICTED_DB_LOGINS_REQUIRED'})}});
 try{
  const result=await request(f.socket);
  assert.equal(result.status,503);
  assert.equal(result.body.ok,false);
  assert.equal(result.body.readerReady,false);
  assert.equal(result.body.code,'TWO_INDEPENDENT_RESTRICTED_DB_LOGINS_REQUIRED');
  assert.equal(JSON.stringify(result.body).includes('secret detail'),false);
 }finally{await f.close()}
});

test('reader failures return only a bounded code and never enable dispatch',async()=>{
 const f=await fixture({reader:async()=>{throw Object.assign(new Error('db password leak'),{code:'TRUSTED_HUB_TASK_SIDECAR_NOT_UNIQUE'})}});
 try{
  const result=await request(f.socket,{method:'POST',url:'/trusted-facts',body:{}});
  assert.equal(result.status,409);
  assert.equal(result.body.code,'TRUSTED_HUB_TASK_SIDECAR_NOT_UNIQUE');
  assert.equal(JSON.stringify(result.body).includes('db password leak'),false);
  assert.equal(result.body.dispatchPermitted,false);
 }finally{await f.close()}
});


test('runtime, pool factory and systemd unit share one pinned credential directory',()=>{
 const runtime=fs.readFileSync(new URL('./gpt02-reader-runtime.mjs',import.meta.url),'utf8');
 const pool=fs.readFileSync(new URL('../../artifacts/api-server/src/lib/gpt02-reader-pools.mjs',import.meta.url),'utf8');
 const unit=fs.readFileSync(new URL('../../deploy/hostinger/gpt02-issue159-reader.service',import.meta.url),'utf8');
 assert.match(pool,/const CREDENTIAL_DIR='\/run\/credentials\/gpt02-issue159-reader\.service'/);
 assert.match(pool,/0o440/);
 assert.match(runtime,/createGpt02ReaderPools\(\{\s*Pool,nodeEnv:'development',appEnv:'development'\s*\}\)/);
 assert.doesNotMatch(runtime,/GPT02_HUB_READER_DATABASE_URL_DEV|GPT02_CORE_READER_DATABASE_URL_DEV|GPT02_READER_DEV_CA/);
 assert.match(unit,/LoadCredentialEncrypted=hub-reader-dsn:/);
 assert.match(unit,/LoadCredentialEncrypted=core-reader-dsn:/);
 assert.match(unit,/LoadCredential=supabase-root-ca-2021\.crt:/);
});

test('rejects a reader socket directory with the wrong signer group',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gpt02-reader-runtime-group-'));
 fs.chmodSync(dir,0o2750);
 const server=createGpt02ReaderRuntimeServer({reader:async()=>({}),preSignReader:async()=>({}),verify:async()=>({})});
 await assert.rejects(
  listenGpt02ReaderRuntimeSocket(server,path.join(dir,'reader.sock'),process.getgid()+1),
  /GPT02_READER_SOCKET_DIRECTORY_NOT_PRIVATE/
 );
 await new Promise(resolve=>server.close(resolve));
 fs.rmSync(dir,{recursive:true,force:true});
});

test('reader and signer systemd units share only the signer group over AF_UNIX',()=>{
 const unit=fs.readFileSync(new URL('../../deploy/hostinger/gpt02-issue159-reader.service',import.meta.url),'utf8');
 assert.match(unit,/Group=gpt02-issue159-signers/);
 assert.match(unit,/RuntimeDirectoryMode=0750/);
 assert.match(unit,/SupplementaryGroups=gpt02-issue159-signers/);
 assert.ok(unit.includes('ReadWritePaths=/run/gpt02-reader'));
});
