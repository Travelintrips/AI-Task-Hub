import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomBytes,randomUUID} from 'node:crypto';
import {createGpt02SingleOwnerApprovalHttpCandidate} from '../../artifacts/api-server/src/lib/gpt02-single-owner-approval-http-candidate.mjs';
import {hasRecentVerifiedGpt02DevGoogleOperator} from '../../artifacts/api-server/src/lib/gpt02-google-auth-gate.mjs';

const uid='fixture_owner_7';
const consent=()=>({
 kind:'GPT02_DEV_SINGLE_COMMAND_CONSENT_V1',approved:true,companyId:'default',
 taskId:172,commandId:randomUUID(),attemptId:randomUUID(),
 nonce:randomBytes(32).toString('base64url'),operatorSubject:uid,
});
const safe=()=>({recorded:true,reason:'SIGNED_EVIDENCE_RECORDED_ONLY',
 releaseDecision:'NO_GO',authorizationGranted:false,issuerLeaseGranted:false,
 dispatchPermitted:false,commandCreated:false});
const okSession=()=>({id:uid,email:'owner@example.invalid',role:'super_admin',
 authSource:'supabase_google_identity',authSupabaseId:randomUUID(),authVerifiedAt:Date.now()});
/**
 * This is a disposable test-only HTTP server. The known test-session selection
 * is injected by the test runner and MUST NOT be used in any app router.
 * The candidate itself only reads req.user set by real authentication.
 */
