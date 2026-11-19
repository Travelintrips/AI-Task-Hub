import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createGpt02Issue159OperatorBindingGate}
 from '../../artifacts/api-server/src/lib/gpt02-issue159-operator-binding-gate.mjs';

const now=Date.now(),env={
 NODE_ENV:'development',APP_ENV:'development',
 SESSION_SECRET:'SYNTHETIC_ONLY_ISSUE159_SESSION_SECRET_STANDALONE'
};
function fixture(){
 const hubOperatorSubject='synthetic_hub_text_owner_7';
 const session={
  // The real CST-DEV public.users.id is TEXT; it remains TEXT in JWT runtime.
  id:hubOperatorSubject,
  email:'owner@example.invalid',companyId:null,
  name:'Synthetic Owner',role:'super_admin',
  authSource:'supabase_google_identity',
  authSupabaseId:randomUUID(),authVerifiedAt:now
 };
 const proof={
  source:'issue159-verified-admin-operator-link',
  environment:'DEV',authSupabaseId:session.authSupabaseId,
  hubOperatorSubject,emailNormalized:'owner@example.invalid',
  hubRole:'super_admin',hubActive:true,
  adminRole:'super_admin',adminEnabled:true,mappingEnabled:true,
  observedAt:now,readOnly:true,signingPermitted:false,
  authorizationGranted:false,dispatchPermitted:false,releaseDecision:'NO_GO'
 };
 return {session,hubOperatorSubject,proof};
}
function setup(f,overrides={}){
 let calls=0,query=null;
 const gate=createGpt02Issue159OperatorBindingGate({
  env,clock:()=>now,readTrustedIssue159Mapping:async req=>{
   calls++;query=req;return f.proof;
  },...overrides});
 return {gate,getCalls:()=>calls,getLookup:()=>query};
}
test('PR196 signed Hub TEXT identity binds to the separate verified Issue159 Supabase Auth UUID without cast',async()=>{
 const f=fixture(),x=setup(f);
 const result=await x.gate({session:f.session,hubOperatorSubject:f.hubOperatorSubject});
 assert.equal(f.session.id,f.hubOperatorSubject);
 assert.equal(result.verified,true);
 assert.equal(result.hubOperatorSubject,f.hubOperatorSubject);
 assert.equal(result.reason,'ISSUE159_MAPPING_BOUND_NO_AUTHORITY');
 for(const k of ['signingPermitted','authorizationGranted','dispatchPermitted'])
  assert.equal(result[k],false);
 assert.equal(result.releaseDecision,'NO_GO');
 assert.equal(x.getCalls(),1);
 assert.deepEqual(x.getLookup(),{
  authSupabaseId:f.session.authSupabaseId,emailNormalized:'owner@example.invalid',
  hubOperatorSubject:f.hubOperatorSubject,
 });
 assert.equal(Object.isFrozen(x.getLookup()),true);
});
test('no Google proof, legacy JWT, staff, incorrect numeric/text ID, tenant spoof or invalid provider UUID fail before reader',async()=>{
 for(const change of [
  {authSource:'legacy_email'},{role:'staff'},{authVerifiedAt:now-11*60_000},
  {id:17},{id:0},{id:'another_hub_subject'},{authSupabaseId:'fake'},
  {companyId:'default'},{companyId:-1},{email:'no-email'},
 ]){
  const f=fixture(),x=setup(f);
  const r=await x.gate({session:{...f.session,...change},
   hubOperatorSubject:f.hubOperatorSubject});
  assert.equal(r.verified,false,JSON.stringify(change));
  assert.equal(x.getCalls(),0);
 }
});
test('real CST-DEV company_id nullable int4 is accepted but NEVER authorizes tenant or dispatch',async()=>{
 for(const companyId of [null,1,3]){
  const f=fixture(),x=setup(f);f.session.companyId=companyId;
  const r=await x.gate({session:f.session,hubOperatorSubject:f.hubOperatorSubject});
  assert.equal(r.verified,true,String(companyId));
  assert.equal(r.signingPermitted,false);
  assert.equal(r.authorizationGranted,false);
  assert.equal(r.dispatchPermitted,false);
  assert.equal(r.releaseDecision,'NO_GO');
 }
});
test('caller cannot supply identity map or choose the Hub account from email alone',async()=>{
 const f=fixture(),x=setup(f);
 for(const subject of ['','dev_approval_token','another.owner@example.invalid','other_hub_user']){
  const r=await x.gate({session:f.session,hubOperatorSubject:subject});
  assert.equal(r.verified,false);
 }
 const suspicious=await x.gate({session:f.session,
  hubOperatorSubject:f.hubOperatorSubject,
  mappingProof:{...f.proof,dispatchPermitted:true}});
 assert.equal(suspicious.verified,true);
 // The extra object was deliberately ignored; server-only trusted reader was
 // called and is the only proof source. Browser proof changes nothing.
 assert.equal(suspicious.dispatchPermitted,false);
});
test('wrong Issue159 auth UUID, Hub subject, role, email, disabled mapping or grant flags deny with NO_GO',async()=>{
 const base=fixture();
 const cases=[
  {authSupabaseId:randomUUID()},
  {hubOperatorSubject:'other_hub'},
  {emailNormalized:'other@example.invalid'},
  {hubRole:'staff'}, {hubActive:false},
  {adminRole:'owner'}, {adminEnabled:false},{mappingEnabled:false},
  {readOnly:false},{signingPermitted:true},{authorizationGranted:true},
  {dispatchPermitted:true},{releaseDecision:'GO'},
  {source:'caller_json'},{environment:'PROD'},
  {observedAt:now-3000},{observedAt:now+1},
  {extraFlag:true}
 ];
 for(const patch of cases){
  const f=fixture();f.proof={...f.proof,...patch};
  const x=setup(f);
  const r=await x.gate({session:f.session,hubOperatorSubject:f.hubOperatorSubject});
  assert.equal(r.verified,false,JSON.stringify(patch));
  assert.equal(r.dispatchPermitted,false);
  assert.equal(r.releaseDecision,'NO_GO');
 }
});
test('source missing and resolver down refuse without fallback to user id or email',async()=>{
 const f=fixture();
 for(const readTrustedIssue159Mapping of [
  async()=>null,async()=>{throw Error('OFFLINE')}
 ]){
  const x=setup(f,{readTrustedIssue159Mapping});
  const result=await x.gate({session:f.session,hubOperatorSubject:f.hubOperatorSubject});
  assert.equal(result.verified,false);
  assert.equal(result.signingPermitted,false);
 }
 assert.throws(()=>createGpt02Issue159OperatorBindingGate({
  env,readTrustedIssue159Mapping:null}));
});
test('server token freshness, independent read timing and DEV-only gate block stale mapping',async()=>{
 const f=fixture();
 const x=setup(f,{clock:()=>now+3000});
 const r=await x.gate({session:f.session,hubOperatorSubject:f.hubOperatorSubject});
 assert.equal(r.verified,false);
 const prod=setup(f,{env:{NODE_ENV:'production',APP_ENV:'production',SESSION_SECRET:env.SESSION_SECRET}});
 assert.equal((await prod.gate({session:f.session,hubOperatorSubject:f.hubOperatorSubject})).verified,false);
});
test('binding code has no crypto signing, private-key access, account creation or public route',()=>{
 const src=readFileSync(new URL('../../artifacts/api-server/src/lib/gpt02-issue159-operator-binding-gate.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(src,/privateKey|createPrivateKey|\.sign\(|INSERT INTO|UPDATE\s+|DELETE FROM|fetch\(|router\.post|app\.post/);
});
