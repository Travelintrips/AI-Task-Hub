import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {generateKeyPairSync,randomUUID,randomBytes,sign,createHash} from 'node:crypto';
import {Gpt02IssuerStore,canonicalApproval,issuerPoolConfig} from '../../artifacts/api-server/src/lib/gpt02-issuer-store.mjs';
const require=createRequire(import.meta.url),{Pool}=require(process.env.GPT02_TEST_PG_MODULE);
const auth=JSON.parse(readFileSync('/run/fixture-auth.json','utf8'));
const ROLE={issuer:'dev_gpt02_issuer_evidence',attestor:'dev_gpt02_attestor_evidence'};
const poolFor=user=>new Pool({host:'/var/run/postgresql',database:'gpt02_issuer_isolated',user,password:auth[user],max:4,connectionTimeoutMillis:4000,statement_timeout:5000});
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const pem=publicKey.export({format:'pem',type:'spki'}).toString();let nextId=500;
function envelope(overrides={}){
 const now=Date.now(),claims={v:1,environment:'DEV',audience:'GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL',taskId:nextId++,commandId:randomUUID(),attemptId:randomUUID(),nonce:randomBytes(32).toString('base64url'),superAdminId:7,companyId:'synthetic_tenant',issuedAt:now-50,expiresAt:now+60000,...overrides};
 return {claims,signatureBase64url:sign(null,Buffer.from(canonicalApproval(claims)),privateKey).toString('base64url')};
}
const params=e=>[JSON.stringify(e.claims),e.signatureBase64url,createHash('sha256').update(canonicalApproval(e.claims)).digest('hex')];
const rejection=(promise,code)=>assert.rejects(promise,e=>e.code===code);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
test('separate SCRAM connections, signature-pinned store and atomic evidence persistence',async t=>{
 const admin=poolFor('postgres'),ip=poolFor(ROLE.issuer),ap=poolFor(ROLE.attestor),untrusted=poolFor('gpt02_untrusted_app');
 const issuer=new Gpt02IssuerStore({pool:ip,kind:'issuer',trustedPublicKeyPem:pem});
 const attestor=new Gpt02IssuerStore({pool:ap,kind:'attestor',trustedPublicKeyPem:pem});
 t.after(async()=>{await Promise.all([admin.end(),ip.end(),ap.end(),untrusted.end()]);});
 const count=async command=>Number((await admin.query('SELECT count(*) FROM gpt02_private.receipts WHERE command_id=$1',[command])).rows[0].count);
 const sqlConsume=(client,e)=>client.query('SELECT gpt02_private.consume_approval($1::jsonb,$2,$3) AS receipt_id',params(e));
 await t.test('both clients authenticate as themselves, not postgres SET ROLE',async()=>{
 for(const [p,role] of [[ip,ROLE.issuer],[ap,ROLE.attestor]]){const r=(await p.query('SELECT current_user,session_user')).rows[0];assert.equal(r.current_user,role);assert.equal(r.session_user,role);}
 });
 await t.test('wrong password is rejected by real SCRAM authentication',async()=>{
 const bad=new Pool({host:'/var/run/postgresql',database:'gpt02_issuer_isolated',user:ROLE.issuer,password:'invalid-fixture-password'});
 try{await rejection(bad.query('SELECT 1'),'28P01');}finally{await bad.end();}
 });
 await t.test('missing dedicated DSN never falls back to the application connection',()=>{
 assert.throws(()=>issuerPoolConfig({NODE_ENV:'development',APP_ENV:'development',SUPABASE_DATABASE_URL_DEV:'postgres://postgres:unused@localhost/app'},'issuer'),e=>e.code==='DEDICATED_DSN_REQUIRED');
 });
 await t.test('factory pins DEV host/database, fixed role, TLS and forbids DSN options',()=>{
 const env={NODE_ENV:'development',APP_ENV:'development',GPT02_EVIDENCE_DEV_PROJECT_REF:'e'.repeat(20),GPT02_HUB_DEV_PROJECT_REF:'h'.repeat(20),GPT02_PROD_PROJECT_REF:'p'.repeat(20),GPT02_EVIDENCE_DEV_HOST:`db.${'e'.repeat(20)}.supabase.co`,GPT02_EVIDENCE_DEV_DATABASE:'postgres',GPT02_ISSUER_DATABASE_URL_DEV:`postgres://dev_gpt02_issuer_evidence:synthetic@db.${'e'.repeat(20)}.supabase.co/postgres`};
 const cfg=issuerPoolConfig(env,'issuer');assert.equal(cfg.ssl.rejectUnauthorized,true);assert.equal(cfg.max,2);
 for(const m of [{NODE_ENV:'production'},{APP_ENV:'production'},{GPT02_EVIDENCE_DEV_HOST:'prod.example.test'},{GPT02_ISSUER_DATABASE_URL_DEV:'postgres://postgres:synthetic@dev.example.test/evidence'},{GPT02_ISSUER_DATABASE_URL_DEV:env.GPT02_ISSUER_DATABASE_URL_DEV+'?sslmode=disable'}])assert.throws(()=>issuerPoolConfig({...env,...m},'issuer'));
 });
 await t.test('no membership, elevated attributes, or PUBLIC function access',async()=>{
 const r=await admin.query('SELECT rolname,rolcanlogin,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=ANY($1::text[])',[[ROLE.issuer,ROLE.attestor,'gpt02_store_owner']]);assert.equal(r.rowCount,3);
 for(const v of r.rows)for(const k of ['rolsuper','rolbypassrls','rolcreaterole','rolcreatedb'])assert.equal(v[k],false);
 assert.equal(r.rows.find(x=>x.rolname==='gpt02_store_owner').rolcanlogin,false);
 const n=await admin.query('SELECT count(*) FROM pg_auth_members WHERE member IN (SELECT oid FROM pg_roles WHERE rolname=ANY($1::text[]))',[[ROLE.issuer,ROLE.attestor]]);assert.equal(Number(n.rows[0].count),0);
 await rejection(sqlConsume(untrusted,envelope()),'42501');
 });
 await t.test('issuer cannot switch role, read unrelated rows, or modify evidence directly',async()=>{
 for(const q of ['SET ROLE postgres','SET ROLE gpt02_store_owner',`SET ROLE ${ROLE.attestor}`,'SELECT * FROM public.unrelated_data','SELECT * FROM gpt02_private.approvals',"INSERT INTO gpt02_private.receipts(command_id,nonce,digest) VALUES (gen_random_uuid(),'not-valid','x')","UPDATE gpt02_private.receipts SET digest='x'",'DELETE FROM gpt02_private.receipts','TRUNCATE gpt02_private.receipts','CREATE TABLE gpt02_private.escalation(id int)'])await rejection(ip.query(q),'42501');
 });
 await t.test('issuer and attestor cannot execute each other\'s function',async()=>{
 await rejection(ip.query('SELECT gpt02_private.record_approval($1::jsonb,$2,$3)',params(envelope())),'42501');await rejection(sqlConsume(ap,envelope()),'42501');
 });
 await t.test('bad signature, arbitrary public key and unknown fields rejected before connecting',async()=>{
 let calls=0;const spy={connect(){calls++;throw Error('unexpected');}};
 const s=new Gpt02IssuerStore({pool:spy,kind:'issuer',trustedPublicKeyPem:pem});
 const e=envelope();e.signatureBase64url='A'.repeat(86);await rejection(s.consumeApproval(e),'INVALID_SIGNATURE');
 await rejection(s.consumeApproval({...envelope(),publicKeyPem:pem}),'INVALID_ENVELOPE');
 const forged=envelope();forged.claims.taskId++;await rejection(s.consumeApproval(forged),'INVALID_SIGNATURE');assert.equal(calls,0);
 });
 await t.test('Task 135, PROD, expired, overlong or malformed claims rejected before a write',async()=>{
 for(const changes of [{taskId:135},{environment:'PROD'},{expiresAt:Date.now()-1},{expiresAt:Date.now()+3600000},{issuedAt:Date.now()+20000},{companyId:'all'},{nonce:['not-a-string']}])await rejection(attestor.recordApproval(envelope(changes)),'INVALID_OR_EXPIRED_CLAIMS');
 });
 const shared=envelope();
 await t.test('signed approval stored through the restricted attestor connection',async()=>{
 const result=await attestor.recordApproval(shared);assert.equal(result.approvalEvidenceRecorded,true);assert.equal(result.authorizationGranted,false);assert.equal(result.dispatchPermitted,false);
 const r=(await admin.query('SELECT claims,signature,digest FROM gpt02_private.approvals WHERE command_id=$1',[shared.claims.commandId])).rows[0];assert.deepEqual(r.claims,shared.claims);assert.equal(r.signature,shared.signatureBase64url);
 });
 await t.test('duplicate evidence record is not overwritten',async()=>{await rejection(attestor.recordApproval(shared),'APPROVAL_NOT_RECORDED');});
 await t.test('different command-bound fields/signature cannot consume existing approval',async()=>{
 for(const o of [{companyId:'other_tenant'},{taskId:998},{superAdminId:999},{attemptId:randomUUID()},{nonce:randomBytes(32).toString('base64url')}])await rejection(issuer.consumeApproval(envelope({...shared.claims,...o})),'APPROVAL_UNAVAILABLE_OR_REPLAYED');
 assert.equal(await count(shared.claims.commandId),0);
 });
 await t.test('eight concurrent issuer requests produce exactly one committed receipt',async()=>{
 const results=await Promise.allSettled(Array.from({length:8},()=>issuer.consumeApproval(shared))),ok=results.filter(x=>x.status==='fulfilled');assert.equal(ok.length,1);assert.equal(results.filter(x=>x.status==='rejected').length,7);assert.equal(ok[0].value.authorizationGranted,false);assert.equal(ok[0].value.dispatchPermitted,false);assert.equal(await count(shared.claims.commandId),1);
 });
 await t.test('replay after the first committed receipt is rejected',async()=>{await rejection(issuer.consumeApproval(shared),'APPROVAL_UNAVAILABLE_OR_REPLAYED');});
 await t.test('rollback releases the nonce and does not leave a partial receipt',async()=>{
 const e=envelope();await attestor.recordApproval(e);const c=await ip.connect();
 try{await c.query('BEGIN');assert.ok((await sqlConsume(c,e)).rows[0].receipt_id);await c.query('ROLLBACK');}finally{c.release(true);}
 assert.equal(await count(e.claims.commandId),0);assert.ok((await issuer.consumeApproval(e)).receiptId);assert.equal(await count(e.claims.commandId),1);
 });
 await t.test('DB write failure rolls back and returns only a sanitized error',async()=>{
 const e=envelope();await attestor.recordApproval(e);
 await admin.query(`CREATE FUNCTION gpt02_private.inject_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test private connection data must not be returned'; END $$; CREATE TRIGGER inject_failure BEFORE INSERT ON gpt02_private.receipts FOR EACH ROW EXECUTE FUNCTION gpt02_private.inject_failure()`);
 try{await rejection(issuer.consumeApproval(e),'EVIDENCE_TRANSACTION_FAILED');}finally{await admin.query('DROP TRIGGER inject_failure ON gpt02_private.receipts; DROP FUNCTION gpt02_private.inject_failure()');}
 assert.equal(await count(e.claims.commandId),0);await issuer.consumeApproval(e);assert.equal(await count(e.claims.commandId),1);
 });
 await t.test('expiry is checked again after waiting for the approval lock',async()=>{
 const e=envelope({expiresAt:Date.now()+1300});await attestor.recordApproval(e);const lock=await admin.connect();let pending,observed=false;
 try{
 await lock.query('BEGIN');await lock.query('SELECT command_id FROM gpt02_private.approvals WHERE command_id=$1 FOR UPDATE',[e.claims.commandId]);pending=issuer.consumeApproval(e).then(v=>({v}),error=>({error}));
 for(let i=0;i<20;i++){const r=await admin.query("SELECT count(*) FROM pg_stat_activity WHERE usename=$1 AND wait_event_type='Lock'",[ROLE.issuer]);if(Number(r.rows[0].count)>0){observed=true;break;}await wait(20);}
 assert.equal(observed,true);await wait(Math.max(0,e.claims.expiresAt-Date.now()+60));await lock.query('COMMIT');
 }finally{try{await lock.query('ROLLBACK');}catch{}lock.release(true);}
 const r=await pending;assert.equal(r.error?.code,'APPROVAL_UNAVAILABLE_OR_REPLAYED');assert.equal(await count(e.claims.commandId),0);
 });
 await t.test('a postgres session using SET ROLE cannot impersonate a dedicated login',async()=>{
 const injected={async connect(){const c=await admin.connect();await c.query(`SET ROLE ${ROLE.issuer}`);return c;}};
 const fake=new Gpt02IssuerStore({pool:injected,kind:'issuer',trustedPublicKeyPem:pem});await rejection(fake.consumeApproval(envelope()),'UNSAFE_DATABASE_IDENTITY');
 });
 await t.test('accidental direct table grant blocks the connector before consumption',async()=>{
 const e=envelope();await attestor.recordApproval(e);
 await admin.query(`GRANT SELECT ON gpt02_private.approvals TO ${ROLE.issuer}`);
 try{await rejection(issuer.consumeApproval(e),'DIRECT_EVIDENCE_ACCESS_OR_SCHEMA_MISSING');}
 finally{await admin.query(`REVOKE SELECT ON gpt02_private.approvals FROM ${ROLE.issuer}`);}
 assert.equal(await count(e.claims.commandId),0);
 });
 await t.test('accidental owner-role membership blocks the connector',async()=>{
 const e=envelope();await attestor.recordApproval(e);
 await admin.query(`GRANT gpt02_store_owner TO ${ROLE.issuer}`);
 try{await rejection(issuer.consumeApproval(e),'UNSAFE_DATABASE_IDENTITY');}
 finally{await admin.query(`REVOKE gpt02_store_owner FROM ${ROLE.issuer}`);}
 assert.equal(await count(e.claims.commandId),0);
 });
 await t.test('append-only triggers stop UPDATE/DELETE even with owner privileges',async()=>{
 for(const q of ["UPDATE gpt02_private.approvals SET company_id='changed'",'DELETE FROM gpt02_private.receipts','TRUNCATE gpt02_private.receipts'])await rejection(admin.query(q),'55000');
 const rs=await admin.query("SELECT c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='gpt02_private' AND c.relkind='r'");assert.equal(rs.rowCount,2);for(const r of rs.rows){assert.equal(r.relrowsecurity,true);assert.equal(r.relforcerowsecurity,true);assert.equal(r.owner,'gpt02_store_owner');}
 });
});
