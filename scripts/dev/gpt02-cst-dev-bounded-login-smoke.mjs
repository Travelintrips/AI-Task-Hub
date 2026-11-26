/** Explicit operator-only credential probe. Not imported by HTTP, worker or CI. */
import {createRequire} from 'node:module';
import {randomBytes as smokeRandomBytes,X509Certificate as SmokeX509Certificate} from 'node:crypto';
import {issuerPoolConfig} from '../../artifacts/api-server/src/lib/gpt02-issuer-store.mjs';
const smokeRequire=createRequire(import.meta.url);
const {Client:SmokeClient}=smokeRequire('pg');
const DEV_REF='xssrfshdrtdfupgqwfdw',PROD_REF='nzdweipzckfszczzqtuw';
const POOLER='aws-1-ap-southeast-2.pooler.supabase.com';
const CA_URL='https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt';
const CA_FINGERPRINT='807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa';
const CANDIDATES=['dev_gpt02_attestor_evidence','dev_gpt02_issuer_evidence'];
const failSmoke=code=>{const error=new Error(code);error.code=code;throw error;};
const emitSmoke=(name,data)=>console.log(name,JSON.stringify(data));
const RIGHTS_SQL=`SELECT current_user AS role,session_user AS login,
 (SELECT rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication FROM pg_roles WHERE rolname=current_user) AS elevated,
 EXISTS(SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS membership,
 has_schema_privilege(current_user,'gpt02_private','USAGE') AS evidence_usage,
 has_schema_privilege(current_user,'public','CREATE') AS public_create,
 (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND c.relkind IN('r','p','v','m','f') AND has_schema_privilege(current_user,n.oid,'USAGE') AND has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) AS business_relations,
 (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prosecdef AND n.nspname NOT LIKE 'pg_%' AND has_schema_privilege(current_user,n.oid,'USAGE') AND has_function_privilege(current_user,p.oid,'EXECUTE')) AS definer_routines,
 (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS backend_ssl`;
