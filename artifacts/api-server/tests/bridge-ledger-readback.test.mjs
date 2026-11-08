import {bridgeLedgerReadbackAllowed} from "../src/lib/bridge-ledger-readback-policy.ts";
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('../src/routes/executions.ts',import.meta.url),'utf8');
const start=code.indexOf('router.get("/bridge/jobs/by-external-id/:externalId"');
const end=code.indexOf('// AI Core -> AI Task passive ledger registration.',start);
const route=code.slice(start,end);
test('bridge readback route requires the existing token guard and exact command external ID',()=>{
 assert.ok(start>=0&&end>start);
 assert.match(route,/requireBridgeToken/);
 assert.match(route,/bridgeLedgerReadbackAllowed\(process\.env\)/);
 assert.match(route,/bridge-command:/);
 assert.match(route,/res\.status\(400\)/);
});
test('only AI_CORE plus exact externalId may be read; 404 is explicit',()=>{
 assert.match(route,/eq\(aiExecutionJobsTable\.source, "AI_CORE"\)/);
 assert.match(route,/eq\(aiExecutionJobsTable\.externalId, externalId\)/);
 assert.match(route,/eq\(aiExecutionJobsTable\.companyId, "default"\)/);
 assert.match(route,/passiveLedger' = 'true'/);

 assert.match(route,/res\.status\(404\)/);
 assert.match(route,/safeSourceTimelineMetadata\(job\.metadata\)/);
});
test('response is non-authorizing and does not mutate data or invoke a worker',()=>{
 assert.match(route,/Cache-Control", "no-store"/);
 assert.match(route,/mayIssueGrant: false, mayDispatchWorker: false/);
 assert.match(route,/verifiedExecution: false/);
 assert.doesNotMatch(route,/db\.insert\(|db\.delete\(|db\.update\(|fetch\(|submitAiTaskCommand\(/);
});

test('runtime DEV policy accepts existing container shape and denies PROD, mismatch and unenabled flag',()=>{
 const dev={NODE_ENV:'development',AI_TASK_BRIDGE_READBACK_ENABLED:'true'};
 assert.equal(bridgeLedgerReadbackAllowed(dev),true);
 assert.equal(bridgeLedgerReadbackAllowed({...dev,APP_ENV:'development'}),true);
 for(const patch of [{NODE_ENV:'production'},{NODE_ENV:'test'},
  {APP_ENV:'production'},{APP_ENV:'staging'},
  {AI_TASK_BRIDGE_READBACK_ENABLED:'false'},{AI_TASK_BRIDGE_READBACK_ENABLED:''}]){
   assert.equal(bridgeLedgerReadbackAllowed({...dev,...patch}),false);
 }
 assert.equal(bridgeLedgerReadbackAllowed({NODE_ENV:'development'}),false);
});
