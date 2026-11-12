/**
 * DEV-only pre-sign Hub/Core evidence reader.
 *
 * Reads immutable preparation, PIC audit, Hub Super Admin and the uniquely
 * email-matched Core owner/admin before any Issue159 signature exists.
 * Read-only only: no DML, no signing, no nonce/lease/dispatch.
 */
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const ROLE_HUB='gpt02_hub_evidence_reader';
const ROLE_CORE='gpt02_core_evidence_reader';
const WORKER='openclaw-dell-chatgpt-wake-dev';
const denied=code=>{const e=new Error(code);e.code=code;throw e;};
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(obj,keys)=>object(obj)&&Object.keys(obj).sort().join(',')===[...keys].sort().join(',');
const integer=v=>Number.isSafeInteger(v)&&v>0;

const IDENTITY_SQL=[
 "SELECT current_database() AS db,current_user AS login,session_user AS session,",
 " current_setting('transaction_read_only') AS read_only,",
 " current_setting('default_transaction_read_only')='on' AS default_readonly,",
 " current_setting('search_path')='pg_catalog' AS search_path_locked,",
 " pg_backend_pid() AS backend_pid,",
 " EXISTS(SELECT 1 FROM pg_stat_ssl s WHERE s.pid=pg_backend_pid() AND s.ssl) AS tls_verified",
].join(' ');

const HUB_PRESIGN_SQL=[
 "SELECT p.company_id,p.hub_task_id,p.member_id,p.member_audit_id,p.operator_subject,",
 " p.core_task_id::text AS core_task_id,p.hub_execution_id::text AS hub_execution_id,",
 " p.command_candidate_id::text AS command_candidate_id,p.attempt_id::text AS attempt_id,",
 " floor(extract(epoch FROM p.expires_at)*1000)::float8 AS expires_ms,",
 " t.assigned_to_id,t.assigned_to,t.status AS task_status,t.title AS task_title,",
 " m.name AS member_name,m.is_active AS member_active,",
 " u.id AS hub_user_id,u.role AS hub_role,u.is_active AS hub_active,",
 " u.status AS hub_status,u.company_id AS hub_company_id,u.email AS hub_email,",
 " a.id AS audited_member_record,a.action AS audit_action,a.entity_id AS audit_entity_id,",
 " a.after AS audit_payload,a.user_email AS audit_user_email,",
 " (SELECT MAX(z.id) FROM public.audit_logs z WHERE z.company_id=p.company_id",
 "   AND z.entity_id=p.hub_task_id::text AND z.action='gpt02_pic_assigned') AS latest_pic_audit_id,",
 " j.company_id AS job_company_id,j.task_id AS job_task_id,j.status AS job_status,",
 " j.id AS job_id,j.command_id::text AS job_command_id,j.worker_id AS job_worker_id,",
 " j.assigned_client_id AS job_assigned_client_id,j.metadata AS job_metadata,",
 " (SELECT COUNT(*)::int FROM public.ai_execution_jobs e",
 "   WHERE e.task_id=p.hub_task_id AND e.company_id=p.company_id) AS hub_execution_count",
 " FROM gpt02_stage.core_preparations p",
 " JOIN public.ai_tasks t ON t.id=p.hub_task_id AND t.company_id=p.company_id",
 " JOIN public.team_members m ON m.id=p.member_id AND m.company_id=p.company_id",
 " JOIN public.users u ON u.id=p.operator_subject",
 " JOIN public.audit_logs a ON a.id=p.member_audit_id AND a.company_id=p.company_id",
 "   AND a.entity_id=p.hub_task_id::text AND a.action='gpt02_pic_assigned'",
 " JOIN public.ai_execution_jobs j ON j.id=p.hub_execution_id",
 "   AND j.task_id=p.hub_task_id AND j.company_id=p.company_id",
 " WHERE p.company_id=$1 AND p.hub_task_id=$2",
 "   AND p.command_candidate_id=$3::uuid AND p.attempt_id=$4::uuid",
].join(' ');

