/**
 * Dedicated CST-DEV Hub/Core evidence-reader sidecar.
 *
 * This is intentionally outside the live API route/worker tree. It receives
 * two independent DSNs only through systemd LoadCredentialEncrypted mounts,
 * exposes a root-only Unix-domain socket, and has no TCP listener.
 * It never signs, consumes nonce, creates tasks/commands, grants leases,
 * or dispatches to GPT02 DELL.
 */
import {createServer} from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createGpt02ReaderPools} from '../../artifacts/api-server/src/lib/gpt02-reader-pools.mjs';
import {
 createGpt02TrustedFactReader,
 verifyGpt02TrustedReaderPools
} from '../../artifacts/api-server/src/lib/gpt02-trusted-facts-readonly.mjs';

const require=createRequire(import.meta.url);
const MAX_BODY_BYTES=8192;
const DEFAULT_SOCKET='/run/gpt02-reader/reader.sock';

const codeOf=e=>typeof e?.code==='string'&&/^[A-Z0-9_:-]{1,100}$/.test(e.code)
 ?e.code:'TRUSTED_READ_FAILED_CLOSED';
function respond(res,status,payload){
 const body=Buffer.from(JSON.stringify(payload));
 res.writeHead(status,{
  'content-type':'application/json; charset=utf-8',
  'content-length':String(body.length),
  'cache-control':'no-store',
  'x-content-type-options':'nosniff'
 });
 res.end(body);
}
async function readJson(req){
 if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))
  throw Object.assign(new Error('JSON_REQUIRED'),{code:'JSON_REQUIRED'});
 const chunks=[];
 let size=0;
 let tooLarge=false;
 for await(const chunk of req){
  size+=chunk.length;
  if(size>MAX_BODY_BYTES){tooLarge=true;continue;}
  if(!tooLarge)chunks.push(chunk);
 }
 if(tooLarge)
  throw Object.assign(new Error('REQUEST_TOO_LARGE'),{code:'REQUEST_TOO_LARGE'});
 let value;
 try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'))}
 catch{throw Object.assign(new Error('INVALID_JSON'),{code:'INVALID_JSON'})}
 if(!value||typeof value!=='object'||Array.isArray(value))
  throw Object.assign(new Error('JSON_OBJECT_REQUIRED'),{code:'JSON_OBJECT_REQUIRED'});
 return value;
}

export function createGpt02ReaderRuntimeServer({reader,verify}={}){
 if(typeof reader!=='function'||typeof verify!=='function')
  throw new Error('GPT02_READER_RUNTIME_DEPENDENCIES_REQUIRED');
 const server=createServer(async(req,res)=>{
  if(req.method==='GET'&&req.url==='/health'){
   try{
    const proof=await verify();
    respond(res,200,{ok:true,environment:'DEV',readerReady:true,
     hubRole:proof.hub.role,coreRole:proof.core.role,
     twoSessionsVerified:proof.separateBackends===true,
     signingPermitted:false,dispatchPermitted:false});
   }catch(e){
    respond(res,503,{ok:false,readerReady:false,code:codeOf(e),
     signingPermitted:false,dispatchPermitted:false});
   }
   return;
  }
  if(req.method==='POST'&&req.url==='/trusted-facts'){
   let query;
   try{query=await readJson(req)}
   catch(e){
    const code=codeOf(e);
    respond(res,code==='REQUEST_TOO_LARGE'?413:400,{ok:false,code,
     signingPermitted:false,dispatchPermitted:false});
    return;
   }
   try{
    const facts=await reader(query);
    respond(res,200,{ok:true,environment:'DEV',facts,
     signingPermitted:false,dispatchPermitted:false});
   }catch(e){
    const code=codeOf(e);
    const status=code==='UNTRUSTED_TASK_IDENTITY'?400:
     code.startsWith('TRUSTED_')||code.startsWith('INDEPENDENT_')?409:503;
    respond(res,status,{ok:false,code,
     signingPermitted:false,dispatchPermitted:false});
   }
   return;
  }
  respond(res,404,{ok:false,code:'NOT_FOUND'});
 });
 server.headersTimeout=5000;
 server.requestTimeout=15000;
 server.keepAliveTimeout=1000;
 server.maxHeadersCount=16;
 return server;
}

