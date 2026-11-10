import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,generateKeyPairSync,sign,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {canonicalIssuerLeaseEvidence} from '../src/lib/gpt02-issuer-lease-evidence.mjs';
import {canonicalApproval} from '../src/lib/gpt02-issuer-store.mjs';
import {canonicalOperatorLink,operatorLinkSigningBytes} from '../src/lib/gpt02-operator-link.mjs';
import {createPreparedNonceConsumer} from '../src/lib/gpt02-prepared-nonce-consumer.mjs';

const now=Date.now();
const keys=Object.fromEntries(['approval','hub','core','issuer'].map(n=>[n,generateKeyPairSync('ed25519')]));
const pub=n=>keys[n].publicKey.export({type:'spki',format:'pem'}).toString();
const publicKeys={approvalPublicKeyPem:pub('approval'),hubPublicKeyPem:pub('hub'),corePublicKeyPem:pub('core')};
const signLease=claims=>sign(null,Buffer.from('GPT02_ISSUER_LEASE_EVIDENCE_V1\n'+canonicalIssuerLeaseEvidence(claims)),keys.issuer.privateKey).toString('base64url');
const digest=x=>createHash('sha256').update(x).digest('hex');

function fixture(taskId=137){
 const ids={coreTaskId:randomUUID(),hubExecutionId:randomUUID(),commandCandidateId:randomUUID(),attemptId:randomUUID()};
 const prepared={companyId:'default',hubTaskId:taskId,memberId:5,memberAuditId:4567,operatorSubject:'google_fixture_operator',
  ...ids,expiresAt:now+90000};
 const job={companyId:'default',taskId,executionId:ids.hubExecutionId,status:'prepared',commandId:null,
  workerCommandCount:0,attemptNumber:1,dispatchStarted:false,memberId:5,memberAuditId:4567,operatorSubject:prepared.operatorSubject};
 const core={taskId:ids.coreTaskId,commandCandidateId:ids.commandCandidateId,attemptId:ids.attemptId,
  status:'PENDING',commandCount:0,runCount:0,workerId:'openclaw-dell-chatgpt-wake-dev',operatorUserId:77,
  operatorRole:'admin',operatorActive:true,passwordChanged:true};
 const hubOperator={subject:prepared.operatorSubject,role:'super_admin',active:true,memberId:5,accountableOwnerId:'fixture_owner'};
 const a={v:2,environment:'DEV',audience:'GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL',
  taskId,commandId:ids.commandCandidateId,attemptId:ids.attemptId,nonce:randomBytes(32).toString('base64url'),
  operatorNamespace:'ai-task-hub.public.users',superAdminId:prepared.operatorSubject,companyId:'default',
  issuedAt:now-20000,expiresAt:now+60000};
 const approvalDigest=digest(canonicalApproval(a));
 const l={v:1,environment:'DEV',audience:'GPT02_DUAL_ACCOUNT_COMMAND_LINK',
  linkId:randomUUID(),companyId:'default',hubTaskId:taskId,hubExecutionId:ids.hubExecutionId,
  coreTaskId:ids.coreTaskId,coreCommandId:a.commandId,attemptId:a.attemptId,attemptNumber:1,
  assigneeId:5,accountableOwnerId:'fixture_owner',hubOperatorNamespace:'ai-task-hub.public.users',
  hubOperatorId:prepared.operatorSubject,hubRole:'super_admin',hubActive:true,
  coreOperatorNamespace:'ai-core.ai_platform.internal_users',coreOperatorUserId:77,coreRole:'admin',
  coreActive:true,corePasswordChanged:true,workerId:core.workerId,approvalDigest,
  nonce:a.nonce,issuedAt:now-15000,expiresAt:now+45000};
 const proof={approval:{claims:a,signatureBase64url:sign(null,Buffer.from(canonicalApproval(a)),keys.approval.privateKey).toString('base64url')},
  operatorLink:{claims:l,
   hubSignatureBase64url:sign(null,operatorLinkSigningBytes(l,'hub'),keys.hub.privateKey).toString('base64url'),
   coreSignatureBase64url:sign(null,operatorLinkSigningBytes(l,'core'),keys.core.privateKey).toString('base64url')}};
 const receiptId=randomUUID(),fenceId=randomUUID(),linkDigest=digest(canonicalOperatorLink(l));
 const nonceReceipt={receiptId,commandId:a.commandId,nonce:a.nonce,digest:approvalDigest,consumedAt:now-3000};
 const identityReceipt={receiptId,commandId:a.commandId,linkId:l.linkId,operatorUserId:77,
  hubOperatorId:prepared.operatorSubject,linkDigest,bindingVerified:false,
  mayDispatchWorker:false,mayIssueGrant:false,mayCloseJob:false,coreLedgerWritten:false};
 const fence={fenceId,receiptId,commandId:a.commandId,linkId:l.linkId,
  hubExecutionId:ids.hubExecutionId,coreTaskId:ids.coreTaskId,attemptId:ids.attemptId,
  workerId:core.workerId,leaseEpoch:1,leaseStartedAt:now-2000,leaseExpiresAt:now+10000,
  dispatchAllowed:false,coreLedgerWritten:false};
 const claims={v:1,environment:'DEV',audience:'GPT02_ISSUER_LEASE_EVIDENCE_V1',
  companyId:'default',hubTaskId:taskId,hubExecutionId:ids.hubExecutionId,
  coreTaskId:ids.coreTaskId,commandId:a.commandId,attemptId:a.attemptId,workerId:core.workerId,
  receiptId,linkId:l.linkId,fenceId,approvalDigest,nonceDigest:digest(a.nonce),
  issuerRole:'dev_gpt02_issuer_evidence',leaseEpoch:1,issuedAt:now-1900,expiresAt:now+8000};
 const lease={claims,signatureBase64url:signLease(claims)};
 return {prepared,job,core,hubOperator,proof,publicKeys,nonceReceipt,identityReceipt,fence,lease,
  issuerPublicKeyPem:pub('issuer'),now};
}

