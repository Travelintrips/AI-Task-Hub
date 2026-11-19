import test from 'node:test';
import assert from 'node:assert/strict';
import {assessLocalRelockGate} from './gpt02-preparer-relock-host-gate.mjs';

const preparer={LoadState:'loaded',ActiveState:'inactive',RefuseManualStart:'yes'};
const relock={LoadState:'loaded',ActiveState:'inactive'};
const timer={LoadState:'loaded',ActiveState:'active',UnitFileState:'enabled',NextElapseUSecRealtime:'Fri 2026-11-20 03:00:00 WIB'};
test('missing Task183 relock is NO-GO even with locked preparer',()=>{
 const r=assessLocalRelockGate({preparer,relock:{LoadState:'not-found'},timer:{LoadState:'not-found'}});
 assert.equal(r.hostControls,'BLOCKED');
 assert.equal(r.hostedRoleUnlockPermitted,false);
 assert.ok(r.reasons.includes('TASK183_INDEPENDENT_RELOCK_SERVICE_ABSENT'));
 assert.ok(r.reasons.includes('TASK183_INDEPENDENT_RELOCK_TIMER_ABSENT'));
});
test('disabled timer cannot be mistaken for an independent watchdog',()=>{
 const r=assessLocalRelockGate({preparer,relock,timer:{...timer,ActiveState:'inactive',UnitFileState:'disabled',NextElapseUSecRealtime:''}});
 assert.equal(r.hostControls,'BLOCKED');
 assert.ok(r.reasons.includes('TASK183_RELOCK_TIMER_NOT_ACTIVE'));
 assert.ok(r.reasons.includes('TASK183_RELOCK_NEXT_RUN_NOT_PROVEN'));
});
test('existing issue159 auditor is not automatically trusted for Task183 relock',()=>{
 const r=assessLocalRelockGate({preparer,relock:{LoadState:'not-found'},timer:{LoadState:'not-found'}});
 assert.notEqual(r.hostControls,'METADATA_PRESENT_UNATTESTED');
 assert.equal(r.corePreparationPermitted,false);
});
test('apparent host readiness never authorizes hosted role unlock or dispatch',()=>{
 const r=assessLocalRelockGate({preparer,relock,timer});
 assert.equal(r.hostControls,'METADATA_PRESENT_UNATTESTED');
 assert.equal(r.hostedRoleUnlockPermitted,false);
 assert.equal(r.dispatchPermitted,false);
 assert.match(r.note,/not database authority attestation/);
});
test('preparer manual start unexpectedly allowed is a release blocker',()=>{
 const r=assessLocalRelockGate({preparer:{...preparer,RefuseManualStart:'no'},relock,timer});
 assert.ok(r.reasons.includes('PREPARER_MANUAL_START_MUST_BE_DENIED'));
 assert.equal(r.hostedRoleUnlockPermitted,false);
});
