/**
 * DEV-only, non-dispatching Core CODING task preparation candidate.
 * NOT mounted by any route or worker. Requires an independently authenticated,
 * scoped Core preparer LOGIN and live schema migration before activation.
 */
const ROLE='gpt02_core_prep_login';
const COMPANY='default';
const PROJECT='GPT02 DEV coding lifecycle';
const REPOSITORY='Travelintrips/Core-AI-Foundation';
const BRANCH='develop';
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const KEYS=['companyId','hubTaskId','projectName','repository','branch','instruction'];
class CorePreparationError extends Error {constructor(code){super(code);this.code=code;this.name='CorePreparationError';}}
const deny=code=>{throw new CorePreparationError(code);};
const literal=x=>x!=null&&typeof x==='object'&&!Array.isArray(x);
export function validateCorePreparationInput(input){
 if(!literal(input)||Object.keys(input).sort().join(',')!==[...KEYS].sort().join(','))deny('UNTRUSTED_PREPARATION_INPUT');
 const {companyId,hubTaskId,projectName,repository,branch,instruction}=input;
 if(companyId!==COMPANY||!Number.isSafeInteger(hubTaskId)||hubTaskId<=136||
    projectName!==PROJECT||repository!==REPOSITORY||branch!==BRANCH||
    typeof instruction!=='string'||instruction.length<1||instruction.length>2000||
    /[\x00-\x1f\x7f]/.test(instruction))deny('OUT_OF_SCOPE_PREPARATION');
 return Object.freeze([companyId,hubTaskId,projectName,repository,branch,instruction]);
}
/** Pin DEV project and a dedicated login; never reuse the general Hub DSN. */
export function corePreparationPoolConfig(env){
 if(env.NODE_ENV!=='development'||env.APP_ENV!=='development'||env.NODE_TLS_REJECT_UNAUTHORIZED==='0')deny('EXPLICIT_SECURE_DEV_REQUIRED');
 const project=env.GPT02_CORE_PREP_DEV_PROJECT_REF,hub=env.GPT02_HUB_DEV_PROJECT_REF,prod=env.GPT02_PROD_PROJECT_REF;
 if(typeof project!=='string'||!/^[a-z]{20}$/.test(project)||project!==hub||project===prod)deny('PINNED_CST_DEV_PROJECT_REQUIRED');
 const host=env.GPT02_CORE_PREP_DEV_POOLER_HOST,raw=env.GPT02_CORE_PREP_DATABASE_URL_DEV,ca=env.GPT02_CORE_PREP_DEV_CA;
 if(typeof host!=='string'||!/^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(host)||
   typeof ca!=='string'||!ca.includes('-----BEGIN CERTIFICATE-----')||
   typeof raw!=='string')deny('SEPARATE_CERTIFIED_DATABASE_TARGET_REQUIRED');
 let url;try{url=new URL(raw);}catch{deny('INVALID_PREPARER_DSN')}
 let user;try{user=decodeURIComponent(url.username)}catch{deny('INVALID_PREPARER_DSN')}
 if(!['postgresql:','postgres:'].includes(url.protocol)||url.hostname!==host||url.port!=='5432'||
   url.pathname!=='/postgres'||user!==`${ROLE}.${project}`||!url.password||url.search||url.hash)
   deny('PREPARER_DSN_SCOPE_MISMATCH');
 return {connectionString:raw,ssl:{ca,rejectUnauthorized:true},max:2,
   connectionTimeoutMillis:5000,statement_timeout:5000,idleTimeoutMillis:10000,
   application_name:'gpt02-core-preparation-DEV-only'};
}
/**
 * Returns reserved candidate identities only; this is NOT an approved command.
 * The database function must verify real Hub PIC + Super Admin audit and atomically
 * insert one PENDING Core task. The client never accepts user-supplied task IDs.
 */
