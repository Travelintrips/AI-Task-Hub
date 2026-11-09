import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {generateKeyPairSync,randomUUID,randomBytes,sign,createHash} from 'node:crypto';
import {Gpt02IssuerStore,canonicalApproval,issuerPoolConfig} from '../../artifacts/api-server/src/lib/gpt02-issuer-store.mjs';
import {canonicalOperatorLink,operatorLinkSigningBytes,createOperatorLinkVerifier} from '../../artifacts/api-server/src/lib/gpt02-operator-link.mjs';
const require=createRequire(import.meta.url),{Pool}=require(process.env.GPT02_TEST_PG_MODULE);
const auth=JSON.parse(readFileSync('/run/fixture-auth.json','utf8'));
const ROLE={issuer:'dev_gpt02_issuer_evidence',attestor:'dev_gpt02_attestor_evidence'};
const poolFor=user=>new Pool({host:'/var/run/postgresql',database:'gpt02_issuer_isolated',user,password:auth[user],max:4,connectionTimeoutMillis:4000,statement_timeout:5000});
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const pem=publicKey.export({format:'pem',type:'spki'}).toString();let nextId=500;
const hubKeys=generateKeyPairSync('ed25519'),coreKeys=generateKeyPairSync('ed25519');
const operatorAttestationKeys={hubPublicKeyPem:hubKeys.publicKey.export({format:'pem',type:'spki'}).toString(),corePublicKeyPem:coreKeys.publicKey.export({format:'pem',type:'spki'}).toString()};
function envelope(overrides={}){
 const now=Date.now(),claims={v:2,environment:'DEV',audience:'GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL',taskId:nextId++,commandId:randomUUID(),attemptId:randomUUID(),nonce:randomBytes(32).toString('base64url'),operatorNamespace:'ai-task-hub.public.users',superAdminId:'google_fixture_operator_7',companyId:'synthetic_tenant',issuedAt:now-50,expiresAt:now+60000,...overrides};
 return {claims,signatureBase64url:sign(null,Buffer.from(canonicalApproval(claims)),privateKey).toString('base64url')};
}
const params=e=>[JSON.stringify(e.claims),e.signatureBase64url,createHash('sha256').update(canonicalApproval(e.claims)).digest('hex')];
function linkedInput(approval=envelope({companyId:'default'}),overrides={}){
 const now=Date.now(),p=approval.claims,c={v:1,environment:'DEV',audience:'GPT02_DUAL_ACCOUNT_COMMAND_LINK',
 linkId:randomUUID(),companyId:p.companyId,hubTaskId:p.taskId,hubExecutionId:randomUUID(),
 coreTaskId:randomUUID(),coreCommandId:p.commandId,attemptId:p.attemptId,attemptNumber:1,
 assigneeId:42,accountableOwnerId:'fixture_owner',hubOperatorNamespace:'ai-task-hub.public.users',
 hubOperatorId:p.superAdminId,hubRole:'super_admin',hubActive:true,
 coreOperatorNamespace:'ai-core.ai_platform.internal_users',coreOperatorUserId:77,coreRole:'admin',coreActive:true,corePasswordChanged:true,
 workerId:'openclaw-dell-chatgpt-wake-dev',approvalDigest:createHash('sha256').update(canonicalApproval(p)).digest('hex'),
 nonce:p.nonce,issuedAt:Math.max(now-25,p.issuedAt),expiresAt:Math.min(now+45000,p.expiresAt),...overrides};
 return {approval,operatorLink:{claims:c,
 hubSignatureBase64url:sign(null,operatorLinkSigningBytes(c,'hub'),hubKeys.privateKey).toString('base64url'),
 coreSignatureBase64url:sign(null,operatorLinkSigningBytes(c,'core'),coreKeys.privateKey).toString('base64url')}};
}
const linkedParams=x=>[...params(x.approval),canonicalOperatorLink(x.operatorLink.claims),x.operatorLink.hubSignatureBase64url,x.operatorLink.coreSignatureBase64url,createHash('sha256').update(canonicalOperatorLink(x.operatorLink.claims)).digest('hex')];
const rejection=(promise,code)=>assert.rejects(promise,e=>e.code===code);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
test('separate SCRAM connections, signature-pinned store and atomic evidence persistence',async t=>{
 const admin=poolFor('postgres'),ip=poolFor(ROLE.issuer),ap=poolFor(ROLE.attestor),untrusted=poolFor('gpt02_untrusted_app');
 const issuer=new Gpt02IssuerStore({pool:ip,kind:'issuer',trustedPublicKeyPem:pem});
 const attestor=new Gpt02IssuerStore({pool:ap,kind:'attestor',trustedPublicKeyPem:pem});
 const linkedAttestor=new Gpt02IssuerStore({pool:ap,kind:'attestor',trustedPublicKeyPem:pem,operatorAttestationKeys});
 const linkedIssuer=new Gpt02IssuerStore({pool:ip,kind:'issuer',trustedPublicKeyPem:pem,operatorAttestationKeys});
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
 await t.test('v2 text-identity canonical bytes match preview and issuer implementations',async()=>{
 const {canonicalPayload,inspectSignedApproval}=require('./gpt02-signed-operator-approval-preview.cjs');
 const e=envelope();assert.equal(canonicalApproval(e.claims),canonicalPayload(e.claims));
 const p=inspectSignedApproval({...e,publicKeyPem:pem});
 assert.equal(p.signatureValid,true);assert.equal(p.dispatchPermitted,false);
 });
 await t.test('TEXT account primary keys survive signing, persistence and consumption unchanged',async()=>{
 for(const id of ['google_fixture_operator_7','7','007','fixture:user-1']){
 const e=envelope({superAdminId:id});await attestor.recordApproval(e);
 const row=(await admin.query('SELECT operator_namespace,approver_id,claims FROM gpt02_private.approvals WHERE command_id=$1',[e.claims.commandId])).rows[0];
 assert.equal(row.operator_namespace,'ai-task-hub.public.users');assert.equal(row.approver_id,id);assert.equal(row.claims.superAdminId,id);
 const result=await issuer.consumeApproval(e);assert.ok(result.receiptId);assert.equal(result.authorizationGranted,false);assert.equal(result.dispatchPermitted,false);
 }
 });
 await t.test('numbers, missing namespace, legacy v1 and malformed account ids cannot reach DB',async()=>{
 let calls=0;const spy={connect(){calls++;throw Error('unexpected');}};
 const s=new Gpt02IssuerStore({pool:spy,kind:'attestor',trustedPublicKeyPem:pem});
 for(const superAdminId of [7,0,null,'',' google_fixture_operator_7','google_fixture_operator_7 ','x/y','x'.repeat(129),{},['fixture']])
 await rejection(s.recordApproval(envelope({superAdminId})),'INVALID_OR_EXPIRED_CLAIMS');
 for(const operatorNamespace of ['team_members','google','public.users',null,''])
 await rejection(s.recordApproval(envelope({operatorNamespace})),'INVALID_OR_EXPIRED_CLAIMS');
 await rejection(s.recordApproval(envelope({v:1})),'INVALID_OR_EXPIRED_CLAIMS');assert.equal(calls,0);
 });
 await t.test('database record function also rejects account type and namespace substitution',async()=>{
 for(const change of [{superAdminId:7},{superAdminId:null},{superAdminId:['fixture']},{operatorNamespace:'team_members'},{v:1}]){
 const e=envelope(change);const out=await ap.query('SELECT gpt02_private.record_approval($1::jsonb,$2,$3) AS recorded',params(e));
 assert.equal(out.rows[0].recorded,false);
 const n=await admin.query('SELECT count(*)::int AS n FROM gpt02_private.approvals WHERE command_id=$1',[e.claims.commandId]);assert.equal(n.rows[0].n,0);
 }
 });
 await t.test('same-looking numeric TEXT ids are distinct command-bound identities',async()=>{
 const e=envelope({superAdminId:'007'});await attestor.recordApproval(e);
 await rejection(issuer.consumeApproval(envelope({...e.claims,superAdminId:'7'})),'APPROVAL_UNAVAILABLE_OR_REPLAYED');
 const changed={...e,claims:{...e.claims,superAdminId:'other_operator'}};
 await rejection(issuer.consumeApproval(changed),'INVALID_SIGNATURE');
 assert.equal(await count(e.claims.commandId),0);await issuer.consumeApproval(e);assert.equal(await count(e.claims.commandId),1);
 });
 const shared=envelope();
 await t.test('signed approval stored through the restricted attestor connection',async()=>{
 const result=await attestor.recordApproval(shared);assert.equal(result.approvalEvidenceRecorded,true);assert.equal(result.authorizationGranted,false);assert.equal(result.dispatchPermitted,false);
 const r=(await admin.query('SELECT claims,signature,digest FROM gpt02_private.approvals WHERE command_id=$1',[shared.claims.commandId])).rows[0];assert.deepEqual(r.claims,shared.claims);assert.equal(r.signature,shared.signatureBase64url);
 });
 await t.test('duplicate evidence record is not overwritten',async()=>{await rejection(attestor.recordApproval(shared),'APPROVAL_NOT_RECORDED');});
 await t.test('different command-bound fields/signature cannot consume existing approval',async()=>{
 for(const o of [{companyId:'other_tenant'},{taskId:998},{superAdminId:'google_fixture_operator_999'},{attemptId:randomUUID()},{nonce:randomBytes(32).toString('base64url')}])await rejection(issuer.consumeApproval(envelope({...shared.claims,...o})),'APPROVAL_UNAVAILABLE_OR_REPLAYED');
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
 for(const q of ["UPDATE gpt02_private.approvals SET company_id='changed'",'DELETE FROM gpt02_private.receipts','TRUNCATE gpt02_private.receipts CASCADE'])await rejection(admin.query(q),'55000');
 const rs=await admin.query("SELECT c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='gpt02_private' AND c.relkind='r'");assert.equal(rs.rowCount,4);for(const r of rs.rows){assert.equal(r.relrowsecurity,true);assert.equal(r.relforcerowsecurity,true);assert.equal(r.owner,'gpt02_store_owner');}
 });
 await t.test('dual identity proof needs independently pinned Hub and Core keys',async()=>{
 assert.throws(()=>createOperatorLinkVerifier(),e=>e.code==='PINNED_OPERATOR_KEYS_REQUIRED');
 assert.throws(()=>createOperatorLinkVerifier({...operatorAttestationKeys,corePublicKeyPem:operatorAttestationKeys.hubPublicKeyPem}),e=>e.code==='INDEPENDENT_OPERATOR_KEYS_REQUIRED');
 await rejection(attestor.recordLinkedApproval(linkedInput()),'PINNED_OPERATOR_KEYS_REQUIRED');
 });
 await t.test('one origin cannot impersonate the second origin or inject its own key',async()=>{
 let calls=0;const spy={connect(){calls++;throw Error('unexpected');}};
 const guard=new Gpt02IssuerStore({pool:spy,kind:'attestor',trustedPublicKeyPem:pem,operatorAttestationKeys});
 const x=linkedInput();
 for(const patch of [{coreSignatureBase64url:x.operatorLink.hubSignatureBase64url},{hubSignatureBase64url:x.operatorLink.coreSignatureBase64url},{coreSignatureBase64url:'A'.repeat(86)}])
 await rejection(guard.recordLinkedApproval({...x,operatorLink:{...x.operatorLink,...patch}}),'OPERATOR_LINK_SIGNATURE_NOT_VERIFIED');
 await rejection(guard.recordLinkedApproval({...x,operatorLink:{...x.operatorLink,publicKeyPem:pem}}),'INVALID_OPERATOR_LINK_ENVELOPE');
 assert.equal(calls,0);
 });
 await t.test('operator proof is inseparable from the exact signed approval and context',async()=>{
 let calls=0;const spy={connect(){calls++;throw Error('unexpected');}};
 const guard=new Gpt02IssuerStore({pool:spy,kind:'attestor',trustedPublicKeyPem:pem,operatorAttestationKeys});
 const e=envelope({companyId:'default'});
 for(const change of [{hubOperatorId:'other_hub_admin'},{hubTaskId:9999},{coreCommandId:randomUUID()},{attemptId:randomUUID()},{approvalDigest:'a'.repeat(64)},{nonce:randomBytes(32).toString('base64url')}])
 await rejection(guard.recordLinkedApproval(linkedInput(e,change)),'OPERATOR_LINK_APPROVAL_MISMATCH');
 assert.equal(calls,0);
 });
 await t.test('legacy task, operator type coercion, inactive roles and namespace swaps are denied',async()=>{
 let calls=0;const spy={connect(){calls++;throw Error('unexpected');}};
 const guard=new Gpt02IssuerStore({pool:spy,kind:'attestor',trustedPublicKeyPem:pem,operatorAttestationKeys});
 for(const change of [{hubTaskId:135},{coreCommandId:'83db99f5-cbda-4e60-be71-3090fb411bbb'},
 {hubExecutionId:'4eb75fa9-f9e4-4573-8e00-d3084b4c2c8a'},{coreOperatorUserId:'77'},{hubOperatorId:7},
 {coreOperatorUserId:2147483648},{coreOperatorUserId:0},{hubActive:false},{coreActive:false},{corePasswordChanged:false},
 {hubRole:'staff'},{coreRole:'manager'},{hubOperatorNamespace:'team_members'},
 {coreOperatorNamespace:'public.users'},{companyId:'other_tenant'},{attemptNumber:2},{workerId:'other-worker'}])
 await rejection(guard.recordLinkedApproval(linkedInput(undefined,change)),'INVALID_OR_EXPIRED_OPERATOR_LINK');
 assert.equal(calls,0);
 });
 await t.test('untrusted real signing key, stale timestamps and request-supplied key config are rejected',async()=>{
 let calls=0;const spy={connect(){calls++;throw Error('unexpected');}},guard=new Gpt02IssuerStore({pool:spy,kind:'attestor',trustedPublicKeyPem:pem,operatorAttestationKeys});
 const x=linkedInput(),unknown=generateKeyPairSync('ed25519');
 const sig=sign(null,operatorLinkSigningBytes(x.operatorLink.claims,'core'),unknown.privateKey).toString('base64url');
 await rejection(guard.recordLinkedApproval({...x,operatorLink:{...x.operatorLink,coreSignatureBase64url:sig}}),'OPERATOR_LINK_SIGNATURE_NOT_VERIFIED');
 for(const patch of [{expiresAt:Date.now()-1},{issuedAt:Date.now()+10000},{expiresAt:Date.now()+121000},{attemptNumber:0}])
 await rejection(guard.recordLinkedApproval(linkedInput(undefined,patch)),'INVALID_OR_EXPIRED_OPERATOR_LINK');
 await rejection(guard.recordLinkedApproval({...x,operatorAttestationKeys}),'INVALID_LINKED_APPROVAL_INPUT');
 assert.equal(calls,0);
 });
 await t.test('neither login can write/read link tables, impersonate origins or use the wrong function',async()=>{
 for(const p of [ip,ap])for(const q of ['SELECT * FROM gpt02_private.operator_links','SELECT * FROM gpt02_private.core_identity_receipts',
 'DELETE FROM gpt02_private.operator_links','TRUNCATE gpt02_private.core_identity_receipts'])await rejection(p.query(q),'42501');
 const x=linkedInput();
 await rejection(ip.query('SELECT gpt02_private.record_linked_approval($1::jsonb,$2,$3,$4::jsonb,$5,$6,$7)',linkedParams(x)),'42501');
 await rejection(ap.query('SELECT gpt02_private.consume_linked_approval($1::jsonb,$2,$3,$4::jsonb,$5,$6,$7)',linkedParams(x)),'42501');
 await rejection(untrusted.query('SELECT gpt02_private.consume_linked_approval($1::jsonb,$2,$3,$4::jsonb,$5,$6,$7)',linkedParams(x)),'42501');
 });
 const linked=linkedInput(envelope({companyId:'default',superAdminId:'google_fixture_operator_007'}),{coreOperatorUserId:77});
 await t.test('dual signatures persist exact Hub TEXT and distinct Core INTEGER in one transaction',async()=>{
 const out=await linkedAttestor.recordLinkedApproval(linked);assert.equal(out.dualIdentityEvidenceRecorded,true);assert.equal(out.authorizationGranted,false);
 const r=(await admin.query('SELECT hub_operator_id,core_operator_user_id,pg_typeof(core_operator_user_id)::text AS core_type,claims FROM gpt02_private.operator_links WHERE command_id=$1',[linked.approval.claims.commandId])).rows[0];
 assert.equal(r.hub_operator_id,'google_fixture_operator_007');assert.equal(r.core_operator_user_id,77);assert.equal(r.core_type,'integer');assert.equal(r.claims.assigneeId,42);
 assert.notEqual(r.core_operator_user_id,r.claims.assigneeId);assert.deepEqual(r.claims,linked.operatorLink.claims);
 });
 await t.test('a link uniqueness collision rolls back the approval insert too',async()=>{
 const x=linkedInput(undefined,{linkId:linked.operatorLink.claims.linkId});
 await rejection(linkedAttestor.recordLinkedApproval(x),'EVIDENCE_TRANSACTION_FAILED');
 const r=await admin.query('SELECT count(*)::int AS n FROM gpt02_private.approvals WHERE command_id=$1',[x.approval.claims.commandId]);assert.equal(r.rows[0].n,0);
 });
 await t.test('legacy consumption cannot bypass dual-origin verification',async()=>{
 await rejection(issuer.consumeApproval(linked.approval),'APPROVAL_UNAVAILABLE_OR_REPLAYED');assert.equal(await count(linked.approval.claims.commandId),0);
 });
 await t.test('eight concurrent linked consumes produce one receipt and one Core-compatible identity row',async()=>{
 const out=await Promise.allSettled(Array.from({length:8},()=>linkedIssuer.consumeLinkedApproval(linked)));
 const ok=out.filter(r=>r.status==='fulfilled');assert.equal(ok.length,1);assert.equal(out.filter(r=>r.status==='rejected').length,7);
 const result=ok[0].value;assert.equal(result.coreOperatorUserId,77);assert.equal(result.recordedBy,'internal:77');assert.equal(result.coreLedgerWritten,false);assert.equal(result.dispatchPermitted,false);
 const r=(await admin.query('SELECT c.*,pg_typeof(c.operator_user_id)::text AS id_type FROM gpt02_private.core_identity_receipts c JOIN gpt02_private.receipts r ON r.id=c.receipt_id AND r.command_id=c.command_id WHERE c.command_id=$1',[linked.approval.claims.commandId])).rows;
 assert.equal(r.length,1);assert.equal(r[0].operator_user_id,77);assert.equal(r[0].id_type,'integer');assert.equal(r[0].recorded_by,'internal:77');assert.equal(r[0].hub_operator_id,'google_fixture_operator_007');
 for(const k of ['binding_verified','may_dispatch_worker','may_close_job','may_issue_grant','core_ledger_written'])assert.equal(r[0][k],false);
 });
 await t.test('consumed identity proof cannot be replayed or replaced by fresh re-signing',async()=>{
 await rejection(linkedIssuer.consumeLinkedApproval(linked),'LINKED_APPROVAL_UNAVAILABLE_OR_REPLAYED');
 const changed=linkedInput(linked.approval,{...linked.operatorLink.claims,coreOperatorUserId:78});
 await rejection(linkedIssuer.consumeLinkedApproval(changed),'LINKED_APPROVAL_UNAVAILABLE_OR_REPLAYED');
 assert.equal(await count(linked.approval.claims.commandId),1);
 });
 await t.test('unlinked historical evidence cannot silently acquire a Core identity',async()=>{
 const e=envelope({companyId:'default'});await attestor.recordApproval(e);const x=linkedInput(e);
 await rejection(linkedAttestor.recordLinkedApproval(x),'LINKED_APPROVAL_NOT_RECORDED');
 await rejection(linkedIssuer.consumeLinkedApproval(x),'LINKED_APPROVAL_UNAVAILABLE_OR_REPLAYED');assert.equal(await count(e.claims.commandId),0);
 });
 await t.test('raw SQL rejects malformed operator types, namespace and inactive identity before writing',async()=>{
 for(const change of [{coreOperatorUserId:'77'},{hubOperatorId:7},{corePasswordChanged:false},{coreRole:'manager'},{hubOperatorNamespace:'team_members'}]){
 const x=linkedInput(undefined,change),r=await ap.query('SELECT gpt02_private.record_linked_approval($1::jsonb,$2,$3,$4::jsonb,$5,$6,$7) AS ok',linkedParams(x));
 assert.equal(r.rows[0].ok,false);assert.equal((await admin.query('SELECT count(*)::int AS n FROM gpt02_private.approvals WHERE command_id=$1',[x.approval.claims.commandId])).rows[0].n,0);
 }
 });
 await t.test('failure of Core identity insertion rolls back receipt and preserves one-shot retry',async()=>{
 const x=linkedInput();await linkedAttestor.recordLinkedApproval(x);
 await admin.query(`CREATE FUNCTION gpt02_private.inject_identity_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic private detail'; END $$; CREATE TRIGGER inject_identity_failure BEFORE INSERT ON gpt02_private.core_identity_receipts FOR EACH ROW EXECUTE FUNCTION gpt02_private.inject_identity_failure()`);
 try{await rejection(linkedIssuer.consumeLinkedApproval(x),'EVIDENCE_TRANSACTION_FAILED');}finally{await admin.query('DROP TRIGGER inject_identity_failure ON gpt02_private.core_identity_receipts; DROP FUNCTION gpt02_private.inject_identity_failure()');}
 assert.equal(await count(x.approval.claims.commandId),0);
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM gpt02_private.core_identity_receipts WHERE command_id=$1',[x.approval.claims.commandId])).rows[0].n,0);
 await linkedIssuer.consumeLinkedApproval(x);assert.equal(await count(x.approval.claims.commandId),1);
 });
 await t.test('identity expiry is rechecked after waiting, not just approval expiry',async()=>{
 const x=linkedInput(undefined,{expiresAt:Date.now()+1400});await linkedAttestor.recordLinkedApproval(x);
 const lock=await admin.connect();let pending,observed=false;
 try{await lock.query('BEGIN');await lock.query('SELECT command_id FROM gpt02_private.approvals WHERE command_id=$1 FOR UPDATE',[x.approval.claims.commandId]);
 pending=linkedIssuer.consumeLinkedApproval(x).then(v=>({v}),error=>({error}));
 for(let i=0;i<25;i++){const r=await admin.query("SELECT count(*) FROM pg_stat_activity WHERE usename=$1 AND wait_event_type='Lock'",[ROLE.issuer]);if(Number(r.rows[0].count)>0){observed=true;break;}await wait(20);}
 assert.equal(observed,true);await wait(Math.max(0,x.operatorLink.claims.expiresAt-Date.now()+70));await lock.query('COMMIT');
 }finally{try{await lock.query('ROLLBACK');}catch{}lock.release(true);}
 const r=await pending;assert.equal(r.error?.code,'LINKED_APPROVAL_UNAVAILABLE_OR_REPLAYED');assert.equal(await count(x.approval.claims.commandId),0);
 });
 await t.test('linked receipt and identity proof cannot be edited or deleted even through owner DML',async()=>{
 for(const q of ["UPDATE gpt02_private.operator_links SET core_operator_user_id=88",'DELETE FROM gpt02_private.operator_links','TRUNCATE gpt02_private.operator_links CASCADE',"UPDATE gpt02_private.core_identity_receipts SET operator_user_id=88",'DELETE FROM gpt02_private.core_identity_receipts','TRUNCATE gpt02_private.core_identity_receipts'])await rejection(admin.query(q),'55000');
 });
 await t.test('foreign keys reject plain truncation and immutable triggers reject cascading truncation',async()=>{
 for(const table of ['receipts','operator_links']){
 await rejection(admin.query('TRUNCATE gpt02_private.'+table),'0A000');
 await rejection(admin.query('TRUNCATE gpt02_private.'+table+' CASCADE'),'55000');
 }
 assert.equal(await count(linked.approval.claims.commandId),1);
 const n=(await admin.query('SELECT count(*)::int AS n FROM gpt02_private.core_identity_receipts WHERE command_id=$1',[linked.approval.claims.commandId])).rows[0].n;assert.equal(n,1);
 });
 await t.test('accidental link table access is rejected before issuing any identity receipt',async()=>{
 const x=linkedInput();await linkedAttestor.recordLinkedApproval(x);await admin.query(`GRANT SELECT ON gpt02_private.operator_links TO ${ROLE.issuer}`);
 try{await rejection(linkedIssuer.consumeLinkedApproval(x),'DIRECT_EVIDENCE_ACCESS_OR_SCHEMA_MISSING');}finally{await admin.query(`REVOKE SELECT ON gpt02_private.operator_links FROM ${ROLE.issuer}`);}
 assert.equal(await count(x.approval.claims.commandId),0);
 });
});
