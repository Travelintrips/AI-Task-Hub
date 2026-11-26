import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateGpt02ExecutionOutcome as evaluate} from '../src/lib/gpt02-execution-outcome.ts';
import {evaluateGpt02LineageEvidence as strict} from '../src/lib/gpt02-lineage-gate.ts';
const good={task_id:136,task_status:'new_inquiry',assigned_to_id:5,verified_pic_id:5,
 execution_id:'609603dc-b8db-4836-a868-65507820ce94',command_id:'1c13c0aa-2490-40d0-9d04-559bfde7743e',execution_status:'completed',core_status:'COMPLETED',
 callback_verified:true,attestation_verified:true,final_ack_verified:true,core_command_found:true,
 core_task_id:null,core_task_found:false,claim_id:null,nonce:null,verified_completed_responses:1,
 direct_wake_route:true,transport_context_matched:true,completed_response_count:1,exact_native_response_count:1,
 completion_response_id:'67f139cf-3642-4855-90ec-d73d8c02895a',completion_acknowledged_at:'2026-11-09 15:57:10.594+00'};
test('completed delivery is distinct from missing lifecycle and never grants authority',()=>{
 const r=evaluate(good),l=strict(good);assert.equal(r.verified,true);assert.equal(r.grantsAuthority,false);assert.equal(r.readOnly,true);assert.equal(r.signatureReverifiedByThisRead,false);
 assert.deepEqual(l.diagnosticReasons,['CORE_TASK_ID_MISSING','IMMUTABLE_ATTEMPT_BINDING_MISSING','ATTESTATION_NONCE_MISSING']);
 for(const k of ['dispatchPermitted','resumePermitted','completionPermitted','operatorApprovalGranted','nativeLineageAttested'])assert.equal(l[k],false);
});
for(const [name,change] of Object.entries({missingContext:{transport_context_matched:null},wrongTenantOrCorrelation:{transport_context_matched:false},wrongRoute:{direct_wake_route:false},missingCallback:{callback_verified:false},missingAttestation:{attestation_verified:false},missingAck:{final_ack_verified:false},processing:{core_status:'PROCESSING'},failedTask135:{task_id:135,execution_status:'failed',core_status:'FAILED',completed_response_count:0,exact_native_response_count:0},duplicateCompleted:{completed_response_count:2},missingReceipt:{exact_native_response_count:0},ambiguousReceipt:{exact_native_response_count:2},stringCount:{exact_native_response_count:'1'},missingId:{completion_response_id:null},invalidAck:{completion_acknowledged_at:'not a timestamp'},missingExecution:{execution_id:null}}))
 test(`deny outcome on ${name}`,()=>{const r=evaluate({...good,...change});assert.equal(r.verified,false);assert.equal(r.responseId,null);assert.equal(r.grantsAuthority,false);});
test('absent evidence is never success',()=>{assert.equal(evaluate({}).verified,false);});
test('route keeps tenant/authentication guards, original gate and adds no write or dispatch',()=>{
 const s=readFileSync(new URL('../src/routes/executions.ts',import.meta.url),'utf8'),a=s.indexOf('router.get("/ai-tasks/:id/gpt02-lineage"'),route=s.slice(a,s.indexOf('\nexport default router;',a));
 for(const x of ['requireAuth','SUPER_ADMIN_REQUIRED','t.company_id=${companyId}','evaluateGpt02LineageEvidence','evaluateGpt02ExecutionOutcome','r.command_id=c.id',"r.metadata_json->'attestation'->>'challenge'=c.metadata_json->>'assistantAttestationChallenge'",'count','LIMIT 2'])assert.ok(route.toLowerCase().includes(x.toLowerCase()),x);
 assert.doesNotMatch(route,/db\.(?:insert|update|delete)\(|submitAiTask|queueDevBrowserWake|scheduleExecution/);
});
test('UI separates historical result from lifecycle and retains diagnostic reasons',()=>{
 const s=readFileSync(new URL('../../ai-task-center/src/pages/ai-task-detail.tsx',import.meta.url),'utf8');
 for(const x of ['Hasil eksekusi:','Pencatatan lifecycle — NO-GO:','gpt02Lineage.diagnosticReasons','executionOutcome?.verified === true','bukan Core coding task','tidak memberi izin menjalankan ulang'])assert.ok(s.includes(x),x);
});