const facts=x=>({
 prepared:x.prepared,job:x.job,core:x.core,hubOperator:x.hubOperator,
 observedAt:now-100,
 storedEvidence:{
  approval:{claims:x.proof.approval.claims,
    signatureBase64url:x.proof.approval.signatureBase64url,
    digest:digest(canonicalApproval(x.proof.approval.claims))},
  operatorLink:{claims:x.proof.operatorLink.claims,
    hubSignatureBase64url:x.proof.operatorLink.hubSignatureBase64url,
    coreSignatureBase64url:x.proof.operatorLink.coreSignatureBase64url,
    linkDigest:digest(canonicalOperatorLink(x.proof.operatorLink.claims))}
 }
});
const successReceipt=()=>({receiptId:randomUUID(),evidenceConsumed:true,authorizationGranted:false,dispatchPermitted:false,coreLedgerWritten:false});
function setup(x=fixture(),patchFacts=x=>x,issuerFn=async()=>successReceipt()){
 let reads=0,issued=0;
 const consumer=createPreparedNonceConsumer({
  publicKeys:x.publicKeys,clock:()=>now,
  readTrustedFacts:async lookup=>{
   reads++;
   assert.equal(lookup.hubTaskId,x.proof.approval.claims.taskId);
   assert.equal(lookup.commandCandidateId,x.proof.approval.claims.commandId);
   assert.equal(lookup.linkId,x.proof.operatorLink.claims.linkId);
   assert.equal(lookup.approvalDigest,digest(canonicalApproval(x.proof.approval.claims)));
   assert.match(lookup.linkDigest,/^[a-f0-9]{64}$/);
   return patchFacts(facts(x));
  },
  issuerStore:{async consumeLinkedApproval(proof){issued++;return issuerFn(proof);}}
 });
 return {consumer,calls:()=>({reads,issued})};
}
test('signed real verifier match calls restricted issuer exactly once and NEVER grants dispatch',async()=>{
 const x=fixture(),{consumer,calls}=setup(x);
 const v=await consumer.consume(x.proof);
 assert.equal(v.reason,'ATOMIC_NONCE_EVIDENCE_ONLY');
 assert.equal(v.evidenceConsumed,true);assert.equal(v.preparationVerified,true);
 for(const k of ['issuerLeaseGranted','dispatchPermitted','commandCreated','completionPermitted'])assert.equal(v[k],false);
 assert.equal(v.releaseDecision,'NO_GO');assert.deepEqual(calls(),{reads:1,issued:1});
});
for(const taskId of [135,136]){
 test('deny historically used Task'+taskId+' BEFORE database read and nonce write',async()=>{
  const x=fixture(taskId),{consumer,calls}=setup(x);
  const v=await consumer.consume(x.proof);
  assert.equal(v.evidenceConsumed,false);assert.deepEqual(calls(),{reads:0,issued:0});
 });
}
for(const [label,patch] of [
 ['expired prepared snapshot',x=>({...x,prepared:{...x.prepared,expiresAt:now-1}})],
 ['revoked Hub owner',x=>({...x,hubOperator:{...x.hubOperator,active:false}})],
 ['revoked Core operator',x=>({...x,core:{...x.core,operatorActive:false}})],
 ['foreign worker',x=>({...x,core:{...x.core,workerId:'foreign'}})],
 ['wrong Hub execution',x=>({...x,job:{...x.job,executionId:randomUUID()}})],
 ['wrong company',x=>({...x,job:{...x.job,companyId:'another'}})],
 ['existing worker command',x=>({...x,core:{...x.core,commandCount:1}})],
 ['stale signed source',x=>({...x,observedAt:now-3000})],
 ['future timestamp',x=>({...x,observedAt:now+100})],
 ['absent signed facts',()=>({})]
])test('deny '+label+' BEFORE issuing restricted nonce consumption',async()=>{
 const x=fixture(),{consumer,calls}=setup(x,patch);
 const result=await consumer.consume(x.proof);
 assert.equal(result.evidenceConsumed,false);assert.equal(result.dispatchPermitted,false);
 assert.equal(calls().issued,0);
});
test('valid alternate dual-signed operator link on same task cannot consume the original ledger link',async()=>{
 const x=fixture(),{consumer,calls}=setup(x);
 const claims={...x.proof.operatorLink.claims,issuedAt:now-100};
 const other={...x.proof,operatorLink:{
  claims,
  hubSignatureBase64url:sign(null,operatorLinkSigningBytes(claims,'hub'),keys.hub.privateKey).toString('base64url'),
  coreSignatureBase64url:sign(null,operatorLinkSigningBytes(claims,'core'),keys.core.privateKey).toString('base64url')
 }};
 const y=await consumer.consume(other);
 assert.equal(y.reason,'SIGNED_PROOF_DIFFERS_FROM_STORED_LEDGER');
 assert.equal(y.evidenceConsumed,false);assert.equal(y.dispatchPermitted,false);
 assert.equal(calls().issued,0);
});
test('persisted signature and digest swaps are denied before issuer DB write',async()=>{
 for(const delta of [
  {approval:{signatureBase64url:'Z'.repeat(86)}},
  {approval:{digest:'f'.repeat(64)}},
  {operatorLink:{hubSignatureBase64url:'Z'.repeat(86)}},
  {operatorLink:{coreSignatureBase64url:'Z'.repeat(86)}},
  {operatorLink:{linkDigest:'f'.repeat(64)}},
  {operatorLink:{claims:{invalid:'altered'}}}
 ]){
  const x=fixture(),y=setup(x,raw=>({...raw,storedEvidence:{
   approval:{...raw.storedEvidence.approval,...delta.approval},
   operatorLink:{...raw.storedEvidence.operatorLink,...delta.operatorLink}
  }}));
  const result=await y.consumer.consume(x.proof);
  assert.equal(result.evidenceConsumed,false);
  assert.equal(result.dispatchPermitted,false);
  assert.equal(y.calls().issued,0);
 }
});
test('tampered Ed25519 signature is rejected before issuer write',async()=>{
 const x=fixture(),{consumer,calls}=setup(x);
 const proof={...x.proof,operatorLink:{...x.proof.operatorLink,hubSignatureBase64url:'A'.repeat(86)}};
 const r=await consumer.consume(proof);
 assert.equal(r.evidenceConsumed,false);assert.equal(calls().issued,0);
});
test('all three independent signatures must verify BEFORE even a read-only DB task lookup',async()=>{
 for(const which of ['approval','hub','core']){
  const x=fixture(),{consumer,calls}=setup(x);
  const proof={...x.proof,approval:{...x.proof.approval},operatorLink:{...x.proof.operatorLink}};
  if(which==='approval')proof.approval.signatureBase64url='A'.repeat(86);
  if(which==='hub')proof.operatorLink.hubSignatureBase64url='A'.repeat(86);
  if(which==='core')proof.operatorLink.coreSignatureBase64url='A'.repeat(86);
  const out=await consumer.consume(proof);
  assert.equal(out.reason,'SIGNATURE_NOT_VERIFIED_BEFORE_DB_READ');
  assert.deepEqual(calls(),{reads:0,issued:0},which);
 }
});
test('validly signed but altered task metadata cannot cause unscoped identity lookup',async()=>{
 const x=fixture(),{consumer,calls}=setup(x);
 const forged={...x.proof,operatorLink:{...x.proof.operatorLink,
 claims:{...x.proof.operatorLink.claims,companyId:'another'}}};
 const result=await consumer.consume(forged);
 assert.equal(result.evidenceConsumed,false);
 assert.deepEqual(calls(),{reads:0,issued:0});
});
test('caller-supplied keys, prepared snapshot or clock cannot bypass independent trust reader',async()=>{
 const x=fixture(),{consumer,calls}=setup(x);
 for(const key of ['publicKeys','issuerStore','prepared','job','clock']){
  const r=await consumer.consume({...x.proof,[key]:{}});
  assert.equal(r.evidenceConsumed,false);assert.equal(r.reason,'UNTRUSTED_APPROVAL_INPUT');
 }
 assert.deepEqual(calls(),{reads:0,issued:0});
});
test('separate pinned public keys are compulsory, and cannot be the same signer',()=>{
 const x=fixture();
 assert.throws(()=>createPreparedNonceConsumer({readTrustedFacts:async()=>facts(x),
  issuerStore:{consumeLinkedApproval:async()=>successReceipt()},publicKeys:{
   ...x.publicKeys,corePublicKeyPem:x.publicKeys.hubPublicKeyPem
  }}),/GPT02_THREE_INDEPENDENT_KEYS_REQUIRED/);
});
test('issuer returning fake authority, wrong receipt ID or incomplete result is never accepted',async()=>{
 const x=fixture();
 for(const data of [{...successReceipt(),dispatchPermitted:true},
  {...successReceipt(),authorizationGranted:true},
  {...successReceipt(),coreLedgerWritten:true},
  {evidenceConsumed:true,receiptId:'not-a-uuid'},
  null]){
  const y=setup(x,z=>z,async()=>data);
  const result=await y.consumer.consume(x.proof);
  assert.equal(result.evidenceConsumed,false);
  assert.equal(result.dispatchPermitted,false);
  assert.equal(y.calls().issued,1);
 }
});
test('issuer failure is sanitized and does not re-open dispatch',async()=>{
 const x=fixture();
 const y=setup(x,z=>z,async()=>{throw Error('synthetic secret or connection string');});
 const v=await y.consumer.consume(x.proof);
 assert.equal(v.reason,'TRUSTED_READ_OR_ISSUER_TRANSACTION_FAILED');
 assert.equal(JSON.stringify(v).includes('synthetic secret'),false);
 assert.equal(v.dispatchPermitted,false);
});
test('parallel consumption attempts use one local in-flight process guard; DB uniqueness remains authoritative',async()=>{
 const x=fixture();let release;
 const hold=new Promise(resolve=>{release=resolve});
 let successes=0;
 const y=setup(x,z=>z,async()=>{await hold;successes++;return successReceipt();});
 const promises=Array.from({length:8},()=>y.consumer.consume(x.proof));
 await Promise.resolve();release();
 const results=await Promise.all(promises);
 assert.equal(results.filter(r=>r.evidenceConsumed===true).length,1);
 assert.equal(results.filter(r=>r.reason==='LOCAL_DUPLICATE_CONSUMPTION').length,7);
 assert.equal(successes,1);
 assert.equal(y.calls().issued,1);
 for(const r of results)assert.equal(r.dispatchPermitted,false);
});
test('module has no live HTTP/worker integration and never returns dispatch authority',()=>{
 const c=readFileSync(new URL('../src/lib/gpt02-prepared-nonce-consumer.mjs',import.meta.url),'utf8');
 for(const bad of ['new Pool','INSERT INTO','UPDATE ','DELETE FROM','submitAiTask','sendCommand','leaseGranted:true','dispatchPermitted:true'])
 assert.equal(c.includes(bad),false,bad);
 const route=readFileSync(new URL('../src/routes/executions.ts',import.meta.url),'utf8');
 assert.equal(route.includes('gpt02-prepared-nonce-consumer'),false);
 assert.match(route,/GPT02_LIFECYCLE_PRE_DISPATCH_PROOF_REQUIRED/);
});

