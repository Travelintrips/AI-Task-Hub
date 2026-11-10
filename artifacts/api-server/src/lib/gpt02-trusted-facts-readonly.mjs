/**
 * GPT02 DEV candidate. Two independently authenticated DB read sessions for
 * immutable Hub/Core task facts. No HTTP route/worker import, DML, signing,
 * approval, nonce consumption, grant or dispatch.
 *
 * The signed operator_links sidecar already stores Core operator, owner and
 * signed claims.workerId. Never duplicate these into core_preparations.
 */
import {createHash} from 'node:crypto';
import {canonicalOperatorLink} from './gpt02-operator-link.mjs';
import {canonicalApproval} from './gpt02-issuer-store.mjs';
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
 " current_setting('statement_timeout')='5s' AS statement_timeout_locked,",
 " current_setting('lock_timeout')='1s' AS lock_timeout_locked,",
 " current_setting('idle_in_transaction_session_timeout')='10s' AS idle_tx_timeout_locked,",
 " pg_backend_pid() AS backend_pid,",
 " EXISTS(SELECT 1 FROM pg_stat_ssl s WHERE s.pid=pg_backend_pid() AND s.ssl) AS tls_verified,",
 " r.rolcanlogin AND r.rolconnlimit=1 AND NOT (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR",
 " r.rolbypassrls OR r.rolreplication OR r.rolinherit) AS restricted,",
 " NOT EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid) AS no_memberships,",
 " (SELECT count(*)=1 AND bool_and(member_role.rolname='postgres'",
 "    AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option",
 "    AND pg_get_userbyid(m.grantor)='supabase_admin')",
 "  FROM pg_auth_members m JOIN pg_roles member_role ON member_role.oid=m.member",
 "  WHERE m.roleid=r.oid) AS exact_management_member,",
 " NOT pg_has_role(current_user,'pg_read_all_data','USAGE') AS no_global_read,",
 " NOT pg_has_role(current_user,'pg_write_all_data','USAGE') AS no_global_write,",
 " NOT has_database_privilege(current_user,current_database(),'CREATE') AS no_db_create,",
 " NOT EXISTS(SELECT 1 FROM pg_namespace n",
 "   WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'",
 "     AND has_schema_privilege(current_user,n.oid,'CREATE')) AS no_schema_create,",
 " NOT EXISTS(SELECT 1 FROM pg_shdepend s",
 "   WHERE s.refclassid='pg_authid'::regclass AND s.refobjid=r.oid AND s.deptype='o')",
 "   AS no_owned_objects,",
 " NOT (pg_has_role(current_user,'pg_read_server_files','USAGE')",
 "   OR pg_has_role(current_user,'pg_write_server_files','USAGE')",
 "   OR pg_has_role(current_user,'pg_execute_server_program','USAGE')",
 "   OR pg_has_role(current_user,'pg_signal_backend','USAGE')",
 "   OR pg_has_role(current_user,'pg_monitor','USAGE')",
 "   OR pg_has_role(current_user,'pg_checkpoint','USAGE')) AS no_special_admin_roles,",
 " NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace",
 "   WHERE c.relkind='S' AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema'",
 "   AND (has_sequence_privilege(current_user,c.oid,'USAGE')",
 "     OR has_sequence_privilege(current_user,c.oid,'SELECT')",
 "     OR has_sequence_privilege(current_user,c.oid,'UPDATE'))) AS no_sequence_privileges,",
 " NOT EXISTS(SELECT 1 FROM pg_foreign_server s",
 "   WHERE has_server_privilege(current_user,s.oid,'USAGE')) AS no_foreign_server_usage,",
 " NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace",
 "   WHERE c.relkind='f' AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema'",
 "     AND has_schema_privilege(current_user,n.oid,'USAGE')",
 "     AND has_table_privilege(current_user,c.oid,'SELECT')) AS no_foreign_table_select,",
 " NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace",
 "   WHERE c.relkind IN ('v','m') AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema'",
 "     AND has_schema_privilege(current_user,n.oid,'USAGE')",
 "     AND has_table_privilege(current_user,c.oid,'SELECT')) AS no_view_select,",
 " NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace",
 "   WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'",
 "     AND c.relkind IN ('r','p','f','v','m')",
 "     AND (has_table_privilege(current_user,c.oid,'INSERT')",
 "       OR has_table_privilege(current_user,c.oid,'UPDATE')",
 "       OR has_table_privilege(current_user,c.oid,'DELETE')",
 "       OR has_table_privilege(current_user,c.oid,'TRUNCATE')",
 "       OR has_table_privilege(current_user,c.oid,'REFERENCES')",
 "       OR has_table_privilege(current_user,c.oid,'TRIGGER')",
 "       OR has_table_privilege(current_user,c.oid,'MAINTAIN')))",
 "   AS no_mutating_relation_privileges,",
 " NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace",
 "   WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'",
 "     AND has_schema_privilege(current_user,n.oid,'USAGE')",
 "     AND p.prokind IN ('f','p') AND pg_get_function_result(p.oid)<>'trigger'",
 "     AND p.prosecdef AND has_function_privilege(current_user,p.oid,'EXECUTE'))",
 "   AS no_callable_security_definer_routines,",
 " (SELECT count(*)=1 AND bool_and(n.nspname='public'",
 "     AND p.proname='assert_portal_profile_complete'",
 "     AND pg_get_function_identity_arguments(p.oid)='p_customer_id integer'",
 "     AND p.prosecdef=false AND pg_get_userbyid(p.proowner)='postgres'",
 "     AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=",
 "       '046a0d067d2b632d0e17af5c6f433bea63794d90c67c55a6475e6fe6b34916c8')",
 "   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace",
 "   WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'",
 "     AND has_schema_privilege(current_user,n.oid,'USAGE')",
 "     AND p.prokind IN ('f','p') AND pg_get_function_result(p.oid)<>'trigger'",
 "     AND has_function_privilege(current_user,p.oid,'EXECUTE')) AS exact_callable_routines,",
 " NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace",
 "   WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'",
 "     AND has_schema_privilege(current_user,n.oid,'USAGE')",
 "     AND p.prokind IN ('f','p') AND pg_get_function_result(p.oid)<>'trigger'",
 "     AND has_function_privilege(current_user,p.oid,'EXECUTE')",
 "     AND pg_get_functiondef(p.oid) ~* '\\m(INSERT|UPDATE|DELETE|TRUNCATE|MERGE|CALL|ALTER|GRANT|REVOKE)\\M')",
 "   AS no_callable_mutating_routines",
 " FROM pg_roles r WHERE r.rolname=current_user"
].join(' ');
export const HUB_SQL=[
 "SELECT p.company_id,p.hub_task_id,p.member_id,p.member_audit_id,p.operator_subject,",
 " p.core_task_id::text AS core_task_id,p.hub_execution_id::text AS hub_execution_id,",
 " p.command_candidate_id::text AS command_candidate_id,p.attempt_id::text AS attempt_id,",
 " p.config_sha256,",
 " floor(extract(epoch FROM p.expires_at)*1000)::float8 AS expires_ms,",
 " t.assigned_to_id,t.assigned_to,t.status AS task_status,t.title AS task_title,",
 " m.name AS member_name,m.is_active AS member_active,",
 " u.id AS hub_user_id,u.role AS hub_role,u.is_active AS hub_active,",
 " u.status AS hub_status,u.company_id AS hub_company_id,u.email AS hub_email,",
 " a.id AS audited_member_record,a.company_id AS audit_company_id,",
 " a.action AS audit_action,a.entity_id AS audit_entity_id,",
 " a.after AS audit_payload,a.user_email AS audit_user_email,",
 " (SELECT MAX(z.id) FROM public.audit_logs z WHERE z.company_id=p.company_id",
 " AND z.entity_id=p.hub_task_id::text AND z.action='gpt02_pic_assigned') AS latest_pic_audit_id,",
 " j.company_id AS job_company_id,j.task_id AS job_task_id,j.status AS job_status,",
 " j.source AS job_source,j.external_id AS job_external_id,",
 " j.idempotency_key AS job_idempotency_key,j.title AS job_title,",
 " j.instruction AS job_instruction,j.progress AS job_progress,",
 " j.callback_verified,j.attestation_verified,j.final_ack_verified,",
 " (SELECT COUNT(*)::int FROM public.ai_execution_jobs e WHERE",
 " e.task_id=p.hub_task_id AND e.company_id=p.company_id) AS hub_execution_count,",
 " j.command_id::text AS job_command_id,j.worker_id AS job_worker_id,",
 " j.assigned_client_id AS job_assigned_client_id,j.metadata AS job_metadata,",
 " l.link_id::text AS link_id,l.accountable_owner_id,l.hub_operator_id,",
 " l.core_operator_user_id,l.claims AS signed_link_claims,",
 " l.approval_digest,l.link_digest,l.hub_signature,l.core_signature,",
 " a0.claims AS stored_approval_claims,a0.signature AS stored_approval_signature,",
 " a0.digest AS stored_approval_digest",
 " FROM gpt02_stage.core_preparations p",
 " JOIN public.ai_tasks t ON t.id=p.hub_task_id AND t.company_id=p.company_id",
 " JOIN public.team_members m ON m.id=p.member_id AND m.company_id=p.company_id",
 " JOIN public.users u ON u.id=p.operator_subject",
 " JOIN public.audit_logs a ON a.id=p.member_audit_id AND a.company_id=p.company_id",
 " AND a.entity_id=p.hub_task_id::text AND a.action='gpt02_pic_assigned'",
 " JOIN public.ai_execution_jobs j ON j.id=p.hub_execution_id",
 "    AND j.task_id=p.hub_task_id AND j.company_id=p.company_id",
 " JOIN gpt02_private.operator_links l ON l.command_id=p.command_candidate_id",
 "    AND l.attempt_id=p.attempt_id AND l.hub_execution_id=p.hub_execution_id",
 "    AND l.core_task_id=p.core_task_id AND l.hub_task_id=p.hub_task_id",
 "    AND l.company_id=p.company_id AND l.assignee_id=p.member_id",
 "    AND l.hub_operator_id=p.operator_subject",
 " JOIN gpt02_private.approvals a0 ON a0.command_id=l.command_id",
 "    AND a0.task_id=p.hub_task_id AND a0.company_id=p.company_id",
 "    AND a0.approver_id=p.operator_subject AND a0.digest=l.approval_digest",
 " WHERE p.company_id=$1 AND p.hub_task_id=$2 AND",
 " p.command_candidate_id=$3::uuid AND p.attempt_id=$4::uuid",
 " AND l.link_id=$5::uuid AND l.link_digest=$6 AND a0.digest=$7"
].join(' ');
export const CORE_SQL=[
 "SELECT t.id::text AS core_task_id,t.status AS core_status,",
 " t.task_number AS core_task_number,t.project_name AS core_project,",
 " t.repository AS core_repository,",
 " t.branch AS core_branch,t.instruction AS core_instruction,",
 " u.id AS core_operator_user_id,u.role AS core_role,",
 " u.status AS core_operator_status,u.must_change_password,",
 " (SELECT COUNT(*)::int FROM ai_platform.ai_coding_runs r WHERE r.task_id=t.id) AS run_count,",
 " (SELECT COUNT(*)::int FROM ai_platform.ai_coding_bridge_commands c",
 " WHERE c.task_id=t.id) AS command_count",
 " FROM ai_platform.ai_coding_tasks t CROSS JOIN ai_platform.internal_users u",
 " WHERE t.id=$1::uuid AND u.id=$2::integer"
].join(' ');
export function validRequestedIdentity(q){
 return exact(q,['companyId','hubTaskId','commandCandidateId','attemptId',
    'linkId','linkDigest','approvalDigest'])&&
  q.companyId==='default'&&integer(q.hubTaskId)&&q.hubTaskId>136&&
  [q.commandCandidateId,q.attemptId,q.linkId].every(x=>typeof x==='string'&&UUID.test(x))&&
  new Set([q.commandCandidateId,q.attemptId,q.linkId]).size===3&&
  [q.linkDigest,q.approvalDigest].every(x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x));
}
function verifyDbIdentity(row,expected){
 return row?.db==='postgres'&&row.login===expected&&row.session===expected&&
  row.read_only==='on'&&row.default_readonly===true&&row.search_path_locked===true&&
  row.statement_timeout_locked===true&&row.lock_timeout_locked===true&&
  row.idle_tx_timeout_locked===true&&Number.isInteger(row.backend_pid)&&row.backend_pid>0&&
  row.tls_verified===true&&row.restricted===true&&row.no_memberships===true&&
  row.exact_management_member===true&&row.no_global_read===true&&
  row.no_global_write===true&&row.no_db_create===true&&row.no_schema_create===true&&
  row.no_owned_objects===true&&
  row.no_special_admin_roles===true&&row.no_sequence_privileges===true&&
  row.no_foreign_server_usage===true&&row.no_foreign_table_select===true&&
  row.no_view_select===true&&row.no_mutating_relation_privileges===true&&
  row.no_callable_security_definer_routines===true&&
  row.exact_callable_routines===true&&row.no_callable_mutating_routines===true;
}
function mapFacts(h,c,query){
 if(!object(h)||!object(c)||!object(h.job_metadata)||!object(h.signed_link_claims))
  denied('INCOMPLETE_PREPARED_ROWS');
 const m=h.job_metadata,l=h.signed_link_claims;
 let audit;
 try{audit=typeof h.audit_payload==='string'?JSON.parse(h.audit_payload):h.audit_payload}
 catch{denied('UNREADABLE_SUPER_ADMIN_ASSIGNMENT_AUDIT')}
 if(!object(audit)||!object(audit.actorIdentity))
  denied('SUPER_ADMIN_ASSIGNMENT_AUDIT_MISSING');
 const email=v=>typeof v==='string'?v.trim().toLowerCase():null;
 if(h.audit_action!=='gpt02_pic_assigned'||
    h.audit_entity_id!==String(query.hubTaskId)||
    h.audited_member_record!==h.latest_pic_audit_id||
    String(audit.taskId)!==String(query.hubTaskId)||
    audit.companyId!==query.companyId||
    String(audit.memberId)!==String(h.member_id)||
    audit.memberName!==h.assigned_to||
    ![1,'1'].includes(audit.actorIdentity.version)||
    audit.actorIdentity.role!=='super_admin'||
    audit.actorIdentity.id!==h.hub_user_id||
    email(audit.actorIdentity.email)!==email(h.audit_user_email)||
    email(h.hub_email)!==email(h.audit_user_email)||
    h.hub_company_id!==null)
   denied('SUPER_ADMIN_ASSIGNMENT_AUDIT_MISMATCH');
 let canonical,linkDigest;
 try{
  canonical=canonicalOperatorLink(l);
  linkDigest=createHash('sha256').update(canonical).digest('hex');
 }catch{denied('SIGNATURE_SIDECAR_CANONICAL_INVALID')}
 if(!/^[A-Za-z0-9_-]{86}$/.test(h.hub_signature)||
    !/^[A-Za-z0-9_-]{86}$/.test(h.core_signature)||
    h.link_digest!==linkDigest||h.approval_digest!==l.approvalDigest||
    h.link_digest!==query.linkDigest||h.link_id!==query.linkId)
  denied('SIGNED_LINK_LEDGER_DIGEST_MISMATCH');
 let storedApprovalDigest;
 try{storedApprovalDigest=createHash('sha256')
   .update(canonicalApproval(h.stored_approval_claims)).digest('hex')}
 catch{denied('STORED_APPROVAL_CANONICAL_INVALID')}
 if(h.stored_approval_digest!==storedApprovalDigest||
    h.stored_approval_digest!==query.approvalDigest||
    h.approval_digest!==storedApprovalDigest||
    typeof h.stored_approval_signature!=='string'||
    !/^[A-Za-z0-9_-]{86}$/.test(h.stored_approval_signature)||
    h.stored_approval_claims.taskId!==query.hubTaskId||
    h.stored_approval_claims.companyId!==query.companyId||
    h.stored_approval_claims.commandId!==query.commandCandidateId||
    h.stored_approval_claims.attemptId!==query.attemptId)
  denied('STORED_SIGNED_APPROVAL_NOT_LINKED');
 if(typeof h.task_status!=='string'||!h.task_status||
   ['completed','cancelled','canceled','closed','failed','archived'].includes(h.task_status.toLowerCase()))
  denied('HUB_TASK_NOT_ACTIVE');
 // Same UTF-8, ASCII Unit Separator framing as immutable PostgreSQL
 // preparer: digest(concat_ws(E'\x1f',...), 'sha256').
 const PROJECT='GPT02 DEV coding lifecycle';
 const REPOSITORY='Travelintrips/Core-AI-Foundation';
 const BRANCH='develop';
 if(c.core_project!==PROJECT||typeof c.core_instruction!=='string'||
    c.core_instruction.length<1||!/^[a-f0-9]{64}$/.test(h.config_sha256))
   denied('IMMUTABLE_PREPARATION_HASH_INPUT_INVALID');
 const expectedHash=createHash('sha256').update([
   query.companyId,String(query.hubTaskId),String(h.member_id),
   String(h.member_audit_id),h.operator_subject,PROJECT,
   REPOSITORY,BRANCH,c.core_instruction
 ].join('\x1f')).digest('hex');
 if(expectedHash!==h.config_sha256)
   denied('IMMUTABLE_PREPARATION_CONFIGURATION_MISMATCH');
 if(h.company_id!==query.companyId||h.hub_task_id!==query.hubTaskId||
    h.command_candidate_id!==query.commandCandidateId||h.attempt_id!==query.attemptId||
    h.job_company_id!==query.companyId||h.job_task_id!==query.hubTaskId||
    h.job_status!=='prepared'||
    h.job_source!=='AI_TASK'||
    h.job_external_id!=='ai-task:'+query.companyId+':'+query.hubTaskId||
    h.job_idempotency_key!=='gpt02-managed-preparation:'+query.companyId+':'+query.hubTaskId||
    h.job_title!==h.task_title||h.job_instruction!==c.core_instruction||
    h.job_progress!==0||h.callback_verified!==false||
    h.attestation_verified!==false||h.final_ack_verified!==false||
    h.hub_execution_count!==1||
    h.job_command_id!==null||
    h.job_worker_id!==null||h.job_assigned_client_id!==null||
    m.commandCandidateId!==h.command_candidate_id||
    m.coreTaskId!==h.core_task_id||m.attemptId!==h.attempt_id||
    m.memberId!==h.member_id||m.memberAuditId!==h.member_audit_id||
    m.operatorSubject!==h.operator_subject||m.attemptNumber!==1||
    m.dispatchStarted!==false||m.autoContinue!==false||
    m.accountAlias!=='GPT02'||m.environment!=='development'||
    m.verificationMode!=='chatgpt-attested'||
    m.productionAllowed!==false||m.executionType!=='managed_prepared'||
    m.lifecycleStart!==false||
    h.assigned_to_id!==h.member_id||h.assigned_to!==h.member_name||
    h.member_active!==true||h.hub_role!=='super_admin'||
    h.hub_active!==true||h.hub_status!=='active'||
    h.audit_company_id!==query.companyId||
    h.audited_member_record!==h.member_audit_id||
    h.hub_operator_id!==h.operator_subject||
    !integer(h.member_id)||!integer(h.member_audit_id)||
    !integer(h.core_operator_user_id)||!integer(h.expires_ms)||
    !UUID.test(h.core_task_id)||!UUID.test(h.hub_execution_id)||
    !UUID.test(h.link_id)||!object(l)||l.workerId!==WORKER||
    l.accountableOwnerId!==h.accountable_owner_id||
    l.coreOperatorUserId!==h.core_operator_user_id||
    l.hubOperatorId!==h.hub_operator_id||
    l.coreTaskId!==h.core_task_id||
    l.hubExecutionId!==h.hub_execution_id||
    l.coreCommandId!==h.command_candidate_id||
    l.attemptId!==h.attempt_id||
    l.hubTaskId!==h.hub_task_id||
    l.companyId!==query.companyId||
    c.core_task_id!==h.core_task_id||c.core_operator_user_id!==h.core_operator_user_id||
    c.core_status!=='PENDING'||
    !String(c.core_task_number||'').startsWith('GPT02DEV-'+query.hubTaskId+'-')||
    c.core_repository!=='Travelintrips/Core-AI-Foundation'||
    c.core_branch!=='develop'||
    !['owner','admin'].includes(c.core_role)||c.core_operator_status!=='active'||
    c.must_change_password!==false||c.run_count!==0||c.command_count!==0)
    denied('HUB_CORE_SIGNED_SIDECAR_MISMATCH');
 return {
  prepared:{companyId:h.company_id,hubTaskId:h.hub_task_id,
    memberId:h.member_id,memberAuditId:h.member_audit_id,
    operatorSubject:h.operator_subject,coreTaskId:h.core_task_id,
    hubExecutionId:h.hub_execution_id,commandCandidateId:h.command_candidate_id,
    attemptId:h.attempt_id,expiresAt:h.expires_ms},
  job:{companyId:h.job_company_id,taskId:h.job_task_id,
    executionId:h.hub_execution_id,status:h.job_status,commandId:null,
    workerCommandCount:0,attemptNumber:1,dispatchStarted:false,
    memberId:h.member_id,memberAuditId:h.member_audit_id,
    operatorSubject:h.operator_subject},
  core:{taskId:c.core_task_id,commandCandidateId:h.command_candidate_id,
    attemptId:h.attempt_id,status:c.core_status,commandCount:c.command_count,
    runCount:c.run_count,workerId:l.workerId,operatorUserId:c.core_operator_user_id,
    operatorRole:c.core_role,operatorActive:true,passwordChanged:true},
  hubOperator:{subject:h.operator_subject,role:h.hub_role,active:true,
    memberId:h.member_id,accountableOwnerId:h.accountable_owner_id},
  storedEvidence:{
   approval:{claims:h.stored_approval_claims,
     signatureBase64url:h.stored_approval_signature,
     digest:h.stored_approval_digest},
   operatorLink:{claims:l,linkDigest:h.link_digest,
     hubSignatureBase64url:h.hub_signature,
     coreSignatureBase64url:h.core_signature}
  }
 };
}
/**
 * Pools are supplied by a separate reviewed DEV connection factory. This
 * module will NEVER accept a DSN from a task or fall back to the shared pool.
 */