export class Gpt02CoreTaskPreparer {
 #pool;
 constructor({pool}){if(!pool||typeof pool.connect!=='function')deny('DEDICATED_PREPARER_POOL_REQUIRED');this.#pool=pool;}
 async prepare(input){
  const params=validateCorePreparationInput(input);
  let client,started=false;
  try{
   client=await this.#pool.connect();
   await client.query('BEGIN');started=true;
   await client.query("SET LOCAL statement_timeout='5s'");
   await client.query("SET LOCAL lock_timeout='2s'");
   const identity=(await client.query(`SELECT current_user AS login,session_user AS session,
     r.rolcanlogin AND NOT(r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication) AS limited,
     NOT EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid) AS no_membership,
     NOT has_database_privilege(current_user,current_database(),'CREATE') AS no_db_create
     FROM pg_roles r WHERE r.rolname=current_user`)).rows[0];
   if(!identity||identity.login!==ROLE||identity.session!==ROLE||identity.limited!==true||
      identity.no_membership!==true||identity.no_db_create!==true)deny('UNSAFE_PREPARER_DATABASE_IDENTITY');
   // Probe OID privilege directly from pg_catalog: qualified regclass name
   // resolution itself may raise 42501 when a restricted login has no schema USAGE.
   // Missing catalog objects are treated as unsafe, never as permission denied.
   const direct=(await client.query(`SELECT
     COALESCE((SELECT has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ai_platform' AND c.relname='ai_coding_bridge_commands'),true) AS can_dispatch,
     COALESCE((SELECT has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ai_platform' AND c.relname='ai_coding_tasks'),true) AS direct_core_write,
     COALESCE((SELECT has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='gpt02_stage' AND c.relname='core_preparations'),true) AS direct_preparation_write`)).rows[0];
   if(!direct||direct.can_dispatch!==false||direct.direct_core_write!==false||direct.direct_preparation_write!==false)
     deny('DIRECT_CORE_TABLE_PRIVILEGES_FORBIDDEN');
   const rows=(await client.query(
    'SELECT core_task_id,command_candidate_id,attempt_id,created,dispatch_permitted FROM gpt02_stage.prepare_core_task($1,$2,$3,$4,$5,$6)',params)).rows;
   if(rows.length!==1||!rows[0]||![rows[0].core_task_id,rows[0].command_candidate_id,rows[0].attempt_id].every(x=>typeof x==='string'&&UUID.test(x))||
      rows[0].created!==true&&rows[0].created!==false||rows[0].dispatch_permitted!==false||
      new Set([rows[0].core_task_id,rows[0].command_candidate_id,rows[0].attempt_id]).size!==3)
     deny('PREPARATION_RESULT_NOT_TRUSTWORTHY');
   await client.query('COMMIT');started=false;
   return Object.freeze({coreTaskId:rows[0].core_task_id,
     commandCandidateId:rows[0].command_candidate_id,attemptId:rows[0].attempt_id,
     preparedNew:rows[0].created,coreTaskStatus:'PENDING',
     operatorApprovalRecorded:false,issuerGrantReady:false,dispatchPermitted:false,
     lifecycleStartPermitted:false,readOnly:false,environment:'DEV'});
  }catch(e){
   if(client&&started)try{await client.query('ROLLBACK')}catch{}
   if(e instanceof CorePreparationError)throw e;
   throw new CorePreparationError('CORE_PREPARATION_TRANSACTION_FAILED');
  }finally{if(client)client.release(true)}
 }
}
/** No network connection or transaction is made by this factory. */
export function createCoreTaskPreparer({env,PoolClass}){
 if(typeof PoolClass!=='function')deny('POSTGRES_POOL_CLASS_REQUIRED');
 const config=corePreparationPoolConfig(env);
 const pool=new PoolClass(config);pool.on('error',()=>{});
 return {preparer:new Gpt02CoreTaskPreparer({pool}),close:()=>pool.end()};
}
