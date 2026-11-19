import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createGpt02SingleOwnerTrustedFactAdapter} from '../../artifacts/api-server/src/lib/gpt02-single-owner-trusted-facts-adapter.mjs';
const env={NODE_ENV:'development',APP_ENV:'development'};
const now=Date.now();
function caseData(){
 const request={companyId:'default',hubTaskId:172,commandCandidateId:randomUUID(),attemptId:randomUUID()};
 const p={companyId:'default',hubTaskId:172,memberId:7,memberAuditId:85,
  operatorSubject:'fixture_owner',coreTaskId:randomUUID(),hubExecutionId:randomUUID(),
  commandCandidateId:request.commandCandidateId,attemptId:request.attemptId,expiresAt:now+90000};
 const obj={prepared:p,
  job:{companyId:'default',taskId:172,executionId:p.hubExecutionId,status:'prepared',
   commandId:null,workerCommandCount:0,attemptNumber:1,dispatchStarted:false,
   memberId:7,memberAuditId:85,operatorSubject:p.operatorSubject},
  core:{taskId:p.coreTaskId,commandCandidateId:p.commandCandidateId,attemptId:p.attemptId,
   status:'PENDING',commandCount:0,runCount:0,workerId:'openclaw-dell-chatgpt-wake-dev',
   operatorUserId:77,operatorRole:'admin',operatorActive:true,passwordChanged:true},
  hubOperator:{subject:p.operatorSubject,role:'super_admin',active:true,memberId:7,
   accountableOwnerId:'fixture_owner'},
  hubAssignment:{action:'gpt02_pic_assigned',entityId:'172',actorId:p.operatorSubject,
   actorRole:'super_admin',actorActive:true},
  observedAt:now,
  trustedReadProof:{source:'gpt02-issue159-presign-reader',environment:'DEV',
   hubRole:'gpt02_hub_evidence_reader',coreRole:'gpt02_core_evidence_reader',
   separateBackends:true,clientTlsVerified:true,readOnly:true,
   signingPermitted:false,authorizationGranted:false,dispatchPermitted:false,releaseDecision:'NO_GO'}};
 return {request,obj};
}
const reader=(x,options={})=>createGpt02SingleOwnerTrustedFactAdapter({
 env,clock:()=>now,readPreSignFacts:async()=>x,maxAgeMs:2000,...options
});
test('independently authenticated presign result maps exactly four frozen facts, no authority',async()=>{
 const {request,obj}=caseData(),r=await reader(obj)(request);
 assert.deepEqual(Object.keys(r).sort(),['core','hubOperator','job','prepared']);
 assert.equal(Object.isFrozen(r),true);
 for(const part of Object.values(r))assert.equal(Object.isFrozen(part),true);
 assert.equal(r.core.status,'PENDING');assert.equal(r.job.dispatchStarted,false);
});
test('historical Task171, PROD and request-supplied facts never reach readers',async()=>{
 const {request,obj}=caseData();
 for(const q of [{...request,hubTaskId:171},{...request,companyId:'PROD'},
  {...request,untrustedSigner:true},{...request,attemptId:request.commandCandidateId}]){
  let calls=0;const read=reader(obj,{readPreSignFacts:async()=>{calls++;return obj}});
  await assert.rejects(read(q),/FRESH_DEV_TASK_BINDING_REQUIRED/);assert.equal(calls,0);
 }
 await assert.rejects(reader(obj,{env:{NODE_ENV:'production',APP_ENV:'production'}})(request),/FRESH_DEV_TASK_BINDING_REQUIRED/);
});
test('missing identity isolation, unverifiable TLS or wrong roles fail closed',async()=>{
 const {request,obj}=caseData();
 for(const [key,value] of [['source','unreviewed'],['environment','PROD'],
  ['hubRole','postgres'],['coreRole','postgres'],['separateBackends',false],
  ['clientTlsVerified',false],['readOnly',false],['signingPermitted',true],
  ['authorizationGranted',true],['dispatchPermitted',true],['releaseDecision','GO']]){
  const mutated=structuredClone(obj);mutated.trustedReadProof[key]=value;
  await assert.rejects(reader(mutated)(request),/INDEPENDENT_READONLY_PROOF_REQUIRED/,key);
 }
});
test('stale, future or expired readbacks cannot be signed',async()=>{
 const {request,obj}=caseData();
 for(const [key,value] of [['observedAt',now-2001],['observedAt',now+1]]){
  const mutated={...obj,[key]:value};
  await assert.rejects(reader(mutated)(request),/TRUSTED_READ_EXPIRED/);
 }
 await assert.rejects(reader({...obj,prepared:{...obj.prepared,expiresAt:now-1}})(request),/CANONICAL_HUB_CORE_FACTS_NOT_MATCHED/);
});
test('cross-company, orphan job, wrong command, worker spoof, and PIC audit change are denied',async()=>{
 const {request,obj}=caseData();
 const variants=[
  {prepared:{...obj.prepared,hubTaskId:173}},
  {job:{...obj.job,executionId:randomUUID()}},
  {core:{...obj.core,commandCandidateId:randomUUID()}},
  {core:{...obj.core,workerId:'untrusted-other-worker'}},
  {hubOperator:{...obj.hubOperator,subject:'other'}},
  {hubAssignment:{...obj.hubAssignment,entityId:'173'}},
  {job:{...obj.job,dispatchStarted:true}},
  {core:{...obj.core,status:'COMPLETED'}},
 ];
 for(const variant of variants){
  await assert.rejects(reader({...obj,...variant})(request),/CANONICAL_HUB_CORE_FACTS_NOT_MATCHED/);
 }
});
test('unavailable or incomplete independent read does not silently synthesize claims',async()=>{
 const {request,obj}=caseData();
 await assert.rejects(reader(null)(request),/INDEPENDENT_READONLY_PROOF_REQUIRED/);
 await assert.rejects(reader({...obj,observedAt:undefined})(request),/TRUSTED_READ_EXPIRED/);
 await assert.rejects(reader(obj,{readPreSignFacts:async()=>{throw Error('DB_DOWN')}})(request),/DB_DOWN/);
});
test('adapter never imports a DB writer, signature generator, browser or live worker',async()=>{
 const {readFileSync}=await import('node:fs');
 const content=readFileSync(new URL('../../artifacts/api-server/src/lib/gpt02-single-owner-trusted-facts-adapter.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(content,/createPrivateKey|sign\(|INSERT INTO|UPDATE\s+|DELETE FROM|fetch\(|Router\(|router\.post/);
});
