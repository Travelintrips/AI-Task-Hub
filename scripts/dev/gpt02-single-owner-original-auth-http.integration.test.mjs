/**
 * An isolated HTTP fixture using the *actual* PR196 JWT extraction and
 * requireAuth / requireRole middleware, NOT an x-test-session substitute.
 * JWT signing is permitted only inside this disposable test process.
 * The approval HTTP handler and signer dependency are never mounted live.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {randomBytes,randomUUID} from 'node:crypto';
import {createGpt02SingleOwnerApprovalHttpCandidate} from '../../artifacts/api-server/src/lib/gpt02-single-owner-approval-http-candidate.mjs';
import {hasRecentVerifiedGpt02DevGoogleOperator} from '../../artifacts/api-server/src/lib/gpt02-google-auth-gate.mjs';

if(process.env.GPT02_DISPOSABLE_AUTH_HTTP_ONLY!=='1')throw Error('DISPOSABLE_HTTP_AUTH_REQUIRED');
if(typeof process.env.GPT02_PR196_AUTH_BUNDLE_PATH!=='string')throw Error('PINNED_PR196_AUTH_BUNDLE_REQUIRED');
const {extractUser,requireAuth,requireRole,signToken}=
 createRequire(import.meta.url)(process.env.GPT02_PR196_AUTH_BUNDLE_PATH);
const ROOT_SECRET=process.env.SESSION_SECRET;
if(!ROOT_SECRET||ROOT_SECRET.length<32||process.env.APP_ENV!=='development')
 throw Error('SYNTHETIC_DEV_SESSION_REQUIRED');
const OWNER='fixture_owner_7',COMPANY='default',ORIGIN='https://dev-ai-task.cstlogistic.co.id';
const safe=()=>({recorded:true,reason:'SIGNED_EVIDENCE_RECORDED_ONLY',releaseDecision:'NO_GO',
 authorizationGranted:false,issuerLeaseGranted:false,dispatchPermitted:false,commandCreated:false});
const consent=()=>({kind:'GPT02_DEV_SINGLE_COMMAND_CONSENT_V1',approved:true,
 companyId:COMPANY,taskId:172,commandId:randomUUID(),attemptId:randomUUID(),
 nonce:randomBytes(32).toString('base64url'),operatorSubject:OWNER});
const claims=(overrides={})=>({
 id:OWNER,email:'owner@example.invalid',role:'super_admin',companyId:COMPANY,
 name:'Synthetic Owner',authSource:'supabase_google_identity',
 authSupabaseId:randomUUID(),authVerifiedAt:Date.now(),...overrides,
});
async function serverFixture({signedProof=true,persistedIntent=true,recorderResult=safe()}={}){
 let signerCalls=0,recorderCalls=0;
 const route=createGpt02SingleOwnerApprovalHttpCandidate({
  env:{NODE_ENV:'development',APP_ENV:'development',
    SESSION_SECRET:ROOT_SECRET,GPT02_SINGLE_OWNER_APPROVAL_HTTP_ENABLED:'true'},
  inspectRequestOrigin:r=>r.headers.origin===ORIGIN,
  verifyFreshGoogleOperator:hasRecentVerifiedGpt02DevGoogleOperator,
  verifyPersistedOwnerIntent:async()=>persistedIntent?{
    verified:true,reason:'ISSUE159_PERSISTED_DECISION_VERIFIED_ONLY',
    releaseDecision:'NO_GO',signingPermitted:false,authorizationGranted:false,
    issuerLeaseGranted:false,dispatchPermitted:false,
  }:null,
  readSignedProof:async()=>{signerCalls++;return signedProof?{approval:{claims:{}},operatorLink:{claims:{}}}:null},
  recordOneConsent:async()=>{recorderCalls++;return recorderResult},
 });
 const authGate=requireRole('super_admin');
 const server=createServer(async(req,res)=>{
  const response={setHeader:(k,v)=>{res.setHeader(k,v);return response},
   status:s=>{res.statusCode=s;return response},
   json:x=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(x));return response}};
  const run=()=>extractUser(req,response,()=>requireAuth(req,response,
    ()=>authGate(req,response,()=>route(req,response))));
  if(req.method!=='POST'){req.body=undefined;await run();return}
  let raw='';for await(const b of req){raw+=b;if(raw.length>8192){res.statusCode=413;res.end('{}');return}}
  try{req.body=JSON.parse(raw)}catch{req.body={}}
  await run();
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 async function call({token=null,body={consent:consent()},origin=ORIGIN}={}){
  const r=await fetch('http://127.0.0.1:'+server.address().port,{
   method:'POST',headers:{'content-type':'application/json',origin,
    ...(token?{authorization:'Bearer '+token}:{})},
   body:JSON.stringify(body),signal:AbortSignal.timeout(4000)});
  return {status:r.status,response:await r.json()};
 }
 return {call,calls:()=>({signerCalls,recorderCalls}),
  close:()=>new Promise(resolve=>server.close(resolve))};
}
test('missing, forged, malformed and staff JWTs are denied by original PR196 middleware before signer',async()=>{
 const s=await serverFixture();
 try{
  assert.equal((await s.call()).status,401);
  assert.equal((await s.call({token:'not-a-jwt'})).status,401);
  const good=signToken(claims());
  assert.equal((await s.call({token:good.slice(0,-5)+'xxxxx'})).status,401);
  assert.equal((await s.call({token:signToken(claims({role:'staff'}))})).status,403);
  assert.deepEqual(s.calls(),{signerCalls:0,recorderCalls:0});
 }finally{await s.close()}
});
test('original Google verifier rejects legacy, expired, unbound or cross-role sessions before signer',async()=>{
 const s=await serverFixture();
 try{
  for(const override of [
   {authSource:undefined},{authSource:'legacy_email'},
   {authVerifiedAt:Date.now()-11*60_000},
   {authSupabaseId:undefined},{role:'owner'},
   {role:'company_admin'},
  ]){
   const r=await s.call({token:signToken(claims(override))});
   assert.equal(r.status,403,JSON.stringify(override));
  }
  assert.deepEqual(s.calls(),{signerCalls:0,recorderCalls:0});
 }finally{await s.close()}
});
test('real JWT session and exact consent reach only synthetic recorder, never issue grant or dispatch',async()=>{
 const s=await serverFixture();
 try{
  const r=await s.call({token:signToken(claims())});
  assert.equal(r.status,202);
  assert.equal(r.response.recorded,true);
  assert.equal(r.response.releaseDecision,'NO_GO');
  for(const key of ['authorizationGranted','issuerLeaseGranted','dispatchPermitted','commandCreated'])
    assert.equal(r.response[key],false);
  assert.deepEqual(s.calls(),{signerCalls:1,recorderCalls:1});
 }finally{await s.close()}
});
test('JWT is not per-command consent: missing gesture and injected signature never reach signer',async()=>{
 const s=await serverFixture(),token=signToken(claims());
 try{
  for(const body of [{},{consent:{...consent(),approved:false}},
    {consent:consent(),signature:'fake'},{consent:{...consent(),operatorSubject:'other'}}]){
    assert.equal((await s.call({token,body})).status,400);
  }
  assert.deepEqual(s.calls(),{signerCalls:0,recorderCalls:0});
 }finally{await s.close()}
});
test('original JWT alone is not persisted Owner intent; signer never contacted',async()=>{
 const h=await serverFixture({persistedIntent:false});
 try{
  const r=await h.call({token:signToken(claims())});
  assert.equal(r.status,424);
  assert.equal(r.response.reason,'PERSISTED_OWNER_DECISION_REQUIRED');
  assert.deepEqual(h.calls(),{signerCalls:0,recorderCalls:0});
 }finally{await h.close()}
});
test('real middleware + trusted-signer absence always fails closed',async()=>{
 const s=await serverFixture({signedProof:false});
 try{
  const r=await s.call({token:signToken(claims())});
  assert.equal(r.status,424);
  assert.equal(r.response.reason,'TRUSTED_SIGNER_UNAVAILABLE');
  assert.deepEqual(s.calls(),{signerCalls:1,recorderCalls:0});
 }finally{await s.close()}
});
