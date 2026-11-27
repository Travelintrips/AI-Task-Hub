import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {automaticDevPingSyncSince, canonicalDevPingId, scopedDevLedgerRecoveryCommand, AUTO_DEV_PING_EVIDENCE_SQL} from '../../artifacts/api-server/src/lib/dev-passive-ledger-recovery.ts';
import {DEV_BRIDGE_SOURCE_GAP_SQL,projectDevBridgeSourceGap,unavailableDevBridgeSourceGap} from '../../artifacts/api-server/src/lib/dev-bridge-source-gap.ts';
const id="11111111-1111-4111-8111-111111111111",host="dev-ai-task.cstlogistic.co.id",project="xssrfshdrtdfupgqwfdw",since="2026-11-28T01:00:00.000Z";
const env={NODE_ENV:"development",PUBLIC_APP_BASE_URL:"https://"+host,SUPABASE_URL_DEV:"https://"+project+".supabase.co",RUN_STARTUP_MIGRATIONS:"false",SUPABASE_DATABASE_URL_DEV:"postgresql://fixture."+project+":fixture@aws-1.pooler.supabase.com/postgres",AI_TASK_DEV_PASSIVE_PING_SYNC_SINCE:since};
const row={command_id:id,source_status:"COMPLETED",category:"HANDSHAKE",created_at:"2026-11-27T10:00:00Z",source_ack_recorded:false,total_count:1};
test("permanent lane is opt-in, post-recovery cutoff, exact DEV only and incompatible with one-command pin",()=>{
 assert.equal(automaticDevPingSyncSince(env,host),since);
 for(const patch of [{AI_TASK_DEV_PASSIVE_PING_SYNC_SINCE:undefined},{AI_TASK_DEV_PASSIVE_PING_SYNC_SINCE:"2026-11-27T17:54:14.000Z"},{AI_TASK_DEV_PASSIVE_PING_SYNC_SINCE:"2026-02-30T00:00:00.000Z"},{AI_TASK_DEV_PASSIVE_PING_SYNC_SINCE:"yesterday"},{NODE_ENV:"production"},{APP_ENV:"production"},{DATABASE_URL:"other"},{AI_TASK_DEV_PASSIVE_LEDGER_RECOVERY_COMMAND_ID:id}])assert.equal(automaticDevPingSyncSince({...env,...patch},host),null);
 assert.equal(automaticDevPingSyncSince(env,"localhost"),null);
 assert.equal(scopedDevLedgerRecoveryCommand(env,host),null);
});
test("canonical IDs are not arbitrary user strings or task IDs",()=>{
 assert.equal(canonicalDevPingId("bridge-command:"+id),id);
 for(const x of [id,"coding-task:"+id,"bridge-command:"+id+"/source-event",null,{}])assert.equal(canonicalDevPingId(x),null);
});
test("automatic evidence restricts source, cutoff, known local ping and terminal source ACK",()=>{
 for(const part of ["c.created_at >= $2::timestamptz","c.source='ai-task-hub'","c.instruction='ping'","'role-scoped'","'tools:bounded'","r.acknowledged_at IS NOT NULL","jsonb_object_keys(c.metadata_json)","'wakeBinding'","'DASHBOARD_ARCHIVED'"])assert.ok(AUTO_DEV_PING_EVIDENCE_SQL.includes(part),part);
 assert.doesNotMatch(AUTO_DEV_PING_EVIDENCE_SQL,/\b(?:INSERT|UPDATE|DELETE|GRANT|ALTER)\b/i);
});
test("gap returns only bounded safe source observations, never fake registry IDs or ACK",()=>{
 const gap=projectDevBridgeSourceGap([{...row,message:"private",metadata_json:{secret:"fixture"}}]);
 assert.equal(gap.status,"AVAILABLE");assert.equal(gap.total,1);
 assert.deepEqual(gap.rows,[{commandId:id,sourceStatus:"COMPLETED",createdAt:"2026-11-27T10:00:00.000Z",category:"HANDSHAKE",sourceAckRecorded:false}]);
 assert.equal(projectDevBridgeSourceGap([]).total,0);
 assert.doesNotMatch(JSON.stringify(gap),/private|secret|result_verified_at|callback_id/);
});
test("invalid coverage fails closed rather than reporting zero",()=>{
 for(const patch of [{command_id:"invalid"},{source_status:"E2E_PASS"},{category:"sensitive data"},{created_at:"invalid"},{source_ack_recorded:"true"},{total_count:2}])assert.deepEqual(projectDevBridgeSourceGap([{...row,...patch}]),unavailableDevBridgeSourceGap());
 assert.deepEqual(projectDevBridgeSourceGap([{...row,total_count:2},{...row,total_count:2}]),unavailableDevBridgeSourceGap());
});
test("coverage scans source gaps without writes and excludes already registered or archived identities",()=>{
 assert.match(DEV_BRIDGE_SOURCE_GAP_SQL,/NOT EXISTS \(SELECT 1 FROM ai_task_bridge.jobs j/);
 assert.match(DEV_BRIDGE_SOURCE_GAP_SQL,/interval '14 days'/);
 assert.match(DEV_BRIDGE_SOURCE_GAP_SQL,/LIMIT 100/);
 assert.match(DEV_BRIDGE_SOURCE_GAP_SQL,/count\(\*\)=1/);
 assert.doesNotMatch(DEV_BRIDGE_SOURCE_GAP_SQL,/\b(?:INSERT|UPDATE|DELETE|GRANT|ALTER)\b/i);
 assert.doesNotMatch(DEV_BRIDGE_SOURCE_GAP_SQL,/c\.instruction|r\.message/);
});
test("only authenticated passive aliases added; auto receiver rechecks strict proof before ACK",()=>{
 const route=readFileSync(new URL("../../artifacts/api-server/src/routes/job-bridge.ts",import.meta.url),"utf8");
 const verifier=readFileSync(new URL("../../artifacts/api-server/src/lib/ai-core-source-verifier.ts",import.meta.url),"utf8");
 assert.match(route,/router.post\("\/bridge\/dev-passive-sync\/jobs", requireBridge, registerBridgeJob\("automatic"\)\)/);
 assert.match(route,/router.post\("\/bridge\/dev-passive-sync\/jobs\/:id\/source-event", requireBridge, observeBridgeSourceEvent\("automatic"\)\)/);
 assert.match(route,/verifyAndAckAiCoreSource\(id,callbackToVerify,\{commandId:pinned,since:autoSince\}\)/);
 assert.ok(verifier.indexOf("AUTO_DEV_PING_EVIDENCE_SQL, [automaticPing.commandId")<verifier.indexOf("INSERT INTO ai_task_bridge.job_events"));
 assert.match(route,/router.get\("\/bridge\/admin\/jobs", \.\.\.adminOnly/);
});
test("dashboard and registry show gap separately from persisted counters and actions",()=>{
 const read=p=>readFileSync(new URL("../../artifacts/ai-task-center/src/"+p,import.meta.url),"utf8");
 const ui=read("components/bridge-source-gap.tsx"),dash=read("pages/unified-dashboard.tsx"),registry=read("pages/bridge-jobs.tsx");
 assert.match(dash,/BridgeSourceGap gap=\{bridge.data\?\.sourceSyncGap\}/);
 assert.match(registry,/BridgeSourceGap gap=\{jobs.data\?\.sourceSyncGap\} detail/);
 assert.match(ui,/Status sumber/);assert.match(ui,/Belum tercatat/);
 assert.doesNotMatch(ui,/fetch\(|method:|checkbox|onClick=|result_verified_at/);
});
