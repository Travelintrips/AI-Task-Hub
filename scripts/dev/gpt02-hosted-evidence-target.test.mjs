import test from 'node:test';
import assert from 'node:assert/strict';
import {hostedEvidenceTarget,issuerPoolConfig,createIssuerStore} from '../../artifacts/api-server/src/lib/gpt02-issuer-store.mjs';
const evidence='e'.repeat(20),hub='h'.repeat(20),prod='p'.repeat(20);
const env={NODE_ENV:'development',APP_ENV:'development',GPT02_EVIDENCE_DEV_PROJECT_REF:evidence,GPT02_HUB_DEV_PROJECT_REF:hub,GPT02_PROD_PROJECT_REF:prod,GPT02_EVIDENCE_DEV_HOST:`db.${evidence}.supabase.co`,GPT02_EVIDENCE_DEV_DATABASE:'postgres',GPT02_ISSUER_DATABASE_URL_DEV:`postgresql://dev_gpt02_issuer_evidence:synthetic@db.${evidence}.supabase.co:5432/postgres`,GPT02_ATTESTOR_DATABASE_URL_DEV:`postgresql://dev_gpt02_attestor_evidence:synthetic@db.${evidence}.supabase.co:5432/postgres`};
test('separate Supabase target accepts only dedicated identities and verified TLS',()=>{
 assert.equal(hostedEvidenceTarget(env).projectRef,evidence);
 for(const kind of ['issuer','attestor']){const c=issuerPoolConfig(env,kind);assert.equal(c.ssl.rejectUnauthorized,true);assert.equal(c.max,2);assert.equal(c.statement_timeout,5000);}
});
test('target is never the Hub database or PROD, even with matching URL and host',()=>{
 for(const ref of [hub,prod]){
  const input={...env,GPT02_EVIDENCE_DEV_PROJECT_REF:ref,GPT02_EVIDENCE_DEV_HOST:`db.${ref}.supabase.co`,GPT02_ISSUER_DATABASE_URL_DEV:`postgresql://dev_gpt02_issuer_evidence:synthetic@db.${ref}.supabase.co/postgres`};
  assert.throws(()=>issuerPoolConfig(input,'issuer'),e=>e.code==='EVIDENCE_PROJECT_MUST_BE_INDEPENDENT');
 }
 assert.throws(()=>hostedEvidenceTarget({...env,GPT02_PROD_PROJECT_REF:hub}),e=>e.code==='EVIDENCE_PROJECT_MUST_BE_INDEPENDENT');
});
test('all three independent project references must be explicitly pinned',()=>{
 for(const name of ['GPT02_EVIDENCE_DEV_PROJECT_REF','GPT02_HUB_DEV_PROJECT_REF','GPT02_PROD_PROJECT_REF'])for(const value of [undefined,'',[],'short','A'.repeat(20),'e'.repeat(21)])
 assert.throws(()=>issuerPoolConfig({...env,[name]:value},'issuer'),e=>e.code==='PINNED_SUPABASE_PROJECT_REFS_REQUIRED');
});
test('direct evidence connection cannot use local DB, pooler, or lookalike hostname',()=>{
 for(const host of ['localhost','127.0.0.1','db.fake.supabase.co',`db.${evidence}.supabase.co.attacker.test`,'aws-0-ap-southeast-2.pooler.supabase.com'])
 assert.throws(()=>issuerPoolConfig({...env,GPT02_EVIDENCE_DEV_HOST:host,GPT02_ISSUER_DATABASE_URL_DEV:`postgresql://dev_gpt02_issuer_evidence:synthetic@${host}/postgres`},'issuer'));
});
test('alternate database, port and DSN TLS or startup options are forbidden',()=>{
 for(const url of [env.GPT02_ISSUER_DATABASE_URL_DEV.replace('/postgres','/other'),env.GPT02_ISSUER_DATABASE_URL_DEV.replace(':5432',':6543'),env.GPT02_ISSUER_DATABASE_URL_DEV+'?sslmode=disable',env.GPT02_ISSUER_DATABASE_URL_DEV+'?options=-c%20role%3Dpostgres'])
 assert.throws(()=>issuerPoolConfig({...env,GPT02_ISSUER_DATABASE_URL_DEV:url},'issuer'),e=>e.code==='DEDICATED_DSN_SCOPE_MISMATCH');
});
test('cross-project failure occurs before pool construction',()=>{
 let constructed=false;
 class Pool {constructor(){constructed=true;}}
 assert.throws(()=>createIssuerStore({env:{...env,GPT02_EVIDENCE_DEV_PROJECT_REF:hub},kind:'issuer',PoolClass:Pool,trustedPublicKeyPem:'unused'}));
 assert.equal(constructed,false);
});
test('configuration rejection does not expose the credential',()=>{
 const secret='do-not-log-this-value';
 try{issuerPoolConfig({...env,GPT02_ISSUER_DATABASE_URL_DEV:`postgresql://postgres:${secret}@db.${evidence}.supabase.co/postgres`},'issuer');assert.fail('should deny');}
 catch(e){assert.equal(e.code,'DEDICATED_DSN_SCOPE_MISMATCH');assert.equal(e.message.includes(secret),false);}
});
