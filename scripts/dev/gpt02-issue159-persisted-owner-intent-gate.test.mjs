import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {canonicalApproval} from '../../artifacts/api-server/src/lib/gpt02-issuer-store.mjs';
import {createGpt02Issue159PersistedIntentGate} from '../../artifacts/api-server/src/lib/gpt02-issue159-persisted-owner-intent-gate.mjs';

const now=Date.now();
const env={NODE_ENV:'development',APP_ENV:'development'};
function fixture(){
 const actor='synthetic_owner_7';
 const claims={v:2,environment:'DEV',
 audience:'GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL',taskId:172,
 commandId:randomUUID(),attemptId:randomUUID(),nonce:randomBytes(32).toString('base64url'),
 operatorNamespace:'ai-task-hub.public.users',superAdminId:actor,
 companyId:'default',issuedAt:now-100,expiresAt:now+60000};
 const digest=createHash('sha256').update(canonicalApproval(claims)).digest('hex');
 const decision={decisionId:randomUUID(),claimsSha256:digest,actorId:actor,
 authMethod:'supabase_admin_session',roleAtDecision:'super_admin',
 decision:'APPROVE',recordedAt:now-50};
 const result={environment:'DEV',reason:'TRUSTED_APPROVAL_INTENT_READ_NO_SIGNING_AUTHORITY',
 decision,persistedTrustedReadProven:true,approvalBindingMatched:true,
 aal2SuperAdminMatched:false,adminApprovalMatched:true,signingPermitted:false,
 authorizationGranted:false,dispatchPermitted:false,releaseDecision:'NO_GO'};
 const reader={ok:true,environment:'DEV',result,approvalReadOnly:true,
 decisionCreated:false,signingPermitted:false,authorizationGranted:false,
 dispatchPermitted:false,releaseDecision:'NO_GO'};
 const session={id:actor,role:'super_admin'};
 const consent={kind:'GPT02_DEV_SINGLE_COMMAND_CONSENT_V1',approved:true,
 companyId:'default',taskId:172,commandId:claims.commandId,
 attemptId:claims.attemptId,nonce:claims.nonce,operatorSubject:actor};
 return {session,consent,claims,reader,digest};
}
function gate(f,{readTrustedClaims,readTrustedIntent,...overrides}={}){
 let claimsCalls=0,readerCalls=0;
 const func=createGpt02Issue159PersistedIntentGate({
  env,clock:()=>now,
  readTrustedClaims:readTrustedClaims??(async()=>{claimsCalls++;return f.claims}),
  readTrustedIntent:readTrustedIntent??(async({lookup,observedAt})=>{
   readerCalls++;
   assert.equal(lookup.claimsSha256,f.digest);
   assert.equal(lookup.superAdminId,f.session.id);
   assert.equal(lookup.commandId,f.consent.commandId);
   assert.equal(observedAt,now);
   return f.reader;
  }),...overrides
 });
 return {func,calls:()=>({claimsCalls,readerCalls})};
}
test('existing Issue159 persisted SUPABASE AAL1 owner intent binds exact command digest; remains NO_GO',async()=>{
 const f=fixture(),g=gate(f);
 const out=await g.func({session:f.session,consent:f.consent});
 assert.equal(out.verified,true);
 assert.equal(out.reason,'ISSUE159_PERSISTED_DECISION_VERIFIED_ONLY');
 assert.equal(out.digest,f.digest);
 for(const key of ['signingPermitted','authorizationGranted','issuerLeaseGranted','dispatchPermitted'])
  assert.equal(out[key],false,key);
 assert.equal(out.releaseDecision,'NO_GO');
 assert.deepEqual(g.calls(),{claimsCalls:1,readerCalls:1});
});
test('claims reader, persisted reader and DEV identity dependencies are all mandatory',async()=>{
 const f=fixture();
 for(const obj of [{readTrustedClaims:()=>null},{readTrustedIntent:null},
  {env:{NODE_ENV:'production',APP_ENV:'production'}},{clock:null}]){
  if(obj.clock===null||obj.readTrustedIntent===null)
    assert.throws(()=>createGpt02Issue159PersistedIntentGate({...obj,
      readTrustedClaims:async()=>f.claims,
      readTrustedIntent:obj.readTrustedIntent??(obj.clock===null?async()=>f.reader:null)}));
  else {
   const g=gate(f,obj);
   const out=await g.func({session:f.session,consent:f.consent});
   assert.equal(out.verified,false);
  }
 }
});
test('browser cannot supply claims, signer keys, role override or a second human approval',async()=>{
 for(const changed of [
  {consent:{...fixture().consent,approved:false}},
  {session:{id:'other',role:'super_admin'}},
  {session:{id:'synthetic_owner_7',role:'staff'}},
 ]){
  const f=fixture(),g=gate(f),p={session:f.session,consent:f.consent};
  const patch=changed.session||changed.consent;
  if(changed.session)p.session=patch;
  else p.consent={...f.consent,approved:false};
  const r=await g.func(p);
  assert.equal(r.verified,false);
  assert.deepEqual(g.calls(),{claimsCalls:0,readerCalls:0});
 }
 const f=fixture(),g=gate(f);
 const bad=await g.func({session:f.session,consent:f.consent,publicKeyPem:'injected'});
 assert.equal(bad.verified,false);
 assert.deepEqual(g.calls(),{claimsCalls:0,readerCalls:0});
});
test('historical Task171, changed company, command, attempt and nonce cannot request trusted intent',async()=>{
 for(const field of ['taskId','companyId','commandId','attemptId','nonce','operatorSubject']){
  const f=fixture(),g=gate(f);
  const different=field==='taskId'?171:field==='companyId'?'other':
   field==='nonce'?randomBytes(32).toString('base64url'):
   field==='operatorSubject'?'other_owner':randomUUID();
  const c={...f.consent,[field]:different};
  const result=await g.func({session:f.session,consent:c});
  assert.equal(result.verified,false,field);
 }
});
test('forged reader success, bogus role, non-persisted or non-unique decision never becomes authority',async()=>{
 const alterations=[
  r=>r.ok=false,
  r=>r.approvalReadOnly=false,
  r=>r.decisionCreated=true,
  r=>r.signingPermitted=true,
  r=>r.dispatchPermitted=true,
  r=>r.releaseDecision='GO',
  r=>r.result.persistedTrustedReadProven=false,
  r=>r.result.approvalBindingMatched=false,
  r=>r.result.adminApprovalMatched=false,
  r=>r.result.signingPermitted=true,
  r=>r.result.decision.authMethod='dev_approval_token',
  r=>r.result.decision.authMethod='supabase_aal2',
  r=>r.result.decision.roleAtDecision='owner',
  r=>r.result.decision.decision='PENDING',
  r=>r.result.decision.claimsSha256='a'.repeat(64),
  r=>r.result.decision.actorId='wrong',
  r=>r.result.decision.recordedAt=now+5,
  r=>r.result.reason='FAKE_READ',
 ];
 for(const mutate of alterations){
  const f=fixture();mutate(f.reader);const g=gate(f);
  const r=await g.func({session:f.session,consent:f.consent});
  assert.equal(r.verified,false,mutate.toString());
  assert.equal(r.dispatchPermitted,false);
 }
});
test('expired claim and stale or future server reader observations fail closed',async()=>{
 const f=fixture();
 const old={...f.claims,expiresAt:now-1},g=gate(f,{readTrustedClaims:async()=>old});
 assert.equal((await g.func({session:f.session,consent:f.consent})).verified,false);
 let calls=0;
 const stale=gate(f,{clock:()=>++calls===1?now:now+3000});
 const r=await stale.func({session:f.session,consent:f.consent});
 assert.equal(r.verified,false);
 assert.equal(r.reason,'ISSUE159_READER_RESULT_STALE');
});
test('missing approved claims and reader errors cannot mint or infer consent',async()=>{
 const f=fixture();
 for(const o of [
  {readTrustedClaims:async()=>null},
  {readTrustedClaims:async()=>{throw Error('no claims')}},
  {readTrustedIntent:async()=>null},
  {readTrustedIntent:async()=>{throw Error('no socket')}},
 ]){
  const r=await gate(f,o).func({session:f.session,consent:f.consent});
  assert.equal(r.verified,false);
  assert.equal(r.releaseDecision,'NO_GO');
 }
});
test('gate never persists intents, imports private keys or connects browsers',async()=>{
 const {readFileSync}=await import('node:fs');
 const src=readFileSync(new URL('../../artifacts/api-server/src/lib/gpt02-issue159-persisted-owner-intent-gate.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(src,/privateKey|createPrivateKey|\.sign\(|INSERT INTO|UPDATE\s+|DELETE FROM|fetch\(|router\.post|app\.post/);
});
