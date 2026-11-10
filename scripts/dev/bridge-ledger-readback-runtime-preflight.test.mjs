import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluateBridgeReadbackRuntime} from './bridge-ledger-readback-runtime-preflight.mjs';
test('undeployed readback stays blocked even with healthy DEV container',()=>{
 const report=evaluateBridgeReadbackRuntime({image:'ai-task-hub:healthy-old-dev',enabled:false,routeInstalled:false});
 assert.equal(report.status,'BLOCKED');
 assert.equal(report.releaseDecision,'NO_GO');
 assert.deepEqual([report.mayDispatchWorker,report.mayIssueGrant,report.actualReadbackVerified],[false,false,false]);
});
test('route deployed but flag disabled remains blocked',()=>{
 assert.equal(evaluateBridgeReadbackRuntime({image:'dev',routeInstalled:true,enabled:false}).status,'BLOCKED');
});
test('deployment-ready is not execution or actual readback verified',()=>{
 const report=evaluateBridgeReadbackRuntime({image:'dev',routeInstalled:true,enabled:true});
 assert.equal(report.status,'READY_FOR_AUTHENTICATED_READBACK_DRILL');
 assert.equal(report.actualReadbackVerified,false);
 assert.equal(report.releaseDecision,'NO_GO');
});
test('unavailable docker inventory cannot be a PASS',()=>{
 const report=evaluateBridgeReadbackRuntime({});
 assert.equal(report.status,'BLOCKED');
 assert.equal(report.checks.filter(x=>x.ok).length,0);
});
