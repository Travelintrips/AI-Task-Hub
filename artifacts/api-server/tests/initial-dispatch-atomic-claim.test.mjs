import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/routes/executions.ts',import.meta.url),'utf8');
const initial=source.split('const externalId = buildAiTaskExternalCommandId(companyId, taskId);').at(-1);
test('initial dispatch atomically transitions queued to dispatching before remote command',()=>{
 const claim=initial.indexOf('eq(aiExecutionJobsTable.status, "queued")');
 const remote=initial.indexOf('remote = await submitAiTaskChatGptCommand({');
 assert.ok(claim>=0&&remote>claim);
 assert.match(initial,/isNull\(aiExecutionJobsTable\.commandId\)/);
 assert.match(initial,/if \(!claimed\) \{/);
 assert.match(initial,/dispatchState: "dispatching_unconfirmed"/);
});
