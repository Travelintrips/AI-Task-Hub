"use strict";
/**
 * GPT02 DEV dedicated issuer connection admission — read-only.
 * This tool NEVER creates a role, grants permissions, logs credentials,
 * issues native commands, changes runtime env, or approves cutover.
 */
const EXPECTED_WRITER="dev_gpt02_claim_writer_nologin";
const EVIDENCE_OWNER="dev_gpt02_evidence_owner";
const EVIDENCE=[
 "ai_platform.dev_gpt02_task_attempt_binding_claims",
 "ai_platform.dev_gpt02_binding_attestation_nonces"
];
const UNSAFE=["postgres","ai_task_hostinger","service_role","supabase_admin"];
function assessIssuer(input={}){
 const reasons=[];
 const fail=(ok,why)=>{if(ok!==true)reasons.push(why)};
 fail(input.environment==="DEV","NOT_DEV");
 fail(input.dbReadOnly===true,"AUDIT_NOT_READONLY");
 fail(typeof input.issuerRole==="string"&&input.issuerRole.length>0&&
   !UNSAFE.includes(input.issuerRole)&&input.issuerRole!==EXPECTED_WRITER&&
   input.issuerRole!==EVIDENCE_OWNER,"ISSUER_ROLE_NOT_DEDICATED");
 fail(input.issuerCanLogin===true,"ISSUER_NO_LOGIN");
 fail(input.issuerElevated===false,"ISSUER_PRIVILEGED");
 fail(input.issuerBypassRls===false,"ISSUER_BYPASSRLS");
 fail(input.issuerCreateRole===false,"ISSUER_CAN_CREATE_ROLE");
 fail(input.issuerCreateDb===false,"ISSUER_CAN_CREATE_DB");
 fail(input.issuerCanAssumeEvidenceOwner===false,"ISSUER_CAN_ASSUME_OWNER");
 fail(input.issuerCanAssumeWriter===false,"ISSUER_CAN_ASSUME_WRITER");
 fail(input.issuerCanAssumePostgres===false,"ISSUER_CAN_ASSUME_POSTGRES");
 fail(input.issuerHasGlobalRead===false&&input.issuerHasGlobalWrite===false,
   "ISSUER_GLOBAL_DATA_PRIVILEGE");
 fail(input.issuerCanReadUnrelatedTables===false,"ISSUER_UNRELATED_DATA_ACCESS");
 fail(input.issuerCanModifyEvidenceDirectly===false,
   "ISSUER_CAN_MUTATE_EVIDENCE_DIRECTLY");
 fail(input.issuerOnlyWhitelistedRoutine===true,
   "ISSUER_ROUTINE_NOT_EXCLUSIVELY_SCOPED");
 fail(input.commandBoundApprovalValidated===true,
   "SIGNED_COMMAND_APPROVAL_NOT_VERIFIED");
 fail(input.atomicNonceValidatedLive===true,
   "LIVE_NONCE_ATOMICITY_NOT_VERIFIED");
 fail(input.immutableAuditReadback===true,
   "LIVE_IMMUTABLE_AUDIT_NOT_VERIFIED");
 fail(input.leaseAndFencingValidated===true,
   "LEASE_FENCING_NOT_VERIFIED");
 fail(input.nativeAttestationValidated===true,
   "NATIVE_ATTESTATION_NOT_VERIFIED");
 // Advisory-only evaluator never authorizes operational work,
 // even if every simulated input flag is true.
 return {environment:"DEV",mode:"READONLY_ISSUER_ADMISSION_AUDIT",
   issuerRole:typeof input.issuerRole==="string"?input.issuerRole:null,
   evidence:EVIDENCE,blockers:reasons,
   cutoverPermitted:false,grantPermitted:false,dispatchPermitted:false,
   releaseDecision:"NO_GO"};
}
async function main(){
 if(process.env.NODE_ENV!=="development"||
    process.env.APP_ENV==="production"||
    !process.env.SUPABASE_DATABASE_URL_DEV){
  console.log(JSON.stringify(assessIssuer({environment:"UNKNOWN"})));return;
 }
 let pg;
 try{pg=require("pg")}catch{
  console.log(JSON.stringify(assessIssuer({environment:"DEV"})));return;
 }
 const c=new pg.Client({connectionString:process.env.SUPABASE_DATABASE_URL_DEV,
  statement_timeout:7000,connectionTimeoutMillis:5000,
  application_name:"gpt02_dedicated_issuer_audit_readonly"});
 let observed={environment:"DEV",dbReadOnly:false};
 try{
  await c.connect();await c.query("BEGIN READ ONLY");
  const role=(await c.query(`
   SELECT current_user AS role,
    (SELECT rolcanlogin FROM pg_roles WHERE rolname=current_user) AS can_login,
    (SELECT rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb
     FROM pg_roles WHERE rolname=current_user) AS elevated,
    (SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user) AS bypass_rls,
    (SELECT rolcreaterole FROM pg_roles WHERE rolname=current_user) AS create_role,
    (SELECT rolcreatedb FROM pg_roles WHERE rolname=current_user) AS create_db,
    pg_has_role(current_user,$1,'SET') AS can_set_owner,
    pg_has_role(current_user,$2,'SET') AS can_set_writer,
    pg_has_role(current_user,'postgres','SET') AS can_set_postgres,
    pg_has_role(current_user,'pg_read_all_data','MEMBER') AS global_read,
    pg_has_role(current_user,'pg_write_all_data','MEMBER') AS global_write
   `,[EVIDENCE_OWNER,EXPECTED_WRITER])).rows[0];
  const evidence=(await c.query(`
   SELECT name,coalesce(has_table_privilege(current_user,to_regclass(name),'INSERT,UPDATE,DELETE'),false) AS can_modify
   FROM unnest($1::text[]) AS t(name)`,[EVIDENCE])).rows;
  const unrelated=(await c.query(`
    SELECT coalesce(has_table_privilege(current_user,'public.users','SELECT'),false)
      OR coalesce(has_table_privilege(current_user,'public.ai_tasks','SELECT'),false)
      AS permitted`)).rows[0];
  observed={...observed,dbReadOnly:true,issuerRole:role.role,
   issuerCanLogin:role.can_login,issuerElevated:role.elevated,
   issuerBypassRls:role.bypass_rls,issuerCreateRole:role.create_role,
   issuerCreateDb:role.create_db,issuerCanAssumeEvidenceOwner:role.can_set_owner,
   issuerCanAssumeWriter:role.can_set_writer,
   issuerCanAssumePostgres:role.can_set_postgres,
   issuerHasGlobalRead:role.global_read,issuerHasGlobalWrite:role.global_write,
   issuerCanReadUnrelatedTables:unrelated.permitted,
   issuerCanModifyEvidenceDirectly:evidence.some(x=>x.can_modify)};
  await c.query("ROLLBACK");
 }catch(e){
  try{await c.query("ROLLBACK")}catch{}
  observed={environment:"DEV",dbReadOnly:false,dbErrorCode:e.code||"READ_FAILED"};
 }finally{await c.end().catch(()=>{})}
 console.log(JSON.stringify(assessIssuer(observed)));
}
if(require.main===module)main().catch(()=>{console.log(JSON.stringify(assessIssuer({environment:"DEV"})));process.exitCode=1});
module.exports={assessIssuer,EVIDENCE,EXPECTED_WRITER};