async function harness({enabled=false,production=false,proof=true,output=safe(),error=false,fresh=true,intent=true}={}){
 let signed=0,recorded=0;
 const handler=createGpt02SingleOwnerApprovalHttpCandidate({
   env:{NODE_ENV:production?'production':'development',APP_ENV:production?'production':'development',
     GPT02_SINGLE_OWNER_APPROVAL_HTTP_ENABLED:enabled?'true':'false',
     SESSION_SECRET:'synthetic-dev-session-secret-is-only-for-a-disposable-test'},
   inspectRequestOrigin:req=>req.headers.origin==='https://dev-ai-task.cstlogistic.co.id',
   verifyFreshGoogleOperator:hasRecentVerifiedGpt02DevGoogleOperator,
   verifyPersistedOwnerIntent:async()=>intent?{
     verified:true,reason:'ISSUE159_PERSISTED_DECISION_VERIFIED_ONLY',
     releaseDecision:'NO_GO',authorizationGranted:false,signingPermitted:false,
     issuerLeaseGranted:false,dispatchPermitted:false,
   }:null,
   readSignedProof:async()=>{signed++;if(error)throw Error('offline');return proof?{
     approval:{claims:{}},operatorLink:{claims:{}},
   }:null},
   recordOneConsent:async()=>{recorded++;return output},
 });
 const server=createServer(async(req,res)=>{
   let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>8192){res.writeHead(413);res.end();return}}
   try{req.body=raw?JSON.parse(raw):undefined}catch{req.body={}};
   if(req.headers['x-test-session']==='owner')req.user={...okSession(),
     authVerifiedAt:fresh?Date.now():Date.now()-11*60_000};
   if(req.headers['x-test-session']==='legacy')req.user={...okSession(),authSource:'legacy_email'};
   if(req.headers['x-test-session']==='staff')req.user={id:'staff',role:'staff'};
   const proxy={setHeader:(k,v)=>res.setHeader(k,v),status(code){res.statusCode=code;return this},
     json(x){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(x));}};
   await handler(req,proxy);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const call=async({method='POST',body={consent:consent()},session='owner',
   origin='https://dev-ai-task.cstlogistic.co.id',type='application/json'}={})=>{
   const headers={'content-type':type,origin};
   if(session)headers['x-test-session']=session;
   const r=await fetch(base,{method,headers,body:method==='POST'?JSON.stringify(body):undefined,
     signal:AbortSignal.timeout(3000)});
   return {code:r.status,data:await r.json(),cache:r.headers.get('cache-control')};
 };
 return {call,counters:()=>({signed,recorded}),close:()=>new Promise(resolve=>server.close(resolve))};
}
test('non-DEV and default-off never call signer or attestor',async()=>{
 for(const x of [{production:true,enabled:true},{enabled:false}]){
  const h=await harness(x);
  try{const r=await h.call();assert.equal(r.code,x.production?404:503);
    assert.equal(r.data.dispatchPermitted,false);assert.equal(r.data.releaseDecision,'NO_GO');
    assert.deepEqual(h.counters(),{signed:0,recorded:0});}
  finally{await h.close()}
 }
});
test('upstream unauthenticated and staff roles denied before signing',async()=>{
 const h=await harness({enabled:true});
 try{for(const [session,code] of [[null,401],['staff',403]]){
   const r=await h.call({session});assert.equal(r.code,code);assert.equal(r.data.dispatchPermitted,false);
 }assert.deepEqual(h.counters(),{signed:0,recorded:0})}
 finally{await h.close()}
});
test('original PR196 Google verifier denies stale or legacy login before any signature',async()=>{
 for(const stale of [{fresh:false},{fresh:true}]){
   const h=await harness({enabled:true,...stale});
   try{
     const request=await h.call();
     assert.equal(request.code,stale.fresh?202:403);
     if(!stale.fresh)assert.deepEqual(h.counters(),{signed:0,recorded:0});
     const legacy=await h.call({session:'legacy'});
     assert.equal(legacy.code,403);
     if(!stale.fresh)assert.deepEqual(h.counters(),{signed:0,recorded:0});
   }finally{await h.close()}
 }
});
test('exact method, content-type, Origin, one-command consent and no extra fields',async()=>{
 const h=await harness({enabled:true});
 try{
  assert.equal((await h.call({method:'GET'})).code,405);
  assert.equal((await h.call({type:'text/plain'})).code,415);
  assert.equal((await h.call({origin:'https://evil.invalid'})).code,403);
  for(const body of [
   {consent:consent(),proof:{signatureBase64url:'fake'}},
   {consent:consent(),trustedPublicKeyPem:'fake'},
   {consent:{...consent(),approved:false}},
   {consent:{...consent(),operatorSubject:'another_admin'}},
   {consent:{...consent(),authorizationGranted:true}},
   {consent:undefined},
  ])assert.equal((await h.call({body})).code,400);
  assert.deepEqual(h.counters(),{signed:0,recorded:0});
 }finally{await h.close()}
});
test('without an existing Issue159 persisted Owner decision, HTTP denies BEFORE signer',async()=>{
 const h=await harness({enabled:true,intent:false});
 try{
   const result=await h.call();assert.equal(result.code,424);
   assert.equal(result.data.reason,'PERSISTED_OWNER_DECISION_REQUIRED');
   assert.deepEqual(h.counters(),{signed:0,recorded:0});
 }finally{await h.close()}
});
test('no server signer evidence fails closed and never records',async()=>{
 const h=await harness({enabled:true,proof:false});
 try{const r=await h.call();assert.equal(r.code,424);
   assert.equal(r.data.reason,'TRUSTED_SIGNER_UNAVAILABLE');
   assert.deepEqual(h.counters(),{signed:1,recorded:0});}
 finally{await h.close()}
});
test('dependency failure and untrusted recorder response can never grant dispatch',async()=>{
 for(const cfg of [
  {error:true,code:503},
  {output:{...safe(),authorizationGranted:true},code:409},
  {output:{...safe(),dispatchPermitted:true},code:409},
  {output:{...safe(),releaseDecision:'GO'},code:409},
 ]){
  const h=await harness({enabled:true,...cfg});
  try{const r=await h.call();assert.equal(r.code,cfg.code);
    assert.equal(r.data.authorizationGranted,false);
    assert.equal(r.data.dispatchPermitted,false);}
  finally{await h.close()}
 }
});
test('valid synthetic server signature and recorder evidence responds HTTP 202 without lease or dispatch',async()=>{
 const h=await harness({enabled:true});
 try{const r=await h.call();assert.equal(r.code,202);
   assert.equal(r.data.recorded,true);assert.equal(r.data.releaseDecision,'NO_GO');
   assert.equal(r.data.issuerLeaseGranted,false);assert.equal(r.data.dispatchPermitted,false);
   assert.equal(r.data.commandCreated,false);assert.equal(r.cache,'no-store');
   assert.deepEqual(h.counters(),{signed:1,recorded:1});}
 finally{await h.close()}
});
test('candidate remains unmounted; no browser signing, private keys, bridge token or issuer consumption',async()=>{
 const {readFileSync}=await import('node:fs');
 const s=readFileSync(new URL('../../artifacts/api-server/src/lib/gpt02-single-owner-approval-http-candidate.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(s,/privateKey|createPrivateKey|sign\(|router\.post|app\.post|consumeLinkedApproval|bridgeToken/);
});
