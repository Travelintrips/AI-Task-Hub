/**
 * Run ONLY under the disposable Python harness that imports the EXISTING
 * Issue159 reader source and serves its real Unix HTTP handler over a
 * synthetic SQLite DB. The PR207 persisted-intent gate is NOT mounted.
 *
 * Test-only claims are loaded from /tmp fixture metadata, not from an
 * operational approved-claims file, and never prove real Owner authority.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createConnection} from 'node:net';
import {randomUUID} from 'node:crypto';
import {createGpt02Issue159PersistedIntentGate}
 from '../../artifacts/api-server/src/lib/gpt02-issue159-persisted-owner-intent-gate.mjs';

if(process.env.GPT02_ISSUE159_ORIGINAL_SQLITE_SOCKET_FIXTURE!=='1')
 throw Error('DISPOSABLE_ISSUE159_FIXTURE_REQUIRED');
const fixturePath=process.env.GPT02_ISSUE159_FIXTURE_DESCRIPTOR;
if(typeof fixturePath!=='string'||!fixturePath.includes('gpt02-issue159-'))
 throw Error('TEST_DESCRIPTOR_REQUIRED');
const f=JSON.parse(readFileSync(fixturePath,'utf8'));
if(f.environment!=='DEV'||f.synthetic!==true||
   typeof f.socketPath!=='string'||!f.socketPath.includes('gpt02-issue159-'))
 throw Error('SYNTHETIC_ONLY');
const now=()=>Date.now();
const acceptClaims=async tuple=>{
 if(tuple.companyId!==f.claims.companyId||tuple.taskId!==f.claims.taskId||
    tuple.commandId!==f.claims.commandId||tuple.attemptId!==f.claims.attemptId||
    tuple.operatorSubject!==f.claims.superAdminId)return null;
 return f.claims;
};
async function unixRead({lookup,observedAt}){
 const data=Buffer.from(JSON.stringify({lookup,observedAt}));
 const head=Buffer.from('POST /approval-intent HTTP/1.1\r\nHost: localhost\r\n'+
  'Content-Type: application/json\r\nContent-Length: '+data.length+'\r\n'+
  'Connection: close\r\n\r\n');
 const received=await new Promise((resolve,reject)=>{
  const socket=createConnection({path:f.socketPath});
  let raw=Buffer.alloc(0);
  socket.setTimeout(3000,()=>socket.destroy(Error('FIXTURE_READER_TIMEOUT')));
  socket.on('connect',()=>socket.write(Buffer.concat([head,data])));
  socket.on('data',part=>{
   raw=Buffer.concat([raw,part]);
   if(raw.length>16000)socket.destroy(Error('FIXTURE_READER_RESPONSE_TOO_LARGE'));
  });
  socket.on('end',()=>resolve(raw));
  socket.on('error',reject);
 });
 const marker=Buffer.from('\r\n\r\n'),cut=received.indexOf(marker);
 if(cut<0)throw Error('FIXTURE_READER_INVALID_RESPONSE');
 const status=received.subarray(0,cut).toString('utf8').split('\r\n')[0];
 if(!/^HTTP\/1\.1 (200|404) /.test(status))throw Error('FIXTURE_READER_STATUS_INVALID');
 return JSON.parse(received.subarray(cut+4).toString('utf8'));
}
const gate=createGpt02Issue159PersistedIntentGate({
 env:{NODE_ENV:'development',APP_ENV:'development'},
 clock:now,maxReadAgeMs:2000,
 readTrustedClaims:acceptClaims,readTrustedIntent:unixRead
});
const session={id:f.claims.superAdminId,role:'super_admin'};
const consent={kind:'GPT02_DEV_SINGLE_COMMAND_CONSENT_V1',approved:true,
 companyId:f.claims.companyId,taskId:f.claims.taskId,commandId:f.claims.commandId,
 attemptId:f.claims.attemptId,nonce:f.claims.nonce,operatorSubject:f.claims.superAdminId};
test('actual original Issue159 SQLite + Unix socket decision passes PR207 gate WITHOUT signing authority',async()=>{
 const result=await gate({session,consent});
 assert.equal(result.verified,true);
 assert.equal(result.reason,'ISSUE159_PERSISTED_DECISION_VERIFIED_ONLY');
 assert.equal(result.releaseDecision,'NO_GO');
 for(const k of ['authorizationGranted','signingPermitted','issuerLeaseGranted','dispatchPermitted'])
  assert.equal(result[k],false);
});
test('wrong or historical command/task/nonce cannot use real persisted decision',async()=>{
 for(const extra of [
  {commandId:randomUUID()},{taskId:171},
  {nonce:'b'.repeat(43)},{operatorSubject:'impostor'}
 ]){
  const r=await gate({session,consent:{...consent,...extra}});
  assert.equal(r.verified,false,JSON.stringify(extra));
  assert.equal(r.dispatchPermitted,false);
 }
});
test('actual Unix socket rejects a different claim SHA/command, and PR207 gate remains NO_GO',async()=>{
 const noSuch=await unixRead({lookup:{claimsSha256:'f'.repeat(64),
  taskId:consent.taskId,commandId:randomUUID(),attemptId:consent.attemptId,
  companyId:'default',superAdminId:session.id},observedAt:Date.now()});
 assert.equal(noSuch.ok,false);
 assert.equal(noSuch.releaseDecision,'NO_GO');
 const gated=createGpt02Issue159PersistedIntentGate({
  env:{NODE_ENV:'development',APP_ENV:'development'},clock:now,
  readTrustedClaims:acceptClaims,readTrustedIntent:async()=>noSuch
 });
 const result=await gated({session,consent});
 assert.equal(result.verified,false);
 assert.equal(result.reason,'ISSUE159_READER_NOT_TRUSTED');
});
test('a browser-injected Issue159 reader response or signature is not accepted as an extra field',async()=>{
 const r=await gate({session,consent,readerResponse:{ok:true},
  approvalSignature:'fixture-only'});
 assert.equal(r.verified,false);
});
test('the original Unix reader remains purely read-only and no dispatch grant is exposed',async()=>{
 const original=await unixRead({lookup:f.lookup,observedAt:Date.now()});
 assert.equal(original.ok,true);
 assert.equal(original.approvalReadOnly,true);
 assert.equal(original.decisionCreated,false);
 assert.equal(original.releaseDecision,'NO_GO');
 for(const k of ['signingPermitted','authorizationGranted','dispatchPermitted'])
  assert.equal(original[k],false);
});
