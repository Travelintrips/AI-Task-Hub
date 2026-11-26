import test from 'node:test';
import assert from 'node:assert/strict';
import {hostedEvidenceTarget,issuerPoolConfig,createIssuerStore} from '../../artifacts/api-server/src/lib/gpt02-issuer-store.mjs';
const evidence='e'.repeat(20),hub=evidence,prod='p'.repeat(20);
const env={NODE_ENV:'development',APP_ENV:'development',GPT02_EVIDENCE_DEV_PROJECT_REF:evidence,GPT02_HUB_DEV_PROJECT_REF:hub,GPT02_PROD_PROJECT_REF:prod,GPT02_EVIDENCE_DEV_HOST:`db.${evidence}.supabase.co`,GPT02_EVIDENCE_DEV_DATABASE:'postgres',GPT02_ISSUER_DATABASE_URL_DEV:`postgresql://dev_gpt02_issuer_evidence:synthetic@db.${evidence}.supabase.co:5432/postgres`,GPT02_ATTESTOR_DATABASE_URL_DEV:`postgresql://dev_gpt02_attestor_evidence:synthetic@db.${evidence}.supabase.co:5432/postgres`};
test('existing CST-DEV target accepts only dedicated identities and verified TLS',()=>{
 assert.equal(hostedEvidenceTarget(env).projectRef,evidence);
 for(const kind of ['issuer','attestor']){const c=issuerPoolConfig(env,kind);assert.equal(c.ssl.rejectUnauthorized,true);assert.equal(c.max,2);assert.equal(c.statement_timeout,5000);}
});
test('existing DEV is allowed; PROD remains forbidden even with matching URL and host',()=>{
 assert.equal(hostedEvidenceTarget(env).topology,'EXISTING_CST_DEV_PRIVATE_SCHEMA');
 const input={...env,GPT02_EVIDENCE_DEV_PROJECT_REF:prod,GPT02_HUB_DEV_PROJECT_REF:prod,GPT02_EVIDENCE_DEV_HOST:`db.${prod}.supabase.co`,GPT02_ISSUER_DATABASE_URL_DEV:`postgresql://dev_gpt02_issuer_evidence:synthetic@db.${prod}.supabase.co/postgres`};
 assert.throws(()=>issuerPoolConfig(input,'issuer'),e=>e.code==='EVIDENCE_PRODUCTION_TARGET_FORBIDDEN');
 assert.throws(()=>hostedEvidenceTarget({...env,GPT02_PROD_PROJECT_REF:hub}),e=>e.code==='EVIDENCE_PRODUCTION_TARGET_FORBIDDEN');
});
test('unapproved new projects or branches are rejected',()=>{
 const ref='n'.repeat(20);
 assert.throws(()=>hostedEvidenceTarget({...env,GPT02_EVIDENCE_DEV_PROJECT_REF:ref,GPT02_EVIDENCE_DEV_HOST:`db.${ref}.supabase.co`}),e=>e.code==='EXISTING_CST_DEV_PROJECT_REQUIRED');
});
test('DEV and PROD references must be explicitly pinned',()=>{
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
 assert.throws(()=>createIssuerStore({env:{...env,GPT02_EVIDENCE_DEV_PROJECT_REF:prod},kind:'issuer',PoolClass:Pool,trustedPublicKeyPem:'unused'}));
 assert.equal(constructed,false);
});
test('configuration rejection does not expose the credential',()=>{
 const secret='do-not-log-this-value';
 try{issuerPoolConfig({...env,GPT02_ISSUER_DATABASE_URL_DEV:`postgresql://postgres:${secret}@db.${evidence}.supabase.co/postgres`},'issuer');assert.fail('should deny');}
 catch(e){assert.equal(e.code,'DEDICATED_DSN_SCOPE_MISMATCH');assert.equal(e.message.includes(secret),false);}
});