async function smokeMain(){
 if(process.env.GPT02_BOUNDED_LOGIN_SMOKE!=='1'||process.env.NODE_ENV!=='development'||process.env.PUBLIC_APP_BASE_URL?.replace(/\/+$/,'')!=='https://dev-ai-task.cstlogistic.co.id')failSmoke('EXPLICIT_DEV_SMOKE_REQUIRED');
 const base=new URL(process.env.SUPABASE_DATABASE_URL_DEV);
 if(decodeURIComponent(base.username)!==`postgres.${DEV_REF}`||base.hostname!==POOLER||base.port!=='5432'||base.pathname!=='/postgres'||base.search||base.hash)failSmoke('WRONG_ADMIN_DEV_CONNECTION');
 const response=await fetch(CA_URL,{signal:AbortSignal.timeout(8000),redirect:'error'});if(!response.ok)failSmoke('CA_DOWNLOAD_FAILED');
 const ca=await response.text(),cert=new SmokeX509Certificate(ca);
 if(!cert.ca||cert.fingerprint256.replaceAll(':','').toLowerCase()!==CA_FINGERPRINT||Date.parse(cert.validTo)<=Date.now()||Date.parse(cert.validFrom)>Date.now())failSmoke('CA_PIN_VALIDATION_FAILED');
 const admin=new SmokeClient({connectionString:base.toString(),ssl:{ca,rejectUnauthorized:true},connectionTimeoutMillis:5000,statement_timeout:5000,application_name:'gpt02-bounded-login-preparation'});
 let armed=false,locked=false,windowStart=null;const clients=[];
 try{
 await admin.connect();if(admin.connection.stream.authorized!==true)failSmoke('ADMIN_TLS_NOT_VERIFIED');
 locked=(await admin.query("SELECT pg_try_advisory_lock(hashtextextended('gpt02-cst-dev-bounded-login-smoke-v1',0)) AS ok")).rows[0].ok;if(!locked)failSmoke('OTHER_OPERATOR_ACTIVE');
 const state=(await admin.query('SELECT rolname,rolcanlogin,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb,rolreplication,rolconnlimit FROM pg_roles WHERE rolname=ANY($1::text[])',[CANDIDATES])).rows;
 if(state.length!==2||state.some(r=>r.rolcanlogin||r.rolsuper||r.rolbypassrls||r.rolcreaterole||r.rolcreatedb||r.rolreplication||r.rolconnlimit!==0))failSmoke('CANDIDATE_BASELINE_CHANGED');
 const initial=(await admin.query("SELECT (SELECT count(*) FROM gpt02_private.approvals)::int AS approvals,(SELECT count(*) FROM gpt02_private.receipts)::int AS receipts,(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='gpt02_private' AND p.proname<>'reject_mutation')::int AS operations")).rows[0];
 if(initial.approvals!==0||initial.receipts!==0||initial.operations!==0)failSmoke('NOT_EMPTY_INACTIVE_FOUNDATION');
 const priorSessions=Number((await admin.query('SELECT count(*) FROM pg_stat_activity WHERE usename=ANY($1::text[])',[CANDIDATES])).rows[0].count);if(priorSessions!==0)failSmoke('CANDIDATE_SESSIONS_ALREADY_EXIST');
 windowStart=(await admin.query('SELECT clock_timestamp() AS started')).rows[0].started;
 const secret=new Map(CANDIDATES.map(r=>[r,smokeRandomBytes(32).toString('hex')]));
 const until=new Date(Date.now()+120000).toISOString();
 // Arm cleanup before any role is enabled. Passwords exist in process memory only.
 armed=true;await admin.query('BEGIN');
 for(const role of CANDIDATES)await admin.query(`ALTER ROLE ${role} LOGIN CONNECTION LIMIT 2 PASSWORD '${secret.get(role)}' VALID UNTIL '${until}'`);
 await admin.query('COMMIT');emitSmoke('BOUNDED_LOGIN_WINDOW',{seconds:120,roleCount:2,grantsAdded:0});
 for(const [kind,role] of [['attestor',CANDIDATES[0]],['issuer',CANDIDATES[1]]]){
 const url=new URL(base);url.username=`${role}.${DEV_REF}`;url.password=secret.get(role);
 const env={NODE_ENV:'development',APP_ENV:'development',GPT02_EVIDENCE_DEV_PROJECT_REF:DEV_REF,GPT02_HUB_DEV_PROJECT_REF:DEV_REF,GPT02_PROD_PROJECT_REF:PROD_REF,GPT02_EVIDENCE_DEV_DATABASE:'postgres',GPT02_EVIDENCE_DEV_HOST:POOLER,GPT02_EVIDENCE_DEV_POOLER_HOST:POOLER,GPT02_EVIDENCE_DEV_CONNECTION_MODE:'session_pooler',GPT02_EVIDENCE_DEV_CA:ca,[kind==='issuer'?'GPT02_ISSUER_DATABASE_URL_DEV':'GPT02_ATTESTOR_DATABASE_URL_DEV']:url.toString()};
 const c=new SmokeClient(issuerPoolConfig(env,kind));clients.push(c);await c.connect();if(c.connection.stream.authorized!==true)failSmoke('CANDIDATE_TLS_NOT_VERIFIED');
 await c.query('BEGIN READ ONLY');const r=(await c.query(RIGHTS_SQL)).rows[0];
 if(r.role!==role||r.login!==role||r.elevated||r.membership||r.evidence_usage||r.public_create||r.business_relations!==0||r.definer_routines!==0)failSmoke('CANDIDATE_EFFECTIVE_ACCESS_UNSAFE');
 let denied=0;
 for(const query of ['SELECT id FROM public.ai_tasks LIMIT 0','SELECT id FROM public.users LIMIT 0','SELECT command_id FROM gpt02_private.approvals LIMIT 0','SELECT id FROM gpt02_private.receipts LIMIT 0','SET LOCAL ROLE gpt02_store_owner','SET LOCAL ROLE postgres',`SET LOCAL ROLE ${kind==='issuer'?CANDIDATES[0]:CANDIDATES[1]}`]){
 await c.query('SAVEPOINT denied_check');let code;try{await c.query(query);}catch(e){code=e.code;}await c.query('ROLLBACK TO SAVEPOINT denied_check');await c.query('RELEASE SAVEPOINT denied_check');if(code!=='42501')failSmoke('EXPECTED_ACCESS_DENIAL_NOT_PROVEN');denied++;
 }
 await c.query('ROLLBACK');emitSmoke('DEDICATED_LOGIN_READBACK',{kind,role,sessionUser:r.login,verifiedClientTls:true,protocol:c.connection.stream.getProtocol(),businessRelations:r.business_relations,definerRoutines:r.definer_routines,denials:denied,backendSsl:r.backend_ssl});await c.end();
 }
 secret.clear();
 }finally{
 for(const c of clients)await c.end().catch(()=>{});
 if(armed){
 try{await admin.query('ROLLBACK');await admin.query('BEGIN');for(const role of CANDIDATES)await admin.query(`ALTER ROLE ${role} NOLOGIN CONNECTION LIMIT 0 PASSWORD NULL VALID UNTIL '1970-01-01 00:00:00+00'`);await admin.query('COMMIT');
 const end=(await admin.query('SELECT rolname,rolcanlogin,rolconnlimit,rolvaliduntil<now() AS expired FROM pg_roles WHERE rolname=ANY($1::text[])',[CANDIDATES])).rows;
 if(end.length!==2||end.some(r=>r.rolcanlogin||r.rolconnlimit!==0||r.expired!==true))failSmoke('RELOCK_POSTCONDITION_FAILED');
 const counts=(await admin.query('SELECT (SELECT count(*) FROM gpt02_private.approvals)::int AS approvals,(SELECT count(*) FROM gpt02_private.receipts)::int AS receipts')).rows[0];if(counts.approvals!==0||counts.receipts!==0)failSmoke('EVIDENCE_CHANGED');
 const stopped=(await admin.query("SELECT pg_terminate_backend(pid) AS terminated FROM pg_stat_activity WHERE usename=ANY($1::text[]) AND datname='postgres' AND backend_start >= $2::timestamptz AND pid<>pg_backend_pid()",[CANDIDATES,windowStart])).rows;
 if(stopped.some(r=>r.terminated!==true))failSmoke('POOLER_BACKEND_CLEANUP_FAILED');
 emitSmoke('CANDIDATES_RELOCKED',{roles:end,...counts,passwordsRemoved:true,retiredBackendSessions:stopped.length,dispatch:false});
 }catch(e){emitSmoke('CRITICAL_RELOCK_REVIEW',{code:e.code||'UNKNOWN'});process.exitCode=4;}
 }
 if(locked)await admin.query("SELECT pg_advisory_unlock(hashtextextended('gpt02-cst-dev-bounded-login-smoke-v1',0))").catch(()=>{});
 await admin.end().catch(()=>{});
 }
}
smokeMain().catch(e=>{emitSmoke('BOUNDED_SMOKE_FAILED',{code:e.code||'UNKNOWN'});if(!process.exitCode)process.exitCode=2;});
