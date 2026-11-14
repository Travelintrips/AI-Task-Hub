/**
 * DEV-only, non-dispatching Core CODING task preparation candidate.
 * Called only by the Super Admin DEV prepare-only route; this is never
 * a native issuer, signer, lease or worker dispatch implementation.
 */
import { X509Certificate } from 'node:crypto';
const EXPECTED_DEV_REF='xssrfshdrtdfupgqwfdw';
const PINNED_ROOT_FINGERPRINT='807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa';
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
function pinnedPreparerCa(pem){
 // Exactly ONE PEM CA; a second appended certificate would silently expand
 // the TLS trust store even when the first certificate has the pinned hash.
 if(typeof pem!=='string'||pem.length>8192||
    !/^-----BEGIN CERTIFICATE-----\r?\n(?:[A-Za-z0-9+/=]+\r?\n)+-----END CERTIFICATE-----\r?\n?$/.test(pem))
   deny('PINNED_PREPARER_CA_REQUIRED');
 try{
  const certificate=new X509Certificate(pem);
  if(certificate.fingerprint256.replaceAll(':','').toLowerCase()!==PINNED_ROOT_FINGERPRINT)
    deny('PINNED_PREPARER_CA_REQUIRED');
 }catch(e){
  if(e instanceof CorePreparationError)throw e;
  deny('PINNED_PREPARER_CA_REQUIRED');
 }
 return pem;
}
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
 if(project!==EXPECTED_DEV_REF||hub!==EXPECTED_DEV_REF||typeof prod!=='string'||!/^[a-z]{20}$/.test(prod)||prod===EXPECTED_DEV_REF)
   deny('PINNED_CST_DEV_PROJECT_REQUIRED');
 const host=env.GPT02_CORE_PREP_DEV_POOLER_HOST,raw=env.GPT02_CORE_PREP_DATABASE_URL_DEV,ca=env.GPT02_CORE_PREP_DEV_CA;
 if(typeof host!=='string'||!/^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(host)||
   typeof raw!=='string')deny('SEPARATE_CERTIFIED_DATABASE_TARGET_REQUIRED');
 const pinnedCa=pinnedPreparerCa(ca);
 let url;try{url=new URL(raw);}catch{deny('INVALID_PREPARER_DSN')}
 let user;try{user=decodeURIComponent(url.username)}catch{deny('INVALID_PREPARER_DSN')}
 if(!['postgresql:','postgres:'].includes(url.protocol)||url.hostname!==host||url.port!=='5432'||
   url.pathname!=='/postgres'||user!==`${ROLE}.${project}`||!url.password||url.search||url.hash)
   deny('PREPARER_DSN_SCOPE_MISMATCH');
 return {connectionString:raw,ssl:{ca:pinnedCa,rejectUnauthorized:true},max:1,
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
 async verifyReadiness(){
  let client,started=false;
  try{
   client=await this.#pool.connect();
   // Only a pinned TLS session with an actual PostgreSQL login qualifies.
   const stream=client.connection?.stream;
   if(!stream||stream.authorized!==true||stream.encrypted!==true)
     deny('PINNED_TLS_PREPARER_SESSION_REQUIRED');
   await client.query('BEGIN READ ONLY');started=true;
   const r=(await client.query(`SELECT current_user AS login,session_user AS session,
     current_setting('transaction_read_only') AS read_only,
     p.rolcanlogin AND NOT(p.rolsuper OR p.rolbypassrls OR p.rolcreaterole
       OR p.rolcreatedb OR p.rolreplication OR p.rolinherit) AS limited,
     p.rolconnlimit AS connection_limit,p.rolvaliduntil AS valid_until,
     NOT EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=p.oid) AS no_membership,
     NOT has_database_privilege(current_user,current_database(),'CREATE') AS no_db_create
     FROM pg_roles p WHERE p.rolname=current_user`)).rows[0];
   const until=r?.valid_until instanceof Date?r.valid_until.getTime():
      typeof r?.valid_until==='string'?Date.parse(r.valid_until):NaN;
   if(r?.login!==ROLE||r?.session!==ROLE||r?.read_only!=='on'||
      r?.limited!==true||r?.no_membership!==true||r?.no_db_create!==true||
      r?.connection_limit!==1||!Number.isFinite(until)||
      until<=Date.now()||until-Date.now()>10*60_000)
     deny('DEV_PREPARER_AUTHENTICATED_ROLE_NOT_SCOPED');
   const direct=(await client.query(`SELECT
     COALESCE((SELECT has_table_privilege(current_user,c.oid,
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='ai_platform' AND c.relname='ai_coding_bridge_commands'),true)
        AS can_dispatch,
     COALESCE((SELECT has_table_privilege(current_user,c.oid,
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='ai_platform' AND c.relname='ai_coding_tasks'),true)
        AS can_core_write,
     COALESCE((SELECT has_table_privilege(current_user,c.oid,
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname='ai_execution_jobs'),true)
        AS can_hub_write`)).rows[0];
   if(!direct||direct.can_dispatch!==false||direct.can_core_write!==false||
      direct.can_hub_write!==false)
     deny('DIRECT_LEDGER_WRITE_OR_COMMAND_AUTHORITY_FORBIDDEN');
   await client.query('ROLLBACK');started=false;
   return Object.freeze({
      verified:true,readOnly:true,operatorApprovalGranted:false,
      issuerGrantReady:false,dispatchPermitted:false
   });
  }catch(e){
   if(client&&started)try{await client.query('ROLLBACK')}catch{}
   if(e instanceof CorePreparationError)throw e;
   deny('PREPARER_READ_ONLY_CONNECTION_UNAVAILABLE');
  }finally{
   if(client)client.release(true);
  }
 }
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
     COALESCE((SELECT has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='gpt02_stage' AND c.relname='core_preparations'),true) AS direct_preparation_write,
     COALESCE((SELECT has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='ai_execution_jobs'),true) AS direct_hub_write`)).rows[0];
   if(!direct||direct.can_dispatch!==false||direct.direct_core_write!==false||direct.direct_preparation_write!==false||direct.direct_hub_write!==false)
     deny('DIRECT_CORE_TABLE_PRIVILEGES_FORBIDDEN');
   // Lock the preparer to the real Hub/Core catalog. Both tenant IDs and numeric
   // company IDs exist in CST-DEV, but they are not interchangeable namespaces.
   // No SECURITY DEFINER routine is invoked until these column shapes match.
   // Use only pg_catalog OIDs: the deliberately restricted preparer has NO
   // USAGE on public/ai_platform, so 'schema.table'::regclass would leak an
   // unexpected 42501 rather than performing the non-mutating shape check.
   const schema=(await client.query(`SELECT
     COUNT(*)::integer AS catalog_rows,
     COALESCE(BOOL_AND(a.attnum>0 AND NOT a.attisdropped
       AND pg_catalog.format_type(a.atttypid,a.atttypmod)=expected.type_name
       AND a.attnotnull=expected.required_not_null),false) AS compatible
     FROM (VALUES
       ('public','users','id','text',true),
       ('public','users','company_id','integer',false),
       ('public','ai_tasks','company_id','text',true),
       ('public','audit_logs','user_email','text',false),
       ('ai_platform','ai_coding_tasks','id','uuid',true),
       ('public','ai_execution_jobs','id','uuid',true),
       ('public','ai_execution_jobs','task_id','integer',false),
       ('public','ai_execution_jobs','command_id','uuid',false),
       ('public','ai_execution_jobs','external_id','text',true),
       ('public','ai_execution_jobs','source','text',true),
       ('public','ai_execution_jobs','status','text',true),
       ('public','ai_execution_jobs','metadata','jsonb',true)
     ) AS expected(schema_name,relation_name,column_name,type_name,required_not_null)
     LEFT JOIN pg_catalog.pg_namespace n ON n.nspname=expected.schema_name
     LEFT JOIN pg_catalog.pg_class c ON c.relnamespace=n.oid AND c.relname=expected.relation_name
       AND c.relkind IN ('r','p')
     LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attname=expected.column_name`)).rows[0];
   if(!schema||schema.catalog_rows!==12||schema.compatible!==true)
     deny('HOSTED_IDENTITY_SCHEMA_MISMATCH');
   const rows=(await client.query(
    'SELECT core_task_id,command_candidate_id,attempt_id,hub_execution_id,created,dispatch_permitted FROM gpt02_stage.prepare_core_task($1,$2,$3,$4,$5,$6)',params)).rows;
   if(rows.length!==1||!rows[0]||![rows[0].core_task_id,rows[0].command_candidate_id,rows[0].attempt_id,rows[0].hub_execution_id].every(x=>typeof x==='string'&&UUID.test(x))||
      rows[0].created!==true&&rows[0].created!==false||rows[0].dispatch_permitted!==false||
      new Set([rows[0].core_task_id,rows[0].command_candidate_id,rows[0].attempt_id,rows[0].hub_execution_id]).size!==4)
     deny('PREPARATION_RESULT_NOT_TRUSTWORTHY');
   await client.query('COMMIT');started=false;
   return Object.freeze({coreTaskId:rows[0].core_task_id,
     commandCandidateId:rows[0].command_candidate_id,attemptId:rows[0].attempt_id,hubExecutionId:rows[0].hub_execution_id,
     preparedNew:rows[0].created,coreTaskStatus:'PENDING',hubExecutionStatus:'prepared',commandIssued:false,
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