const pooled={...env,GPT02_EVIDENCE_DEV_CONNECTION_MODE:'session_pooler',GPT02_EVIDENCE_DEV_POOLER_HOST:'aws-1-ap-southeast-2.pooler.supabase.com',GPT02_EVIDENCE_DEV_HOST:'aws-1-ap-southeast-2.pooler.supabase.com',GPT02_EVIDENCE_DEV_CA:'-----BEGIN CERTIFICATE-----\nTEST ONLY; parsed by the real TLS driver during connection\n-----END CERTIFICATE-----',GPT02_ISSUER_DATABASE_URL_DEV:`postgresql://dev_gpt02_issuer_evidence:synthetic@db.${evidence}.supabase.co/postgres`};
pooled.GPT02_ISSUER_DATABASE_URL_DEV=`postgresql://dev_gpt02_issuer_evidence.${evidence}:synthetic@${pooled.GPT02_EVIDENCE_DEV_HOST}:5432/postgres`;
pooled.GPT02_ATTESTOR_DATABASE_URL_DEV=`postgresql://dev_gpt02_attestor_evidence.${evidence}:synthetic@${pooled.GPT02_EVIDENCE_DEV_HOST}:5432/postgres`;
test('explicit session pooler binds project-scoped logins, fixed host and verified TLS',()=>{
 for(const kind of ['issuer','attestor']){const cfg=issuerPoolConfig(pooled,kind);assert.equal(cfg.ssl.rejectUnauthorized,true);assert.equal(cfg.ssl.ca,pooled.GPT02_EVIDENCE_DEV_CA);}
 assert.equal(hostedEvidenceTarget(pooled).mode,'session_pooler');
});
test('session mode requires configured CA and never disables TLS',()=>{
 for(const ca of [undefined,'','not a certificate'])assert.throws(()=>issuerPoolConfig({...pooled,GPT02_EVIDENCE_DEV_CA:ca},'issuer'),e=>e.code==='SESSION_POOLER_CA_REQUIRED');
 assert.throws(()=>issuerPoolConfig({...pooled,NODE_TLS_REJECT_UNAUTHORIZED:'0'},'issuer'),e=>e.code==='TLS_VERIFICATION_REQUIRED');
});
test('wrong role, project suffix, host, and transaction port are blocked',()=>{
 for(const url of [pooled.GPT02_ISSUER_DATABASE_URL_DEV.replace(evidence,prod),pooled.GPT02_ISSUER_DATABASE_URL_DEV.replace(`.${evidence}:`,':'),pooled.GPT02_ISSUER_DATABASE_URL_DEV.replace('dev_gpt02_issuer_evidence','postgres'),pooled.GPT02_ISSUER_DATABASE_URL_DEV.replace(':5432',':6543'),pooled.GPT02_ISSUER_DATABASE_URL_DEV.replace('aws-1','aws-0'),pooled.GPT02_ISSUER_DATABASE_URL_DEV+'?sslmode=disable'])assert.throws(()=>issuerPoolConfig({...pooled,GPT02_ISSUER_DATABASE_URL_DEV:url},'issuer'),e=>e.code==='DEDICATED_DSN_SCOPE_MISMATCH');
});
test('no automatic pooler fallback, unsupported mode or lookalike host',()=>{
 assert.throws(()=>issuerPoolConfig({...pooled,GPT02_EVIDENCE_DEV_CONNECTION_MODE:undefined},'issuer'));
 assert.throws(()=>issuerPoolConfig({...pooled,GPT02_EVIDENCE_DEV_CONNECTION_MODE:'transaction_pooler'},'issuer'),e=>e.code==='UNSUPPORTED_CONNECTION_MODE');
 for(const host of ['localhost','aws-1-ap-southeast-2.pooler.supabase.com.evil.test',''])assert.throws(()=>issuerPoolConfig({...pooled,GPT02_EVIDENCE_DEV_POOLER_HOST:host,GPT02_EVIDENCE_DEV_HOST:host},'issuer'),e=>e.code==='PINNED_SESSION_POOLER_REQUIRED');
});
