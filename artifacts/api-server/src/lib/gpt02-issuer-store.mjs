/** DEV candidate, not mounted by HTTP. Never imports the Hub pool or falls back to its DSN. */
import { createHash, createPublicKey, verify } from 'node:crypto';
const FIELDS=Object.freeze(['v','environment','audience','taskId','commandId','attemptId','nonce','superAdminId','companyId','issuedAt','expiresAt']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ROLES=Object.freeze({attestor:'dev_gpt02_attestor_evidence',issuer:'dev_gpt02_issuer_evidence'});
const TABLES=['gpt02_private.approvals','gpt02_private.receipts'];
const PERMISSIONS='SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER';
const IDENTITY_SQL=`SELECT current_user AS active_role,session_user AS login_role,
 r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication AS elevated,
 EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid) AS membership,
 has_database_privilege(current_user,current_database(),'CREATE') AS db_create,
 has_schema_privilege(current_user,'gpt02_private','CREATE') AS schema_create,
 pg_has_role(current_user,'pg_read_all_data','MEMBER') OR pg_has_role(current_user,'pg_write_all_data','MEMBER') AS global_data
 FROM pg_roles r WHERE r.rolname=current_user`;
const ACL_SQL=`SELECT name,to_regclass(name) IS NOT NULL AS present,
 CASE WHEN to_regclass(name) IS NULL THEN true ELSE has_table_privilege(current_user,to_regclass(name),$2) END AS direct_access
 FROM unnest($1::text[]) AS t(name)`;
export class IssuerStoreError extends Error {
 constructor(code){super(code);this.name='IssuerStoreError';this.code=code;}
}
const fail=code=>{throw new IssuerStoreError(code);};
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
export function canonicalApproval(claims){
 if(!object(claims)||Object.keys(claims).length!==FIELDS.length||FIELDS.some(k=>!Object.hasOwn(claims,k)))fail('INVALID_CLAIM_FIELDS');
 return JSON.stringify(Object.fromEntries(FIELDS.map(k=>[k,claims[k]])));
}
function verifiedEnvelope(envelope,key,now){
 if(!object(envelope)||Object.keys(envelope).sort().join(',')!=='claims,signatureBase64url')fail('INVALID_ENVELOPE');
 const {claims:c,signatureBase64url:s}=envelope,payload=canonicalApproval(c);
 if(!Number.isSafeInteger(now)||now<0||c.v!==1||c.environment!=='DEV'||c.audience!=='GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL'||
 !Number.isSafeInteger(c.taskId)||c.taskId<=0||c.taskId===135||!Number.isSafeInteger(c.superAdminId)||c.superAdminId<=0||
 typeof c.commandId!=='string'||!UUID.test(c.commandId)||typeof c.attemptId!=='string'||!UUID.test(c.attemptId)||c.commandId===c.attemptId||
 typeof c.nonce!=='string'||!/^[A-Za-z0-9_-]{32,128}$/.test(c.nonce)||typeof c.companyId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(c.companyId)||
 ['all','*'].includes(c.companyId)||!Number.isSafeInteger(c.issuedAt)||!Number.isSafeInteger(c.expiresAt)||c.issuedAt<0||
 c.issuedAt>now+5000||c.expiresAt<=now||c.expiresAt<=c.issuedAt||c.expiresAt-c.issuedAt>300000)fail('INVALID_OR_EXPIRED_CLAIMS');
 if(typeof s!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(s))fail('INVALID_SIGNATURE');
 const bytes=Buffer.from(s,'base64url');
 if(bytes.length!==64||bytes.toString('base64url')!==s||!verify(null,Buffer.from(payload),key,bytes))fail('INVALID_SIGNATURE');
 return {claims:c,payload,signature:s,digest:createHash('sha256').update(payload).digest('hex')};
}
/** User-approved topology: the existing Hub DEV project, with scoped roles and a private schema. */
export function hostedEvidenceTarget(env){
 const evidence=env.GPT02_EVIDENCE_DEV_PROJECT_REF;
 const hub=env.GPT02_HUB_DEV_PROJECT_REF;
 const prod=env.GPT02_PROD_PROJECT_REF;
 for(const ref of [evidence,hub,prod])
  if(typeof ref!=='string'||!/^[a-z]{20}$/.test(ref))fail('PINNED_SUPABASE_PROJECT_REFS_REQUIRED');
 if(evidence===prod||hub===prod)fail('EVIDENCE_PRODUCTION_TARGET_FORBIDDEN');
 if(evidence!==hub)fail('EXISTING_CST_DEV_PROJECT_REQUIRED');
 const host=`db.${evidence}.supabase.co`;
 if(env.GPT02_EVIDENCE_DEV_HOST!==host||env.GPT02_EVIDENCE_DEV_DATABASE!=='postgres')fail('SUPABASE_DIRECT_TARGET_REQUIRED');
 return Object.freeze({projectRef:evidence,host,database:'postgres',topology:'EXISTING_CST_DEV_PRIVATE_SCHEMA'});
}
/** Only server deployment configuration, never request fields. */
export function issuerPoolConfig(env,kind){
 if(env.NODE_ENV!=='development'||env.APP_ENV!=='development')fail('NOT_EXPLICIT_DEV');
 if(!Object.hasOwn(ROLES,kind))fail('INVALID_CONNECTION_KIND');
 const raw=env[kind==='issuer'?'GPT02_ISSUER_DATABASE_URL_DEV':'GPT02_ATTESTOR_DATABASE_URL_DEV'];
 if(typeof raw!=='string'||!raw.trim())fail('DEDICATED_DSN_REQUIRED');
 const target=hostedEvidenceTarget(env);
 let u;try{u=new URL(raw);}catch{fail('INVALID_DEDICATED_DSN');}
 let login,db;try{login=decodeURIComponent(u.username);db=decodeURIComponent(u.pathname.slice(1));}catch{fail('INVALID_DEDICATED_DSN');}
 if(!['postgres:','postgresql:'].includes(u.protocol)||!u.password||u.search||u.hash||login!==ROLES[kind]||
 u.hostname!==target.host||db!==target.database||(u.port!==''&&u.port!=='5432'))
 fail('DEDICATED_DSN_SCOPE_MISMATCH');
 const ssl={rejectUnauthorized:true};if(env.GPT02_EVIDENCE_DEV_CA)ssl.ca=env.GPT02_EVIDENCE_DEV_CA;
 return {connectionString:raw,ssl,max:2,connectionTimeoutMillis:5000,idleTimeoutMillis:10000,statement_timeout:5000,application_name:`gpt02-${kind}-evidence-dev`};
}
export class Gpt02IssuerStore {
 #pool;#kind;#key;#clock;
 constructor({pool,kind,trustedPublicKeyPem,clock=Date.now}){
 if(!pool||typeof pool.connect!=='function'||!Object.hasOwn(ROLES,kind))fail('INVALID_CONNECTION');
 if(typeof trustedPublicKeyPem!=='string'||trustedPublicKeyPem.length>2000||!trustedPublicKeyPem.includes('BEGIN PUBLIC KEY'))fail('TRUSTED_PUBLIC_KEY_REQUIRED');
 try{this.#key=createPublicKey(trustedPublicKeyPem);}catch{fail('TRUSTED_PUBLIC_KEY_REQUIRED');}
 if(this.#key.asymmetricKeyType!=='ed25519')fail('ED25519_KEY_REQUIRED');
 this.#pool=pool;this.#kind=kind;this.#clock=clock;
 }
 async #transaction(fn){
 let c,started=false;
 try{
 c=await this.#pool.connect();await c.query('BEGIN');started=true;
 await c.query("SET LOCAL statement_timeout='5s'");await c.query("SET LOCAL lock_timeout='2s'");
 const r=(await c.query(IDENTITY_SQL)).rows[0];
 if(!r||r.active_role!==ROLES[this.#kind]||r.login_role!==ROLES[this.#kind]||r.elevated!==false||r.membership!==false||
 r.global_data!==false||r.db_create!==false||r.schema_create!==false)fail('UNSAFE_DATABASE_IDENTITY');
 const acl=(await c.query(ACL_SQL,[TABLES,PERMISSIONS])).rows;
 if(acl.length!==TABLES.length||acl.some(x=>x.present!==true||x.direct_access!==false))fail('DIRECT_EVIDENCE_ACCESS_OR_SCHEMA_MISSING');
 const result=await fn(c);await c.query('COMMIT');started=false;return result;
 }catch(e){
 if(c&&started)try{await c.query('ROLLBACK');}catch{}
 if(e instanceof IssuerStoreError)throw e;
 // Never leak URLs, passwords, SQL details, payloads or tokens.
 throw new IssuerStoreError('EVIDENCE_TRANSACTION_FAILED');
 }finally{
 // Destroy sessions so transaction/GUC state cannot leak into later requests.
 if(c)c.release(true);
 }
 }
 async recordApproval(envelope){
 if(this.#kind!=='attestor')fail('ATTESTOR_CONNECTION_REQUIRED');
 const e=verifiedEnvelope(envelope,this.#key,this.#clock());
 return this.#transaction(async c=>{
 const r=(await c.query('SELECT gpt02_private.record_approval($1::jsonb,$2,$3) AS recorded',[e.payload,e.signature,e.digest])).rows[0];
 if(r?.recorded!==true)fail('APPROVAL_NOT_RECORDED');
 return Object.freeze({approvalEvidenceRecorded:true,authorizationGranted:false,dispatchPermitted:false});
 });
 }
 async consumeApproval(envelope){
 if(this.#kind!=='issuer')fail('ISSUER_CONNECTION_REQUIRED');
 const e=verifiedEnvelope(envelope,this.#key,this.#clock());
 return this.#transaction(async c=>{
 const r=(await c.query('SELECT gpt02_private.consume_approval($1::jsonb,$2,$3) AS receipt_id',[e.payload,e.signature,e.digest])).rows[0];
 if(typeof r?.receipt_id!=='string'||!UUID.test(r.receipt_id))fail('APPROVAL_UNAVAILABLE_OR_REPLAYED');
 return Object.freeze({receiptId:r.receipt_id,evidenceConsumed:true,authorizationGranted:false,dispatchPermitted:false});
 });
 }
}
export function createIssuerStore({env,kind,PoolClass,trustedPublicKeyPem}){
 const pool=new PoolClass(issuerPoolConfig(env,kind));pool.on('error',()=>{});
 try{return {store:new Gpt02IssuerStore({pool,kind,trustedPublicKeyPem}),close:()=>pool.end()};}
 catch(e){void pool.end();throw e;}
}
