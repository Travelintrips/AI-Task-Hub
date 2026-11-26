import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/routes/executions.ts',import.meta.url),'utf8');
for(const [name,start,end] of [['automatic','async function recoverVerifiedSopContinuations','const automaticContinuationTimer'],['manual','router.post("/ai-tasks/:id/continue"','router.post("/ai-tasks/:id/execution"']]){
 test(`${name} continuation claims before dispatch and retains uncertain response`,()=>{
  const offset=source.indexOf(start);assert.ok(offset>=0);const stop=source.indexOf(end,offset);const part=source.slice(offset,stop>offset?stop:undefined);
  const claim=part.indexOf('eq(aiExecutionJobsTable.status, "queued")');const dispatch=part.indexOf('await submitAiTaskChatGptCommand(');
  assert.ok(claim>=0&&dispatch>claim);assert.match(part,/isNull\(aiExecutionJobsTable\.commandId\)/);
  const error=part.indexOf('AI_CORE_DISPATCH_OUTCOME_UNCONFIRMED');assert.ok(error>dispatch);
  assert.doesNotMatch(part.slice(dispatch,error+300),/markWaitingForAccountSession\(/);
 });
}
