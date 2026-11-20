/**
 * CST-DEV Task183 independent watchdog candidate.
 * No unlock, task preparation, approval, issuer, signer or dispatch code.
 * No secrets in environment, output, or logs. One PostgreSQL attempt only.
 * SOURCE ONLY: host deployment requires separately authorized relock role.
 */
import {X509Certificate} from 'node:crypto';
import {lstatSync,readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';

const REF='xssrfshdrtdfupgqwfdw';
const HOST='aws-1-ap-southeast-2.pooler.supabase.com';
const ROLE='gpt02_task183_relock_login.'+REF;
const FINGERPRINT='807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa';
const SQL='SELECT role_locked,sessions_terminated,sessions_remaining,canary_active,operational_active FROM gpt02_guard.relock_task183_preparer()';
const AUTH_LATCH='/var/lib/gpt02-task183-relock/auth-terminal';
function fail(reason){const e=new Error(reason);e.code=reason;throw e;}

function pinnedCA(value){
 if(typeof value!=='string'||value.length>8192||
    !/^-----BEGIN CERTIFICATE-----\r?\n(?:[A-Za-z0-9+/=]+\r?\n)+-----END CERTIFICATE-----\r?\n?$/.test(value))
   fail('TASK183_RELOCK_CA_INVALID');
 try{
  const cert=new X509Certificate(value);
  if(cert.fingerprint256.replaceAll(':','').toLowerCase()!==FINGERPRINT)
    fail('TASK183_RELOCK_CA_INVALID');
 }catch{fail('TASK183_RELOCK_CA_INVALID')}
 return value;
}
function readRestricted(name,env){
 const root=env.CREDENTIALS_DIRECTORY;
 if(typeof root!=='string'||root!=='/run/credentials/gpt02-task183-preparer-relock.service')
   fail('TASK183_RELOCK_CREDENTIAL_DIR_INVALID');
 const dir=lstatSync(root),file=lstatSync(root+'/'+name);
 if(!dir.isDirectory()||dir.isSymbolicLink()||dir.uid!==0||dir.gid!==0||
   (dir.mode&0o777)!==0o550||!file.isFile()||file.isSymbolicLink()||
   file.uid!==0||file.gid!==0||![0o440,0o400,0o600].includes(file.mode&0o777))
   fail('TASK183_RELOCK_CREDENTIAL_MODE_INVALID');
 const value=readFileSync(root+'/'+name,'utf8');
 if(value.length<1||value.length>8192)fail('TASK183_RELOCK_CREDENTIAL_EMPTY');
 return value;
}
export function validateTask183RelockConfig(env,readCredential=(name)=>readRestricted(name,env)){
 if(env.NODE_ENV!=='development'||env.APP_ENV!=='development'||
    env.NODE_TLS_REJECT_UNAUTHORIZED==='0'||env.GPT02_TASK183_RELOCK_SCOPE!=='CST-DEV_TASK183')
   fail('TASK183_RELOCK_DEV_ONLY');
 if(env.GPT02_TASK183_RELOCK_DATABASE_URL_DEV||env.GPT02_TASK183_RELOCK_CA)
   fail('TASK183_RELOCK_INLINE_SECRET_FORBIDDEN');
 const raw=readCredential('task183-relock-dsn').trim();
 const ca=pinnedCA(readCredential('supabase-root-ca.crt'));
 let url;try{url=new URL(raw)}catch{fail('TASK183_RELOCK_DSN_INVALID')}
 if(url.protocol!=='postgresql:'||url.hostname!==HOST||url.port!=='5432'||
    url.pathname!=='/postgres'||decodeURIComponent(url.username)!==ROLE||
    !url.password||url.search||url.hash)
   fail('TASK183_RELOCK_DSN_SCOPE_INVALID');
 return Object.freeze({connectionString:raw,
   ssl:{ca,rejectUnauthorized:true},connectionTimeoutMillis:5000,
   statement_timeout:5000,application_name:'gpt02-task183-relock-DEV-only'});
}
export async function relockOnce(env, {ClientClass,readCredential}={}){
 const config=validateTask183RelockConfig(env,readCredential);
 if(typeof ClientClass!=='function')fail('TASK183_RELOCK_CLIENT_REQUIRED');
 let client;
 try{
  client=new ClientClass(config);
  await client.connect();
  const stream=client.connection?.stream;
  if(!stream||stream.authorized!==true||stream.encrypted!==true)
    fail('TASK183_RELOCK_PINNED_TLS_REQUIRED');
  const result=await client.query(SQL);
  const row=result?.rows?.[0];
  if(!Array.isArray(result?.rows)||result.rows.length!==1||
     typeof row?.role_locked!=='boolean'||
     !Number.isSafeInteger(row?.sessions_terminated)||row.sessions_terminated<0||
     !Number.isSafeInteger(row?.sessions_remaining)||row.sessions_remaining < -1||
     typeof row?.canary_active!=='boolean'||
     typeof row?.operational_active!=='boolean'||
     (row.canary_active && row.operational_active)||
     ((row.canary_active || row.operational_active) &&
       (row.role_locked || row.sessions_terminated!==0 || row.sessions_remaining>1))||
     (!row.canary_active && row.role_locked && row.sessions_remaining!==0)||
     (!row.canary_active && row.sessions_remaining>0 && row.role_locked))
    fail('TASK183_RELOCK_READBACK_INVALID');
  return Object.freeze({roleLocked:row.role_locked,
    sessionsTerminated:row.sessions_terminated,
    sessionsRemaining:row.sessions_remaining,
    canaryActive:row.canary_active,operationalActive:row.operational_active,
    relockComplete:!row.canary_active && !row.operational_active &&
      row.role_locked && row.sessions_remaining===0,
    dispatchPermitted:false,preparationAttempted:false});
 }finally{if(client)await client.end().catch(()=>{});}
}
function loadPgClient(){
 const require=createRequire(new URL('../../artifacts/api-server/package.json',import.meta.url));
 return require('pg').Client;
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 // Terminal PostgreSQL auth failures never auto-retry. An independent
 // operator must clear the restricted latch after fixing custody.
 const {existsSync}=await import('node:fs');
 if(existsSync(AUTH_LATCH)){
  process.stdout.write('TASK183_RELOCK_BLOCKED_PREVIOUS_AUTH_FAILURE\n');
  process.exitCode=2;
 }else{
  try{
   const result=await relockOnce(process.env,{ClientClass:loadPgClient()});
   if(!result.canaryActive && !result.operationalActive && !result.relockComplete){
     // The SQL command has committed NOLOGIN, but a residual session still
     // needs another independent watchdog attempt and an operator alert.
     process.stdout.write('TASK183_RELOCK_INCOMPLETE_RETRY_AND_ALERT_REQUIRED\n');
     process.exitCode=3;
   }else{
     process.stdout.write(JSON.stringify(result)+'\n');
   }
  }catch(err){
   if(err?.code==='28P01'){
    try{writeFileSync(AUTH_LATCH,'TERMINAL_AUTH_FAILURE\n',{mode:0o600,flag:'wx'})}catch{}
   }
   process.stdout.write('TASK183_RELOCK_FAILED_NO_RETRY\n');
   process.exitCode=2;
  }
 }
}
