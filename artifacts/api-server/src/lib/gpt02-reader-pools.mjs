/**
 * GPT02 DEV-only candidate: construct two independent PostgreSQL pools for
 * trusted Hub/Core evidence reads. Not imported by HTTP routes/workers.
 *
 * No fallback to the shared application pool is allowed. Credentials stay in
 * environment variables and are never returned or logged by this module.
 */
import {X509Certificate} from 'node:crypto';
import {lstatSync,readFileSync} from 'node:fs';

const PROJECT_REF='xssrfshdrtdfupgqwfdw';
const POOLER_HOST='aws-1-ap-southeast-2.pooler.supabase.com';
const DATABASE='postgres';
const HUB_ENV='GPT02_HUB_READER_DATABASE_URL_DEV';
const CORE_ENV='GPT02_CORE_READER_DATABASE_URL_DEV';
const CA_ENV='GPT02_READER_DEV_CA';
const CREDENTIAL_DIR='/run/credentials/gpt02-dev';
const HUB_CREDENTIAL='hub-reader-dsn';
const CORE_CREDENTIAL='core-reader-dsn';
const CA_CREDENTIAL='supabase-root-ca-2021.crt';
const PINNED_ROOT_FINGERPRINT='807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa';

const fail=code=>{const e=new Error(code);e.code=code;throw e;};
function pinnedReaderCa(pem){
 if(typeof pem!=='string'||pem.length>8192||
    !/^-----BEGIN CERTIFICATE-----\r?\n(?:[A-Za-z0-9+/=]+\r?\n)+-----END CERTIFICATE-----\r?\n?$/.test(pem))
  fail('GPT02_READER_PINNED_CA_REQUIRED');
 try{
  const certificate=new X509Certificate(pem);
  if(certificate.fingerprint256.replaceAll(':','').toLowerCase()!==PINNED_ROOT_FINGERPRINT)
   fail('GPT02_READER_PINNED_CA_REQUIRED');
 }catch(e){
  if(e?.code==='GPT02_READER_PINNED_CA_REQUIRED')throw e;
  fail('GPT02_READER_PINNED_CA_REQUIRED');
 }
 return pem;
}


function readCredentialFile(path,synthetic){
 let st;
 try{st=lstatSync(path)}catch{fail('GPT02_READER_CREDENTIAL_FILE_REQUIRED')}
 const mode=st.mode&0o777;
 const uid=synthetic?(process.getuid?.()??st.uid):0;
 const gid=synthetic?(process.getgid?.()??st.gid):0;
 if(!st.isFile()||st.isSymbolicLink()||st.uid!==uid||st.gid!==gid||
    ![0o400,0o600].includes(mode))
  fail('GPT02_READER_CREDENTIAL_FILE_SECURITY_INVALID');
 let value;
 try{value=readFileSync(path,'utf8')}catch{fail('GPT02_READER_CREDENTIAL_FILE_REQUIRED')}
 if(typeof value!=='string'||value.length<1||value.length>8192)
  fail('GPT02_READER_CREDENTIAL_FILE_INVALID');
 return value;
}

function parseReaderDsn(value,role){
 if(typeof value!=='string'||value.length<1||value.length>4096)
  fail('GPT02_READER_DSN_REQUIRED');
 let u;
 try{u=new URL(value)}catch{fail('GPT02_READER_DSN_INVALID')}
 if(u.protocol!=='postgresql:'&&u.protocol!=='postgres:')
  fail('GPT02_READER_POSTGRES_DSN_REQUIRED');
 if(u.hostname!==POOLER_HOST||Number(u.port||5432)!==5432||
    u.pathname!=='/'+DATABASE)
  fail('GPT02_READER_CST_DEV_TARGET_REQUIRED');
 const expected=role+'.'+PROJECT_REF;
 if(decodeURIComponent(u.username)!==expected||!u.password)
  fail('GPT02_READER_DEDICATED_IDENTITY_REQUIRED');
 if(u.hash||[...u.searchParams.keys()].length!==0)
  fail('GPT02_READER_DSN_QUERY_FORBIDDEN');
 return Object.freeze({connectionString:value,role});
}

