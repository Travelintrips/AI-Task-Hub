import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../src/routes/executions.ts',import.meta.url),'utf8');
const retry=source.split('async function retryChatGptDispatch(')[1].split('function scheduleChatGptDispatchRetry(')[0];
test('retry claims waiting execution atomically before dispatch',()=>{
 assert.match(retry,/eq\(aiExecutionJobsTable\.status, "waiting_for_session"\)/);
 assert.match(retry,/isNull\(aiExecutionJobsTable\.commandId\)/);
 assert.ok(retry.indexOf('if (!claimed) return')<retry.indexOf('await submitAiTaskChatGptCommand'));
});
test('uncertain retry response remains dispatching, never requeues',()=>{
 const uncertain=retry.split('AI_CORE_DISPATCH_OUTCOME_UNCONFIRMED')[1];
 assert.ok(uncertain);
 assert.doesNotMatch(uncertain,/markWaitingForAccountSession\(/);
 assert.doesNotMatch(uncertain,/scheduleChatGptDispatchRetry\(/);
 assert.match(uncertain,/stopChatGptDispatchRetry\(executionId\)/);
});
test('restart recovery selects only waiting jobs, not uncertain dispatching jobs',()=>{
 const recovery=source.split('async function recoverWaitingChatGptDispatches(')[1].split('const waitingRecoveryTimer')[0];
 assert.match(recovery,/eq\(aiExecutionJobsTable\.status, "waiting_for_session"\)/);
 assert.doesNotMatch(recovery,/"dispatching"/);
});
