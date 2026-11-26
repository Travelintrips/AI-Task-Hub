import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../src/routes/executions.ts',import.meta.url),'utf8');
const initial=src.split('const remoteCommandId: string =')[1].split('const [failed] = await db.update(aiExecutionJobsTable)')[0];
test('initial GPT02 uncertain dispatch remains fail closed',()=>{
 assert.match(initial,/if \(mode === "chatgpt" && isRetryableChatGptDispatchError\(message\)\)/);
 assert.match(initial,/status: "dispatching"/);
 assert.match(initial,/AI_CORE_DISPATCH_OUTCOME_UNCONFIRMED/);
 assert.match(initial,/outcomeUnconfirmed: true/);
 assert.doesNotMatch(initial,/markWaitingForAccountSession\(/);
 assert.doesNotMatch(initial,/scheduleChatGptDispatchRetry\(/);
});