const CORE_PRESIGN_SQL=[
 "SELECT t.id::text AS core_task_id,t.status AS core_status,",
 " (SELECT COUNT(*)::int FROM ai_platform.ai_coding_runs r WHERE r.task_id=t.id) AS run_count,",
 " (SELECT COUNT(*)::int FROM ai_platform.ai_coding_bridge_commands c WHERE c.task_id=t.id) AS command_count,",
 " u.id AS core_operator_user_id,u.email AS core_email,u.role AS core_role,",
 " u.status AS core_operator_status,u.must_change_password",
 " FROM ai_platform.ai_coding_tasks t",
 " JOIN ai_platform.internal_users u ON lower(u.email)=lower($2)",
 " WHERE t.id=$1::uuid AND u.status='active' AND u.role IN ('owner','admin')",
].join(' ');

export function validPreSignIdentity(q){
 return exact(q,['companyId','hubTaskId','commandCandidateId','attemptId'])&&
  q.companyId==='default'&&integer(q.hubTaskId)&&q.hubTaskId>139&&
  [q.commandCandidateId,q.attemptId].every(x=>typeof x==='string'&&UUID.test(x))&&
  q.commandCandidateId!==q.attemptId;
}

function verifyIdentity(row,expected,tls){
 return row?.db==='postgres'&&row.login===expected&&row.session===expected&&
  row.read_only==='on'&&row.default_readonly===true&&row.search_path_locked===true&&
  Number.isInteger(row.backend_pid)&&row.backend_pid>0&&tls===true;
}

