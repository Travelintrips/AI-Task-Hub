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
async function fixture({reader,verify}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gpt02-reader-runtime-'));
 fs.chmodSync(dir,0o700);
 const socket=path.join(dir,'reader.sock');
 const server=createGpt02ReaderRuntimeServer({
  reader:reader||(async query=>({prepared:{hubTaskId:query.hubTaskId}})),
  verify:verify||(async()=>({
   hub:{role:'gpt02_hub_evidence_reader'},
   core:{role:'gpt02_core_evidence_reader'},
   separateBackends:true
  })),
 });
 await listenGpt02ReaderRuntimeSocket(server,socket);
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
  assert.equal(st.mode&0o777,0o600);
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
