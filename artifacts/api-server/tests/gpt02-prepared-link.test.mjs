import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,generateKeyPairSync,sign,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {inspectPreparedSignedLink as inspect} from '../src/lib/gpt02-prepared-link.mjs';
import {canonicalApproval} from '../src/lib/gpt02-issuer-store.mjs';
import {canonicalOperatorLink,operatorLinkSigningBytes,createOperatorLinkVerifier} from '../src/lib/gpt02-operator-link.mjs';
const now=Date.now();
const approvalKeys=generateKeyPairSync('ed25519'),hubKeys=generateKeyPairSync('ed25519'),coreKeys=generateKeyPairSync('ed25519');
const publicKeys={approvalPublicKeyPem:approvalKeys.publicKey.export({type:'spki',format:'pem'}).toString(),
 hubPublicKeyPem:hubKeys.publicKey.export({type:'spki',format:'pem'}).toString(),
 corePublicKeyPem:coreKeys.publicKey.export({type:'spki',format:'pem'}).toString()};
function fixture(){
 const prepared={companyId:'default',hubTaskId:137,memberId:5,memberAuditId:4567,
  operatorSubject:'google_fixture_operator',coreTaskId:randomUUID(),hubExecutionId:randomUUID(),commandCandidateId:randomUUID(),attemptId:randomUUID(),expiresAt:now+90000};
 const job={companyId:'default',taskId:137,executionId:prepared.hubExecutionId,status:'prepared',commandId:null,workerCommandCount:0,
  attemptNumber:1,dispatchStarted:false,memberId:5,memberAuditId:4567,operatorSubject:'google_fixture_operator'};
 const core={taskId:prepared.coreTaskId,commandCandidateId:prepared.commandCandidateId,attemptId:prepared.attemptId,
  status:'PENDING',commandCount:0,runCount:0,workerId:'openclaw-dell-chatgpt-wake-dev',operatorUserId:77,
  operatorRole:'admin',operatorActive:true,passwordChanged:true};
 const hubOperator={subject:prepared.operatorSubject,role:'super_admin',active:true,memberId:5,accountableOwnerId:'fixture_owner'};
 const a={v:2,environment:'DEV',audience:'GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL',taskId:137,
  commandId:prepared.commandCandidateId,attemptId:prepared.attemptId,nonce:randomBytes(32).toString('base64url'),
  operatorNamespace:'ai-task-hub.public.users',superAdminId:prepared.operatorSubject,companyId:'default',
  issuedAt:now-100,expiresAt:now+60000};
 const digest=createHash('sha256').update(canonicalApproval(a)).digest('hex');
 const l={v:1,environment:'DEV',audience:'GPT02_DUAL_ACCOUNT_COMMAND_LINK',
  linkId:randomUUID(),companyId:'default',hubTaskId:137,hubExecutionId:job.executionId,
  coreTaskId:prepared.coreTaskId,coreCommandId:a.commandId,attemptId:a.attemptId,attemptNumber:1,
  assigneeId:5,accountableOwnerId:'fixture_owner',hubOperatorNamespace:'ai-task-hub.public.users',
  hubOperatorId:prepared.operatorSubject,hubRole:'super_admin',hubActive:true,
  coreOperatorNamespace:'ai-core.ai_platform.internal_users',coreOperatorUserId:77,coreRole:'admin',
  coreActive:true,corePasswordChanged:true,workerId:core.workerId,approvalDigest:digest,
  nonce:a.nonce,issuedAt:now-50,expiresAt:now+45000};
 const signed={approval:{claims:a,signatureBase64url:sign(null,Buffer.from(canonicalApproval(a)),approvalKeys.privateKey).toString('base64url')},
  operatorLink:{claims:l,
   hubSignatureBase64url:sign(null,operatorLinkSigningBytes(l,'hub'),hubKeys.privateKey).toString('base64url'),
   coreSignatureBase64url:sign(null,operatorLinkSigningBytes(l,'core'),coreKeys.privateKey).toString('base64url')}};
 return {prepared,job,core,hubOperator,proof:signed,publicKeys,now};
}
test('correct independent synthetic signed chain matches without providing approval/nonce/dispatch',()=>{
 const v=inspect(fixture());assert.equal(v.matched,true);assert.equal(v.reason,'MATCHED_NOT_RECORDED');
 for(const field of ['approvalRecorded','nonceConsumed','issuerPermitted','dispatchPermitted','completionPermitted'])assert.equal(v[field],false);
 assert.equal(v.readOnly,true);assert.equal(v.signatureVerified,true);assert.equal(v.dualOriginVerified,true);
 assert.equal(v.identifiers.hubTaskId,137);assert.match(v.approvalDigest,/^[a-f0-9]{64}$/);
});
test('the signed canonical approval has one exact independently bound prepared command',()=>{
 const x=fixture(),v=inspect(x);
 assert.equal(v.identifiers.commandCandidateId,x.prepared.commandCandidateId);
 assert.equal(v.identifiers.attemptId,x.prepared.attemptId);
 assert.equal(v.identifiers.executionId,x.job.executionId);
 assert.equal(v.identifiers.executionId,x.prepared.hubExecutionId);
 assert.equal(v.identifiers.coreTaskId,x.core.taskId);
});
for(const [part,changes,name] of [
 ['prepared',{hubTaskId:135},'forbidden Task135'],
 ['prepared',{hubTaskId:136},'completed Task136'],
 ['prepared',{hubTaskId:138},'other Hub task'],
 ['prepared',{companyId:'other'},'tenant swap'],
 ['prepared',{memberId:6},'PIC swap'],
 ['prepared',{memberAuditId:99},'PIC audit swap'],
 ['prepared',{operatorSubject:'other'},'operator subject swap'],
 ['prepared',{coreTaskId:randomUUID()},'Core task swap'],
 ['prepared',{hubExecutionId:randomUUID()},'immutable Hub reservation ID swap'],
 ['prepared',{hubExecutionId:null},'missing immutable Hub reservation ID'],
 ['prepared',{commandCandidateId:randomUUID()},'command swap'],
 ['prepared',{attemptId:randomUUID()},'attempt swap'],
 ['prepared',{expiresAt:now-1},'expired preparation'],
 ['job',{executionId:randomUUID()},'Hub job ID swap'],
 ['job',{taskId:138},'Hub task mismatch'],
 ['job',{status:'dispatched'},'already dispatched Hub job'],
 ['job',{workerCommandCount:1},'existing worker command'],
 ['job',{attemptNumber:2},'second Hub attempt'],
 ['job',{memberAuditId:111},'Hub audit replacement'],
 ['job',{dispatchStarted:true},'dispatch already started'],
 ['job',{commandId:randomUUID()},'a real command already exists'],
 ['core',{status:'RUNNING'},'Core task already running'],
 ['core',{runCount:1},'Core run already created'],
 ['core',{commandCount:1},'Core command already created'],
 ['core',{workerId:'openclaw-pchp-dev'},'worker mismatch'],
 ['core',{operatorUserId:78},'Core operator mismatch'],
 ['core',{operatorRole:'staff'},'Core role mismatch'],
 ['core',{operatorActive:false},'Core operator inactive'],
 ['core',{passwordChanged:false},'Core provider password unverified'],
 ['hubOperator',{subject:'different'},'Hub account mismatch'],
 ['hubOperator',{role:'staff'},'Hub role mismatch'],
 ['hubOperator',{active:false},'Hub Super Admin inactive'],
 ['hubOperator',{memberId:6},'Hub assignee mismatch'],
 ['hubOperator',{accountableOwnerId:'different'},'accountable owner mismatch'],
])test(`refuse ${name} even when every signature is otherwise valid`,()=>{
 const x=fixture();x[part]={...x[part],...changes};const out=inspect(x);
 assert.equal(out.matched,false);assert.equal(out.dispatchPermitted,false);assert.equal(out.approvalRecorded,false);assert.equal(out.nonceConsumed,false);
});
for(const [part,changes,name] of [
 ['approval',{claims:null},'missing approval claims'],
 ['approval',{signatureBase64url:'A'.repeat(86)},'bad approval signature'],
 ['approval',{publicKeyPem:'-----BEGIN PUBLIC KEY-----'},'caller-claimed public key'],
 ['operatorLink',{hubSignatureBase64url:'A'.repeat(86)},'forged Hub signature'],
 ['operatorLink',{coreSignatureBase64url:'A'.repeat(86)},'forged Core signature'],
])test(`reject ${name}`,()=>{
 const x=fixture();x.proof[part]={...x.proof[part],...changes};const y=inspect(x);
 assert.equal(y.matched,false);assert.equal(y.dispatchPermitted,false);
});
test('reject one key masquerading as two or three independent signers',()=>{
 const x=fixture();for(const key of ['hubPublicKeyPem','corePublicKeyPem']){
  const p={...x.publicKeys,[key]:x.publicKeys.approvalPublicKeyPem};
  assert.equal(inspect({...x,publicKeys:p}).matched,false);
 }
 assert.equal(inspect({...x,publicKeys:{...x.publicKeys,corePublicKeyPem:x.publicKeys.hubPublicKeyPem}}).matched,false);
});
test('reject a valid but expired dual-origin link, without database writes',()=>{
 const x=fixture();assert.equal(inspect({...x,now:now+46000}).matched,false);
});
test('reject valid signatures whose approval record was not tied to a preexisting Hub execution',()=>{
 const x=fixture();assert.equal(inspect({...x,job:{...x.job,executionId:null}}).matched,false);
});
test('the validator has zero database connectivity or operational dispatch imports',()=>{
 const source=readFileSync(new URL('../src/lib/gpt02-prepared-link.mjs',import.meta.url),'utf8');
 for(const forbidden of ['db.query','new Pool','submitAiTask','dispatchExternal','GenUI','recordLinkedApproval(','consumeLinkedApproval(','INSERT INTO','UPDATE ','DELETE FROM'])
 assert.equal(source.includes(forbidden),false,forbidden);
 const routes=readFileSync(new URL('../src/routes/executions.ts',import.meta.url),'utf8');
 assert.equal(routes.includes('gpt02-prepared-link'),false);
 assert.ok(routes.includes('GPT02_LIFECYCLE_PRE_DISPATCH_PROOF_REQUIRED'));
});

test('direct operator-link verifier rejects Task135 and Task136 even with fresh valid dual signatures',()=>{
 const verifyLink=createOperatorLinkVerifier({hubPublicKeyPem:publicKeys.hubPublicKeyPem,corePublicKeyPem:publicKeys.corePublicKeyPem});
 for(const taskId of [135,136,137]){
  const x=fixture();
  const approval={...x.proof.approval.claims,taskId};
  const approvalDigest=createHash('sha256').update(canonicalApproval(approval)).digest('hex');
  const link={...x.proof.operatorLink.claims,hubTaskId:taskId,approvalDigest};
  const proof={claims:link,
   hubSignatureBase64url:sign(null,operatorLinkSigningBytes(link,'hub'),hubKeys.privateKey).toString('base64url'),
   coreSignatureBase64url:sign(null,operatorLinkSigningBytes(link,'core'),coreKeys.privateKey).toString('base64url')};
  if(taskId<=136)assert.throws(()=>verifyLink(proof,approval,approvalDigest,now),/INVALID_OR_EXPIRED_OPERATOR_LINK/);
  else assert.equal(verifyLink(proof,approval,approvalDigest,now).hubOperatorId,link.hubOperatorId);
 }
});