export function createGpt02PreSignFactReader({hubPool,corePool,clock=Date.now}={}){
 if(!hubPool||typeof hubPool.connect!=='function'||!corePool||
    typeof corePool.connect!=='function'||hubPool===corePool||typeof clock!=='function')
  denied('INDEPENDENT_HUB_CORE_POOLS_REQUIRED');
 return async function readPreSignFacts(query){
  if(!validPreSignIdentity(query))denied('UNTRUSTED_TASK_IDENTITY');
  let hub,core,hubTx=false,coreTx=false;
  try{
   [hub,core]=await Promise.all([hubPool.connect(),corePool.connect()]);
   if(!hub||!core||hub===core)denied('SEPARATE_DB_SESSIONS_REQUIRED');
   const hs=hub?.connection?.stream,cs=core?.connection?.stream;
   const hubTls=hs?.encrypted===true&&hs?.authorized===true&&
    (hs.authorizationError===undefined||hs.authorizationError===null);
   const coreTls=cs?.encrypted===true&&cs?.authorized===true&&
    (cs.authorizationError===undefined||cs.authorizationError===null);
   await hub.query('BEGIN READ ONLY');hubTx=true;
   await core.query('BEGIN READ ONLY');coreTx=true;
   for(const client of [hub,core]){
    await client.query("SET LOCAL search_path TO pg_catalog");
    await client.query("SET LOCAL statement_timeout='5s'");
   }
   const [hi,ci]=await Promise.all([hub.query(IDENTITY_SQL),core.query(IDENTITY_SQL)]);
   if(hi.rows?.length!==1||ci.rows?.length!==1||
      !verifyIdentity(hi.rows[0],ROLE_HUB,hubTls)||
      !verifyIdentity(ci.rows[0],ROLE_CORE,coreTls)||
      hi.rows[0].backend_pid===ci.rows[0].backend_pid)
    denied('TWO_INDEPENDENT_RESTRICTED_DB_LOGINS_REQUIRED');

   const hr=await hub.query(HUB_PRESIGN_SQL,[
    query.companyId,query.hubTaskId,query.commandCandidateId,query.attemptId
   ]);
   if(hr.rows?.length!==1)denied('PRESIGN_HUB_PREPARATION_NOT_UNIQUE');
   const h=hr.rows[0];
   let audit;
   try{audit=typeof h.audit_payload==='string'?JSON.parse(h.audit_payload):h.audit_payload}
   catch{denied('UNREADABLE_SUPER_ADMIN_ASSIGNMENT_AUDIT')}
   const email=v=>typeof v==='string'?v.trim().toLowerCase():'';
   const m=h.job_metadata;
   if(!object(audit)||!object(audit.actorIdentity)||!object(m)||
      h.audit_action!=='gpt02_pic_assigned'||h.audited_member_record!==h.latest_pic_audit_id||
      h.audit_entity_id!==String(query.hubTaskId)||
      audit.actorIdentity.role!=='super_admin'||audit.actorIdentity.id!==h.hub_user_id||
      email(audit.actorIdentity.email)!==email(h.audit_user_email)||
      email(h.hub_email)!==email(h.audit_user_email)||
      h.hub_role!=='super_admin'||h.hub_active!==true||h.hub_status!=='active'||
      h.member_active!==true||h.assigned_to_id!==h.member_id||
      h.job_status!=='prepared'||h.job_command_id!==null||h.job_worker_id!==null||
      h.job_assigned_client_id!==null||h.hub_execution_count!==1||
      m.commandCandidateId!==h.command_candidate_id||m.coreTaskId!==h.core_task_id||
      m.attemptId!==h.attempt_id||m.memberId!==h.member_id||
      m.memberAuditId!==h.member_audit_id||m.operatorSubject!==h.operator_subject||
      m.attemptNumber!==1||m.dispatchStarted!==false||m.autoContinue!==false||
      m.accountAlias!=='GPT02'||m.environment!=='development'||
      m.productionAllowed!==false||m.executionType!=='managed_prepared'||
      m.lifecycleStart!==false)
    denied('PRESIGN_HUB_BINDING_MISMATCH');

   const cr=await core.query(CORE_PRESIGN_SQL,[h.core_task_id,h.hub_email]);
   if(cr.rows?.length!==1)denied('PRESIGN_CORE_EMAIL_OPERATOR_NOT_UNIQUE');
   const c=cr.rows[0];
   if(c.core_status!=='PENDING'||c.run_count!==0||c.command_count!==0||
      !integer(c.core_operator_user_id)||!['owner','admin'].includes(c.core_role)||
      c.core_operator_status!=='active'||c.must_change_password!==false||
      email(c.core_email)!==email(h.hub_email))
    denied('PRESIGN_CORE_OPERATOR_BINDING_MISMATCH');

   const observedAt=clock();
   if(!integer(observedAt)||!integer(h.expires_ms)||observedAt>=h.expires_ms)
    denied('SIGNED_PREPARATION_EXPIRED');

   await hub.query('ROLLBACK');hubTx=false;
   await core.query('ROLLBACK');coreTx=false;
   return Object.freeze({
    prepared:Object.freeze({
     companyId:h.company_id,hubTaskId:h.hub_task_id,memberId:h.member_id,
     memberAuditId:h.member_audit_id,operatorSubject:h.operator_subject,
     coreTaskId:h.core_task_id,hubExecutionId:h.hub_execution_id,
     commandCandidateId:h.command_candidate_id,attemptId:h.attempt_id,
     expiresAt:h.expires_ms
    }),
    job:Object.freeze({
     companyId:h.job_company_id,taskId:h.job_task_id,executionId:h.hub_execution_id,
     status:h.job_status,commandId:null,workerCommandCount:0,attemptNumber:1,
     dispatchStarted:false,memberId:h.member_id,memberAuditId:h.member_audit_id,
     operatorSubject:h.operator_subject
    }),
    core:Object.freeze({
     taskId:c.core_task_id,commandCandidateId:h.command_candidate_id,
     attemptId:h.attempt_id,status:c.core_status,commandCount:c.command_count,
     runCount:c.run_count,workerId:WORKER,operatorUserId:c.core_operator_user_id,
     operatorRole:c.core_role,operatorActive:true,passwordChanged:true
    }),
    hubOperator:Object.freeze({
     subject:h.operator_subject,role:'super_admin',active:true,memberId:h.member_id,
     accountableOwnerId:h.operator_subject
    }),
    hubAssignment:Object.freeze({
     action:h.audit_action,entityId:h.audit_entity_id,actorId:audit.actorIdentity.id,
     actorRole:audit.actorIdentity.role,actorActive:true
    }),
    observedAt,
    trustedReadProof:Object.freeze({
     source:'gpt02-issue159-presign-reader',environment:'DEV',
     hubRole:ROLE_HUB,coreRole:ROLE_CORE,separateBackends:true,
     clientTlsVerified:true,readOnly:true,signingPermitted:false,
     authorizationGranted:false,dispatchPermitted:false,releaseDecision:'NO_GO'
    })
   });
  }catch(e){
   if(e?.code)throw e;
   denied('PRESIGN_INDEPENDENT_READ_FAILED_CLOSED');
  }finally{
   if(hub&&hubTx)try{await hub.query('ROLLBACK')}catch{}
   if(core&&coreTx)try{await core.query('ROLLBACK')}catch{}
   if(hub)try{hub.release(true)}catch{}
   if(core)try{core.release(true)}catch{}
  }
 };
}
