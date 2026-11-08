import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const ui=readFileSync(new URL('../artifacts/ai-task-center/src/pages/ai-task-detail.tsx',import.meta.url),'utf8');
const api=readFileSync(new URL('../artifacts/api-server/src/routes/executions.ts',import.meta.url),'utf8');
test('assignment and lifecycle panel is on main task detail, not separate menu',()=>{
 assert.match(ui,/id="penugasan-lifecycle"/);
 assert.match(ui,/Penugasan & Lifecycle AI Core/);
 assert.match(ui,/teamMembers\.map\(member/);
 assert.match(ui,/task\.assignedTo \? "Siap mengajukan dispatch" : "Menunggu PIC"/);
});
test('GPT02 dispatch uses existing execution endpoint and explicit lifecycle guard',()=>{
 assert.match(ui,/accountAlias: "GPT02", lifecycleStart: true/);
 assert.match(ui,/apiFetch\(`\/ai-tasks\/\$\{id\}\/execution`/);
 assert.match(api,/body\.lifecycleStart === true/);
 assert.match(api,/!task\.assignedTo\?\.trim\(\)/);
 assert.match(api,/LIFECYCLE_ASSIGNMENT_OR_MODE_NOT_READY/);
});
test('UI never displays false running or executes with missing PIC',()=>{
 assert.match(ui,/!task\.assignedTo \|\| assigneeMutation\.isPending/);
 assert.match(ui,/Tidak mengubah status bisnis sebelum bukti worker tersedia/);
 assert.match(ui,/window\.confirm\(`Mulai lifecycle GPT02/);
 assert.match(ui,/onSuccess: \(_data, mode\) =>/);
});
test('existing dedup, ACK verification and uncertainty handling preserved',()=>{
 for(const proof of ['onConflictDoNothing()', 'dispatching_unconfirmed','finalAckVerified','attestationVerified','callbackVerified','scheduleExecutionTracking']) assert.ok(api.includes(proof),`missing ${proof}`);
});