export async function listenGpt02ReaderRuntimeSocket(server,socketPath,socketGroupGid=process.getgid()){
 if(typeof socketPath!=='string'||!path.isAbsolute(socketPath))
  throw new Error('GPT02_READER_SOCKET_PATH_REQUIRED');
 const parent=path.dirname(socketPath);
 const dir=fs.lstatSync(parent);
 if(!dir.isDirectory()||dir.uid!==process.getuid()||dir.gid!==socketGroupGid||
    (dir.mode&0o7777)!==0o750)
  throw new Error('GPT02_READER_SOCKET_DIRECTORY_NOT_PRIVATE');
 if(fs.existsSync(socketPath)){
  const existing=fs.lstatSync(socketPath);
  if(!existing.isSocket()||existing.uid!==process.getuid()||existing.gid!==socketGroupGid)
   throw new Error('GPT02_READER_SOCKET_PATH_OCCUPIED');
  fs.unlinkSync(socketPath);
 }
 await new Promise((resolve,reject)=>{
  server.once('error',reject);
  server.listen(socketPath,()=>{server.removeListener('error',reject);resolve()});
 });
 fs.chownSync(socketPath,process.getuid(),socketGroupGid);
 fs.chmodSync(socketPath,0o660);
 const socket=fs.lstatSync(socketPath);
 if(!socket.isSocket()||socket.uid!==process.getuid()||socket.gid!==socketGroupGid||
    (socket.mode&0o777)!==0o660)
  throw new Error('GPT02_READER_SOCKET_MODE_INVALID');
 return socketPath;
}



function resolveReaderSignerGroupGid(){
 const groupName='gpt02-issue159-signers';
 const line=fs.readFileSync('/etc/group','utf8').split(/\\r?\\n/).find(x=>x.startsWith(groupName+':'));
 if(!line)throw new Error('GPT02_READER_SIGNER_GROUP_REQUIRED');
 const fields=line.split(':');
 const gid=Number(fields[2]);
 if(!Number.isSafeInteger(gid)||gid<=0)throw new Error('GPT02_READER_SIGNER_GROUP_INVALID');
 return gid;
}

export async function startGpt02ReaderRuntime(){
 if(process.env.NODE_ENV!=='development'||process.env.APP_ENV!=='development')
  throw new Error('GPT02_READER_EXPLICIT_DEV_MODE_REQUIRED');
 const {Pool}=require('pg');
 // The factory reads only the fixed systemd credential mount. No DSN or CA
 // is copied into process.env, a shared API environment file, or logs.
 const pools=createGpt02ReaderPools({
  Pool,nodeEnv:'development',appEnv:'development'
 });
 const verify=()=>verifyGpt02TrustedReaderPools(pools);
 const readFacts=createGpt02TrustedFactReader(pools);
 const reader=async query=>{
  const facts=await readFacts(query);
  return Object.freeze({
   ...facts,
   trustedReadProof:Object.freeze({
    source:'gpt02-issue159-reader',
    environment:'DEV',
    hubRole:'gpt02_hub_evidence_reader',
    coreRole:'gpt02_core_evidence_reader',
    separateBackends:true,
    clientTlsVerified:true,
    readOnly:true,
    dispatchPermitted:false,
    signingPermitted:false
   })
  });
 };
 let server;
 try{
  const initial=await verify();
  server=createGpt02ReaderRuntimeServer({reader,verify});
  const socketPath=process.env.GPT02_READER_SOCKET||DEFAULT_SOCKET;
  const signerGroupGid=resolveReaderSignerGroupGid();
  await listenGpt02ReaderRuntimeSocket(server,socketPath,signerGroupGid);
  process.stdout.write(JSON.stringify({
   event:'gpt02_reader_runtime_started',
   environment:'DEV',socketPath,
   hubRole:initial.hub.role,coreRole:initial.core.role,
   twoSessionsVerified:initial.separateBackends,
   signingPermitted:false,dispatchPermitted:false
  })+'\n');
  const shutdown=()=>{
   server.close(async()=>{
    try{await Promise.all([pools.hubPool.end(),pools.corePool.end()])}catch{}
    try{if(fs.existsSync(socketPath))fs.unlinkSync(socketPath)}catch{}
    process.exit(0);
   });
   server.closeAllConnections?.();
  };
  process.once('SIGTERM',shutdown);
  process.once('SIGINT',shutdown);
  return {server,pools,socketPath};
 }catch(e){
  if(server)try{server.close()}catch{}
  try{await Promise.all([pools.hubPool.end(),pools.corePool.end()])}catch{}
  throw e;
 }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 startGpt02ReaderRuntime().catch(e=>{
  const code=codeOf(e);
  process.stderr.write(JSON.stringify({
   event:'gpt02_reader_runtime_start_failed',
   code,environment:'DEV',signingPermitted:false,dispatchPermitted:false
  })+'\n');
  process.exitCode=1;
 });
}
