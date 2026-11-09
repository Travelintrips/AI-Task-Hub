import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash,generateKeyPairSync,randomBytes,randomUUID,sign} from 'node:crypto';
import {inspectPreparedSignedLink} from '/tmp/gpt02-prepared-link.mjs';
import {canonicalApproval} from '/tmp/gpt02-issuer-store.mjs';
import {operatorLinkSigningBytes} from '/tmp/gpt02-operator-link.mjs';
if(process.env.GPT02_CORE_FIXTURE_ONLY!=='1')throw Error('ISOLATED_FIXTURE_REQUIRED');
const req=createRequire('/app/artifacts/api-server/package.json');
const {Pool}=req('pg');
const pool=new Pool({host:'/var/run/postgresql',database:'gpt02_core_preparation_isolated',user:'postgres',max:1,connectionTimeoutMillis:3000});
try {
 const read=async(sql,args=[])=> (await pool.query(sql,args)).rows;
 const [p]=await read('SELECT company_id,hub_task_id,member_id,member_audit_id,operator_subject,core_task_id,hub_execution_id,command_candidate_id,attempt_id,expires_at FROM gpt02_stage.core_preparations WHERE hub_task_id=137');
 assert.ok(p);
 const [j]=await read('SELECT * FROM public.ai_execution_jobs WHERE id=$1',[p.hub_execution_id]);
 const [t]=await read('SELECT id,status FROM ai_platform.ai_coding_tasks WHERE id=$1',[p.core_task_id]);
 const [u]=await read('SELECT id,role,is_active FROM public.users WHERE id=$1',[p.operator_subject]);
 const [operator]=await read('SELECT id,role,status,must_change_password FROM ai_platform.internal_users WHERE id=77');
 const [audit]=await read('SELECT id,after FROM public.audit_logs WHERE id=$1',[p.member_audit_id]);
 const [counts]=await read('SELECT (SELECT count(*)::int FROM ai_platform.ai_coding_runs WHERE task_id=$1) AS core_runs, (SELECT count(*)::int FROM ai_platform.ai_coding_bridge_commands WHERE task_id=$1) AS core_commands, (SELECT count(*)::int FROM public.ai_execution_jobs WHERE task_id=137) AS hub_jobs',[p.core_task_id]);
 assert.ok(j&&t&&u&&operator&&audit);assert.equal(counts.core_runs,0);assert.equal(counts.core_commands,0);assert.equal(counts.hub_jobs,1);
 assert.equal(j.command_id,null);assert.equal(j.status,'prepared');assert.equal(j.worker_id,null);assert.equal(j.assigned_client_id,null);
 assert.equal(j.metadata.commandCandidateId,p.command_candidate_id);assert.equal(j.metadata.coreTaskId,p.core_task_id);
 assert.equal(j.metadata.attemptId,p.attempt_id);assert.equal(j.metadata.dispatchStarted,false);
 assert.equal(audit.id,p.member_audit_id);
 const prepared={companyId:p.company_id,hubTaskId:p.hub_task_id,memberId:p.member_id,memberAuditId:p.member_audit_id,
  operatorSubject:p.operator_subject,coreTaskId:p.core_task_id,commandCandidateId:p.command_candidate_id,attemptId:p.attempt_id,
  expiresAt:new Date(p.expires_at).getTime()};
 const job={companyId:j.company_id,taskId:j.task_id,executionId:j.id,status:j.status,commandId:j.command_id,
  workerCommandCount:0,attemptNumber:j.metadata.attemptNumber,dispatchStarted:j.metadata.dispatchStarted,
  memberId:j.metadata.memberId,memberAuditId:j.metadata.memberAuditId,operatorSubject:j.metadata.operatorSubject};
 const core={taskId:t.id,commandCandidateId:p.command_candidate_id,attemptId:p.attempt_id,status:t.status,
  commandCount:counts.core_commands,runCount:counts.core_runs,workerId:'openclaw-dell-chatgpt-wake-dev',
  operatorUserId:operator.id,operatorRole:operator.role,operatorActive:operator.status==='active',passwordChanged:operator.must_change_password===false};
 const hubOperator={subject:u.id,role:u.role,active:u.is_active,memberId:p.member_id,accountableOwnerId:'fixture_owner'};
 const keys=[generateKeyPairSync('ed25519'),generateKeyPairSync('ed25519'),generateKeyPairSync('ed25519')];
 const now=Date.now(),expiresAt=Math.min(now+60000,prepared.expiresAt-10000);
 assert.ok(expiresAt>now);
 const approval={v:2,environment:'DEV',audience:'GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL',taskId:137,
  commandId:p.command_candidate_id,attemptId:p.attempt_id,nonce:randomBytes(32).toString('base64url'),
  operatorNamespace:'ai-task-hub.public.users',superAdminId:p.operator_subject,companyId:p.company_id,
  issuedAt:now-100,expiresAt};
 const digest=createHash('sha256').update(canonicalApproval(approval)).digest('hex');
 const link={v:1,environment:'DEV',audience:'GPT02_DUAL_ACCOUNT_COMMAND_LINK',
  linkId:randomUUID(),companyId:'default',hubTaskId:137,hubExecutionId:p.hub_execution_id,
  coreTaskId:p.core_task_id,coreCommandId:p.command_candidate_id,attemptId:p.attempt_id,attemptNumber:1,
  assigneeId:p.member_id,accountableOwnerId:'fixture_owner',hubOperatorNamespace:'ai-task-hub.public.users',
  hubOperatorId:p.operator_subject,hubRole:'super_admin',hubActive:true,
  coreOperatorNamespace:'ai-core.ai_platform.internal_users',coreOperatorUserId:operator.id,coreRole:operator.role,
  coreActive:true,corePasswordChanged:true,workerId:core.workerId,approvalDigest:digest,
  nonce:approval.nonce,issuedAt:now-50,expiresAt:expiresAt-1000};
 const proof={approval:{claims:approval,signatureBase64url:sign(null,Buffer.from(canonicalApproval(approval)),keys[0].privateKey).toString('base64url')},
  operatorLink:{claims:link,hubSignatureBase64url:sign(null,operatorLinkSigningBytes(link,'hub'),keys[1].privateKey).toString('base64url'),
   coreSignatureBase64url:sign(null,operatorLinkSigningBytes(link,'core'),keys[2].privateKey).toString('base64url')}};
 const publicKeys={approvalPublicKeyPem:keys[0].publicKey.export({format:'pem',type:'spki'}).toString(),
  hubPublicKeyPem:keys[1].publicKey.export({format:'pem',type:'spki'}).toString(),
  corePublicKeyPem:keys[2].publicKey.export({format:'pem',type:'spki'}).toString()};
 const input={prepared,job,core,hubOperator,proof,publicKeys,now};
 const value=inspectPreparedSignedLink(input);
 assert.equal(value.matched,true);assert.equal(value.signatureVerified,true);assert.equal(value.dualOriginVerified,true);
 assert.equal(value.identifiers.coreTaskId,p.core_task_id);assert.equal(value.identifiers.executionId,p.hub_execution_id);
 for(const k of ['approvalRecorded','nonceConsumed','issuerPermitted','dispatchPermitted','completionPermitted']) assert.equal(value[k],false);
 for(const change of [{job:{...job,executionId:randomUUID()}},{core:{...core,taskId:randomUUID()}},
 {prepared:{...prepared,memberAuditId:prepared.memberAuditId+1}},
 {job:{...job,status:'dispatched'}},{core:{...core,operatorUserId:78}}]){
  const rejected=inspectPreparedSignedLink({...input,...change});assert.equal(rejected.matched,false);assert.equal(rejected.dispatchPermitted,false);
 }
 console.log('REAL_POSTGRES_HUB_CORE_PREPARATION_TO_THREE_SYNTHETIC_SIGNATURES_PASS; one task + one Hub execution, exact immutable IDs, 5 adversarial mismatches denied, zero operational authority');
} finally {await pool.end();}