export function createGpt02TrustedFactReader({hubPool,corePool,clock=Date.now}={}){
 if(!hubPool||typeof hubPool.connect!=='function'||
  !corePool||typeof corePool.connect!=='function'||hubPool===corePool||
  typeof clock!=='function')denied('INDEPENDENT_HUB_CORE_POOLS_REQUIRED');
 return async function readTrustedFacts(query){
  if(!validRequestedIdentity(query))denied('UNTRUSTED_TASK_IDENTITY');
  let hub,core,hubTx=false,coreTx=false;
  try{
   hub=await hubPool.connect();
   core=await corePool.connect();
   if(!hub||!core||hub===core)denied('SEPARATE_DB_SESSIONS_REQUIRED');
   await hub.query('BEGIN READ ONLY');hubTx=true;
   await core.query('BEGIN READ ONLY');coreTx=true;
   await hub.query("SET LOCAL statement_timeout='5s'");
   await core.query("SET LOCAL statement_timeout='5s'");
   const [hi,ci]=await Promise.all([hub.query(IDENTITY_SQL),core.query(IDENTITY_SQL)]);
   if(hi.rows?.length!==1||ci.rows?.length!==1||
     !verifyDbIdentity(hi.rows[0],ROLE_HUB)||
     !verifyDbIdentity(ci.rows[0],ROLE_CORE)||
     hi.rows[0].backend_pid===ci.rows[0].backend_pid)
    denied('TWO_INDEPENDENT_RESTRICTED_DB_LOGINS_REQUIRED');
   const hs=await hub.query(HUB_SQL,[query.companyId,query.hubTaskId,
    query.commandCandidateId,query.attemptId,query.linkId,
    query.linkDigest,query.approvalDigest]);
   if(hs.rows?.length!==1)denied('TRUSTED_HUB_TASK_SIDECAR_NOT_UNIQUE');
   const h=hs.rows[0];
   if(!UUID.test(h.core_task_id)||!integer(h.core_operator_user_id))
    denied('INVALID_CORE_LOOKUP_FROM_HUB_LEDGER');
   const cs=await core.query(CORE_SQL,[h.core_task_id,h.core_operator_user_id]);
   if(cs.rows?.length!==1)denied('TRUSTED_CORE_OPERATOR_NOT_UNIQUE');
   const mapped=mapFacts(h,cs.rows[0],query);
   const observedAt=clock();
   if(!integer(observedAt)||observedAt>=mapped.prepared.expiresAt)
    denied('SIGNED_PREPARATION_EXPIRED');
   await hub.query('ROLLBACK');hubTx=false;
   await core.query('ROLLBACK');coreTx=false;
   return Object.freeze({...mapped,observedAt});
  }catch(e){
   if(e?.code&&String(e.code).startsWith('TRUSTED_'))throw e;
   if(['UNTRUSTED_TASK_IDENTITY','SEPARATE_DB_SESSIONS_REQUIRED',
     'TWO_INDEPENDENT_RESTRICTED_DB_LOGINS_REQUIRED',
     'INCOMPLETE_PREPARED_ROWS','HUB_CORE_SIGNED_SIDECAR_MISMATCH',
     'SIGNATURE_SIDECAR_CANONICAL_INVALID','SIGNED_LINK_LEDGER_DIGEST_MISMATCH',
     'HUB_TASK_NOT_ACTIVE','STORED_APPROVAL_CANONICAL_INVALID',
     'STORED_SIGNED_APPROVAL_NOT_LINKED',
     'IMMUTABLE_PREPARATION_HASH_INPUT_INVALID',
     'IMMUTABLE_PREPARATION_CONFIGURATION_MISMATCH',
     'UNREADABLE_SUPER_ADMIN_ASSIGNMENT_AUDIT',
     'SUPER_ADMIN_ASSIGNMENT_AUDIT_MISSING',
     'SUPER_ADMIN_ASSIGNMENT_AUDIT_MISMATCH',
     'INVALID_CORE_LOOKUP_FROM_HUB_LEDGER','SIGNED_PREPARATION_EXPIRED'].includes(e?.code))
    throw e;
   denied('INDEPENDENT_READ_FAILED_CLOSED');
  }finally{
   if(hub&&hubTx)try{await hub.query('ROLLBACK')}catch{}
   if(core&&coreTx)try{await core.query('ROLLBACK')}catch{}
   if(hub)try{hub.release(true)}catch{}
   if(core)try{core.release(true)}catch{}
  }
 };
}
