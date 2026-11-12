/**
 * Inert CST-DEV one-shot credential handoff for an independently authorized
 * operator.  Does NOT provision a role, secret, issuer, nonce or task.
 *
 * The operator is responsible for providing a protected secret file from their
 * approved credential mechanism. No plaintext credential on argv, source,
 * application .env, GitHub Actions, or process environment.
 */
import {constants,openSync,fstatSync,readFileSync,closeSync,realpathSync} from 'node:fs';
import {isAbsolute,resolve,sep} from 'node:path';
import {readFileSync as readPublicCert} from 'node:fs';
import {corePreparationPoolConfig} from '../../artifacts/api-server/src/lib/gpt02-core-task-preparation.mjs';
import {probe,report} from './gpt02-preparer-dedicated-login-readonly.mjs';

const PROJECT='xssrfshdrtdfupgqwfdw';
const ROLE='gpt02_core_prep_login';
const CERT=new URL('./fixtures/supabase-root-ca-2021.crt',import.meta.url);

/** Avoid following links, loose permissions, inherited role or stale file. */
export function readOperatorSecret(filePath,dependencies={}){
 const fs=dependencies.fs||{openSync,fstatSync,readFileSync,closeSync,realpathSync};
 const uid=dependencies.uid??process.getuid?.();
 const allowedRoot=resolve(dependencies.approvedRoot??'/run/credentials');
 if(!Number.isInteger(uid)||typeof filePath!=='string'||filePath.length>300||
    !isAbsolute(filePath)||filePath.includes('\0')||
    resolve(filePath)!==filePath||!filePath.startsWith(allowedRoot+sep))
  throw Error('INVALID_SECRET_FILE_TARGET');
 // O_NOFOLLOW protects the final component only. Reject symlinked parent
 // components too; otherwise a path under /run/credentials could resolve out.
 // Actual credential roots must be ordinary managed directories.
 try {
  if(fs.realpathSync(allowedRoot)!==allowedRoot||
     fs.realpathSync(filePath)!==filePath)
   throw Error('SECRET_PATH_SYMLINK_COMPONENT_FORBIDDEN');
 }catch{
  throw Error('SECRET_PATH_SYMLINK_COMPONENT_FORBIDDEN');
 }
 let fd;
 try{
  fd=fs.openSync(filePath,constants.O_RDONLY|constants.O_NOFOLLOW|(constants.O_CLOEXEC||0));
  const stat=fs.fstatSync(fd);
  if(!stat.isFile()||stat.nlink!==1||stat.uid!==uid||stat.size<43||stat.size>257||
     (stat.mode&0o111)!==0||(stat.mode&0o066)!==0||(stat.mode&0o400)===0)
   throw Error('UNSAFE_SECRET_FILE_OWNERSHIP_OR_MODE');
  const raw=fs.readFileSync(fd,'utf8');
  const credential=raw.endsWith('\n')?raw.slice(0,-1):raw;
  if(!/^[A-Za-z0-9_-]{43,128}$/.test(credential))throw Error('INVALID_SECRET_SHAPE');
  return credential;
 }finally{
  if(fd!==undefined)fs.closeSync(fd);
 }
}

/**
 * Always returns informational NO_GO. The optional probeFn is for deterministic
 * unit tests; the CLI entrypoint always uses the actual read-only probe.
 */
export async function handoff(env=process.env,dependencies={}){
 if(env.GPT02_CORE_PREP_DATABASE_URL_DEV)
  return report('PREEXISTING_DSN_ENV_FORBIDDEN');
 if(typeof env.GPT02_CORE_PREP_SECRET_FILE!=='string')
  return report('SCOPED_OPERATOR_SECRET_FILE_REQUIRED');
 const host=env.GPT02_CORE_PREP_DEV_POOLER_HOST;
 // The hostname must be chosen by an authorized operator, not via an
 // arbitrary DSN from the existing app's privileged postgres connection.
 if(typeof host!=='string'||!/^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(host))
  return report('CST_DEV_SESSION_POOLER_NOT_PINNED');
 const config={
  NODE_ENV:env.NODE_ENV,APP_ENV:env.APP_ENV,
  NODE_TLS_REJECT_UNAUTHORIZED:env.NODE_TLS_REJECT_UNAUTHORIZED,
  GPT02_CORE_PREP_DEV_PROJECT_REF:env.GPT02_CORE_PREP_DEV_PROJECT_REF,
  GPT02_HUB_DEV_PROJECT_REF:env.GPT02_HUB_DEV_PROJECT_REF,
  GPT02_PROD_PROJECT_REF:env.GPT02_PROD_PROJECT_REF,
  GPT02_CORE_PREP_DEV_POOLER_HOST:host,
  GPT02_CORE_PREP_DEV_CA:readPublicCert(CERT,'utf8'),
  GPT02_CORE_PREP_DATABASE_URL_DEV:
    `postgresql://${ROLE}.${PROJECT}:placeholder@${host}:5432/postgres`
 };
 const url=new URL(config.GPT02_CORE_PREP_DATABASE_URL_DEV);
 try{corePreparationPoolConfig({...config,GPT02_CORE_PREP_DATABASE_URL_DEV:url.toString()});}
 catch{return report('CST_DEV_PROJECT_OR_TLS_VALIDATION_FAILED');}
 let pw;
 try{pw=readOperatorSecret(env.GPT02_CORE_PREP_SECRET_FILE,dependencies);}
 catch{return report('OPERATOR_SECRET_FILE_NOT_SECURE_OR_UNAVAILABLE');}
 try{
  url.password=pw;
  return await (dependencies.probeFn||probe)({...config,GPT02_CORE_PREP_DATABASE_URL_DEV:url.toString()});
 }catch{
  return report('DEDICATED_LOGIN_OR_CATALOG_PROBE_FAILED');
 }finally{
  pw=null;
  url.password='';
 }
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 const result=await handoff();
 process.stdout.write(JSON.stringify(result)+'\n');
 if(!result.permissionsVerified)process.exitCode=2;
}