export function createGpt02ReaderPools({
 env=process.env,
 Pool,
 nodeEnv=process.env.NODE_ENV,
 appEnv=process.env.APP_ENV,
 credentialDirectory=CREDENTIAL_DIR
}={}){
 const synthetic=nodeEnv==='test'&&appEnv!=='production';
 if(env?.NODE_TLS_REJECT_UNAUTHORIZED==='0')
  fail('GPT02_READER_TLS_DISABLE_FORBIDDEN');
 if(!synthetic&&(nodeEnv!=='development'||appEnv!=='development'))
  fail('GPT02_READER_EXPLICIT_CST_DEV_MODE_REQUIRED');
 if(typeof Pool!=='function')fail('GPT02_READER_POOL_FACTORY_REQUIRED');

 let hubDsn,coreDsn,caPem;
 if(synthetic){
  const hasSyntheticEnv=[HUB_ENV,CORE_ENV,CA_ENV].some(k=>typeof env?.[k]==='string');
  if(hasSyntheticEnv){
   hubDsn=env?.[HUB_ENV];coreDsn=env?.[CORE_ENV];caPem=env?.[CA_ENV];
  }else{
   hubDsn=readCredentialFile(`${credentialDirectory}/${HUB_CREDENTIAL}`,true);
   coreDsn=readCredentialFile(`${credentialDirectory}/${CORE_CREDENTIAL}`,true);
   caPem=readCredentialFile(`${credentialDirectory}/${CA_CREDENTIAL}`,true);
  }
 }else{
  if(credentialDirectory!==CREDENTIAL_DIR||
     [HUB_ENV,CORE_ENV,CA_ENV].some(k=>typeof env?.[k]==='string'))
   fail('GPT02_READER_OPERATIONAL_CREDENTIAL_SOURCE_NOT_PINNED');
  hubDsn=readCredentialFile(`${CREDENTIAL_DIR}/${HUB_CREDENTIAL}`,false);
  coreDsn=readCredentialFile(`${CREDENTIAL_DIR}/${CORE_CREDENTIAL}`,false);
  caPem=readCredentialFile(`${CREDENTIAL_DIR}/${CA_CREDENTIAL}`,false);
 }
 const ca=pinnedReaderCa(caPem);
 const hub=parseReaderDsn(hubDsn,'gpt02_hub_evidence_reader');
 const core=parseReaderDsn(coreDsn,'gpt02_core_evidence_reader');
 if(hub.connectionString===core.connectionString)
  fail('GPT02_READER_DISTINCT_DSNS_REQUIRED');

 const common={
  max:1,
  idleTimeoutMillis:10000,
  connectionTimeoutMillis:5000,
  ssl:{ca,rejectUnauthorized:true},
  // Fail closed from PostgreSQL startup, before any application query.
  // Supavisor rejects search_path as a libpq startup option. Set it with
  // pg-pool's verify hook before the connection is handed to a caller.
  options:'-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=10000',
  verify:(client,done)=>{
   client.query('SET search_path TO pg_catalog')
    .then(()=>done())
    .catch(error=>done(error instanceof Error?error:new Error('GPT02_READER_SESSION_INIT_FAILED')));
  },
  allowExitOnIdle:true
 };
 const hubPool=new Pool({...common,connectionString:hub.connectionString,
  application_name:'gpt02-hub-evidence-reader'});
 const corePool=new Pool({...common,connectionString:core.connectionString,
  application_name:'gpt02-core-evidence-reader'});
 if(!hubPool||!corePool||hubPool===corePool)
  fail('GPT02_READER_DISTINCT_POOLS_REQUIRED');

 return Object.freeze({
  hubPool,corePool,
  metadata:Object.freeze({
   environment:'DEV',
   projectRef:PROJECT_REF,
   host:POOLER_HOST,
   database:DATABASE,
   hubRole:'gpt02_hub_evidence_reader',
   coreRole:'gpt02_core_evidence_reader',
   independentlyConfigured:true,
   credentialSource:'systemd-credential-files',
   credentialDirectory:CREDENTIAL_DIR,
   dispatchPermitted:false
  })
 });
}
