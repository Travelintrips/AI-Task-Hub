import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {scopedDevLedgerRecoveryCommand,scopedDevLedgerRegistrationAllowed,scopedDevLedgerEventAllowed,SCOPED_DEV_PING_EVIDENCE_SQL} from '../../artifacts/api-server/src/lib/dev-passive-ledger-recovery.ts';
const id='11111111-1111-4111-8111-111111111111',jobId='22222222-2222-4222-8222-222222222222';
const host='dev-ai-task.cstlogistic.co.id', project='xssrfshdrtdfupgqwfdw',ext='bridge-command:'+id;
const env={NODE_ENV:'development',PUBLIC_APP_BASE_URL:'https://'+host,SUPABASE_URL_DEV:'https://'+project+'.supabase.co',RUN_STARTUP_MIGRATIONS:'false',SUPABASE_DATABASE_URL_DEV:'postgresql://fixture.'+project+':fixture@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres',AI_TASK_DEV_PASSIVE_LEDGER_RECOVERY_COMMAND_ID:id};
test('one exact DEV command opt-in; disabled, PROD and ambiguous environments fail closed',()=>{
 assert.equal(scopedDevLedgerRecoveryCommand(env,host),id);
 assert.equal(scopedDevLedgerRecoveryCommand({...env,APP_ENV:'development'},host),id);
 for(const patch of [{NODE_ENV:'production'},{APP_ENV:'production'},{APP_ENV:'staging'},{PUBLIC_APP_BASE_URL:'https://other.invalid'},{SUPABASE_URL_DEV:'https://wrong.supabase.co'},{RUN_STARTUP_MIGRATIONS:'true'},{AI_TASK_DEV_PASSIVE_LEDGER_RECOVERY_COMMAND_ID:undefined},{AI_TASK_DEV_PASSIVE_LEDGER_RECOVERY_COMMAND_ID:id+','+jobId},{SUPABASE_DATABASE_URL:'postgresql://prod.invalid'},{SUPABASE_PROD_DATABASE_URL:'postgresql://prod.invalid'},{SUPABASE_DEV_DATABASE_URL:'postgresql://alternate.invalid'},{DATABASE_URL:'postgresql://alternate.invalid'},{AI_TASK_PROD_SOURCE_RECONCILE_ENABLED:'true'}]){
  assert.equal(scopedDevLedgerRecoveryCommand({...env,...patch},host),null,JSON.stringify(patch));
 }
 assert.equal(scopedDevLedgerRecoveryCommand(env,'ai-task.cstlogistic.co.id'),null);
 assert.equal(scopedDevLedgerRecoveryCommand(env,'localhost'),null);
});
test('DB project must match an exact direct or pooler identity, not arbitrary URL text',()=>{
 assert.equal(scopedDevLedgerRecoveryCommand({...env,SUPABASE_DATABASE_URL_DEV:'postgresql://fixture:fixture@db.'+project+'.supabase.co/postgres'},host),id);
 for(const uri of ['invalid','postgresql://fixture:fixture@db.other.supabase.co/'+project,'postgresql://fixture.'+project+':fixture@pooler.supabase.com.evil.invalid/postgres','postgresql://fixture.other:fixture@aws-1.pooler.supabase.com/'+project,'https://fixture.'+project+'@aws-1.pooler.supabase.com/postgres']){
 assert.equal(scopedDevLedgerRecoveryCommand({...env,SUPABASE_DATABASE_URL_DEV:uri},host),null,uri);
 }
});
test('registration permits only exact canonical AI Core audit ID/key/title and no session',()=>{
 const v={source:'AI_CORE',externalId:ext,key:ext,title:'AI Core bridge command '+id.slice(0,8),sessionId:null};
 assert.equal(scopedDevLedgerRegistrationAllowed(id,v),true);
 for(const patch of [{source:'OPENCLAW'},{externalId:'bridge-command:'+jobId},{key:'other'},{title:'other'},{sessionId:'foreign'}])assert.equal(scopedDevLedgerRegistrationAllowed(id,{...v,...patch}),false);
});
test('event gate rejects cross-job identifiers, leases and historical/terminal conflicts',()=>{
 const v={source:'AI_CORE',externalId:ext,key:ext,owner:null,leaseToken:null,leaseUntil:null,status:'QUEUED',eventId:'ai-core:'+ext+':COMPLETED:terminal',callbackId:null,jobId};
 assert.equal(scopedDevLedgerEventAllowed(id,v),true);
 for(const status of ['WAITING_FOR_ACK','COMPLETED'])assert.equal(scopedDevLedgerEventAllowed(id,{...v,status,callbackId:'core-source:'+jobId}),true);
 for(const patch of [{source:'CHATGPT'},{externalId:'bridge-command:'+jobId},{key:'other'},{owner:'other'},{leaseToken:jobId},{leaseUntil:'future'},{status:'FAILED'},{status:'RUNNING'},{status:'WAITING_FOR_ACK'},{status:'COMPLETED',callbackId:'foreign'},{eventId:'ai-core:'+ext+':FAILED:terminal'},{eventId:'ai-core:bridge-command:'+jobId+':COMPLETED:terminal'},{callbackId:'foreign'}])assert.equal(scopedDevLedgerEventAllowed(id,{...v,...patch}),false);
});
test('canonical evidence query is read-only, pinned, terminal and model-free; no historical/wake proof is accepted',()=>{
 assert.match(SCOPED_DEV_PING_EVIDENCE_SQL,/c\.id=\$1::uuid/);
 for(const value of ["c.source='ai-task-hub'","c.instruction='ping'","c.status='COMPLETED'","c.task_id IS NULL","r.message='pong from DELL'","r.acknowledged_at IS NOT NULL","r.checkpoint_json->>'clientId'='openclaw-pc-worker-dev'","'UNKNOWN_UNVERIFIED'","'wakeBinding'","'executionJobId'","'DASHBOARD_ARCHIVED'"])assert.ok(SCOPED_DEV_PING_EVIDENCE_SQL.includes(value),value);
 assert.doesNotMatch(SCOPED_DEV_PING_EVIDENCE_SQL,/\b(?:INSERT|UPDATE|DELETE|GRANT|ALTER|FOR UPDATE)\b/i);
});
test('only two new authenticated aliases, existing handlers and source-owned ACK reused; no new dispatch route',()=>{
 const s=readFileSync(new URL('../../artifacts/api-server/src/routes/job-bridge.ts',import.meta.url),'utf8');
 assert.match(s,/router\.post\("\/bridge\/jobs", requireBridge, registerBridgeJob\(\)\)/);
 assert.match(s,/router\.post\("\/bridge\/jobs\/:id\/source-event", requireBridge, observeBridgeSourceEvent\(\)\)/);
 const aliases=[...s.matchAll(/router\.post\("(\/bridge\/dev-passive-recovery\/[^"]+)", requireBridge, (\w+)\(true\)\)/g)];
 assert.deepEqual(aliases.map(a=>[a[1],a[2]]),[['/bridge/dev-passive-recovery/jobs','registerBridgeJob'],['/bridge/dev-passive-recovery/jobs/:id/source-event','observeBridgeSourceEvent']]);
 assert.equal(s.split('SCOPED_DEV_PING_EVIDENCE_SQL, [pinned]').length-1,2);
 const handler=s.slice(s.indexOf('function observeBridgeSourceEvent'),s.indexOf('// Atomic leasing.'));
 assert.ok(handler.indexOf('FOR UPDATE')<handler.indexOf('scopedDevLedgerEventAllowed(pinned,'));
 assert.ok(handler.indexOf('SCOPED_DEV_PING_EVIDENCE_SQL, [pinned]')<handler.indexOf('SELECT job_id,id FROM'));
 assert.match(handler,/verifyAndAckAiCoreSource\(id,callbackToVerify\)/);
 assert.doesNotMatch(handler,/submitAiTaskCommand|dispatchExternalAgentWork|fetch\(/);
});