test('operational DEV rejects injected caller signer keys before opening a DB session',()=>{
 const moduleUrl=new URL('../src/lib/gpt02-prepared-nonce-consumer.mjs',import.meta.url).href;
 const subprocess=`
 import {createPreparedNonceConsumer} from ${JSON.stringify(moduleUrl)};
 let used=false;
 try {
  createPreparedNonceConsumer({readTrustedFacts:async()=>{used=true;},issuerStore:{consumeLinkedApproval:async()=>{used=true;}},
   publicKeys:{approvalPublicKeyPem:'untrusted'}});
  process.stdout.write('UNEXPECTED_PASS');
 }catch(e){process.stdout.write(e.message+' used='+used);}
 `;
 const out=spawnSync(process.execPath,['--input-type=module','-e',subprocess],
  {encoding:'utf8',env:{...process.env,NODE_ENV:'development',APP_ENV:'development'},timeout:5000});
 assert.equal(out.status,0,out.stderr);
 assert.equal(out.stdout,'GPT02_CALLER_SIGNER_KEYS_FORBIDDEN used=false');
});
test('operational DEV without four independently pinned public files refuses admission',()=>{
 const moduleUrl=new URL('../src/lib/gpt02-prepared-nonce-consumer.mjs',import.meta.url).href;
 const subprocess=`
 import {createPreparedNonceConsumer} from ${JSON.stringify(moduleUrl)};
 let used=false;
 try{
  createPreparedNonceConsumer({readTrustedFacts:async()=>{used=true;},issuerStore:{consumeLinkedApproval:async()=>{used=true;}},
   expectedFingerprints:{approval:'a'.repeat(64),hub:'b'.repeat(64),core:'c'.repeat(64),issuer:'d'.repeat(64)}});
  process.stdout.write('UNEXPECTED_PASS');
 }catch(e){process.stdout.write((e.code||e.message)+' used='+used);}
 `;
 const out=spawnSync(process.execPath,['--input-type=module','-e',subprocess],
  {encoding:'utf8',env:{...process.env,NODE_ENV:'development',APP_ENV:'development'},timeout:5000});
 assert.equal(out.status,0,out.stderr);
 assert.equal(out.stdout,'TRUST_STORE_DIRECTORY_NOT_FOUND used=false');
});
