import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const api=readFileSync(new URL('../src/routes/executions.ts',import.meta.url),'utf8');
const ui=readFileSync(new URL('../../ai-task-center/src/pages/ai-task-detail.tsx',import.meta.url),'utf8');
const start=api.indexOf('router.post("/ai-tasks/:id/execution", requireAuth');
const end=api.indexOf('// Read-only preview and readiness check.',start);
const route=api.slice(start,end);
const gate=route.indexOf('error: "GPT02_LIFECYCLE_PRE_DISPATCH_PROOF_REQUIRED"');
const transaction=route.indexOf('db.transaction(async (tx) =>');
const dispatch=route.indexOf('submitAiTaskChatGptCommand(');
const continuation=route.indexOf('scheduleExecutionTracking(');
test('DEV full lifecycle requires unavailable server-owned pre-dispatch proofs',()=>{
 assert.ok(gate>0&&transaction>gate&&dispatch>gate&&continuation>gate);
 assert.match(route,/process\.env\.NODE_ENV === "development" && process\.env\.APP_ENV !== "production"/);
 assert.match(route,/body\.lifecycleStart === true && body\.mode === "chatgpt" && body\.accountAlias === "GPT02"/);
 assert.match(route,/res\.status\(409\)/);
 assert.match(route,/dispatchNotStarted: true/);
 assert.match(route,/continuationScheduled: false/);
 assert.match(route,/Cache-Control", "no-store"/);
 assert.match(route.slice(gate,transaction),/return;/);
});
test('lifecycle cannot accept caller asserted cryptographic, issuer or nonce booleans',()=>{
 const block=route.slice(0,transaction);
 for(const x of ['body.approval','body.operatorApprovalGranted','body.issuerPermitted','body.nonceVerified','body.coreTaskId','body.bindingVerified','body.leaseValid'])assert.equal(block.includes(x),false,x);
 for(const code of ['CORE_TASK_NOT_PREPARED','SIGNED_OPERATOR_APPROVAL_MISSING','IMMUTABLE_PRE_DISPATCH_BINDING_MISSING','OPERATOR_NONCE_NOT_CONSUMED','ISSUER_LEASE_FENCING_NOT_VERIFIED'])assert.match(block,new RegExp(code));
});
test('one-shot text transport remains distinct and unmodified',()=>{
 assert.ok(route.includes('body.lifecycleStart === true'));
 assert.match(route,/let mode: "chatgpt" \| "worker"/);
 assert.match(route,/const verificationMode = mode === "chatgpt"/);
 assert.match(route,/const externalId = buildAiTaskExternalCommandId/);
 assert.match(route,/GPT02_EXISTING_ATTEMPT_REQUIRES_AUTHORIZED_RECOVERY/);
 assert.match(route,/submitAiTaskChatGptCommand\(/);
});
test('DEV lifecycle button is inert, text clearly indicates missing proof',()=>{
 const a=ui.indexOf('Mulai Lifecycle GPT02 (belum diaktifkan)');
 assert.ok(a>0);
 const b=ui.lastIndexOf('<Button',a);
 const section=ui.slice(b,a);
 assert.match(section,/disabled=\{true\}/);
 assert.doesNotMatch(section,/onClick=|startExecutionMutation\.mutate/);
 assert.match(section,/aria-label="Lifecycle GPT02 DEV belum aktif/);
 assert.match(ui,/mode lifecycle GPT02 DEV belum dapat dijalankan/i);
 assert.match(ui,/Hasil uji teks lama tidak diulang/);
});
test('previous historical outcome / strict lineage is unchanged',()=>{
 assert.match(api,/evaluateGpt02ExecutionOutcome/);
 assert.match(api,/evaluateGpt02LineageEvidence/);
 assert.match(ui,/Pencatatan lifecycle — NO-GO:/);
});
