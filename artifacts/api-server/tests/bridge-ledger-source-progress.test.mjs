import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {passiveBridgeSourceProgress as project} from '../src/lib/bridge-ledger-source-progress.ts';

test('FAILED and BLOCKED never manufacture completion from terminal source events',()=>{
 for(const status of ['FAILED','BLOCKED','DEPLOYED','MERGED']){
  assert.equal(project(status,0,false),0);
  assert.equal(project(status,65,false),65);
  assert.equal(project(status,100,false),90);
 }
});
test('COMPLETED without verified final ACK stays at or below 90%',()=>{
 assert.equal(project('COMPLETED',30,false),90);
 assert.equal(project('COMPLETED',100,false),90);
 assert.equal(project('COMPLETED',90,false),90);
});
test('verified native final ACK is sole path to source-ledger 100%',()=>{
 assert.equal(project('COMPLETED',10,true),100);
 assert.equal(project('FAILED',10,false),10);
 for (const status of ['FAILED','BLOCKED','DEPLOYED','MERGED','RUNNING']) {
  assert.notEqual(project(status,10,true),100);
 }
});
test('normal source events remain bounded and invalid previous values do not grant completion',()=>{
 assert.equal(project('RUNNING',10,false),25);
 assert.equal(project('RUNNING',86,false),86);
 assert.equal(project('RUNNING',100,false),90);
 assert.equal(project('RUNNING',NaN,false),25);
});
test('bridge source-event route uses guarded projection, not terminal=100 shortcut',()=>{
 const source=readFileSync(new URL('../src/routes/executions.ts',import.meta.url),'utf8');
 const begin=source.indexOf('router.post("/bridge/jobs/:id/source-event"');
 const end=source.indexOf('router.',begin+12);
 assert.ok(begin>0&&end>begin);
 const route=source.slice(begin,end);
 assert.match(route,/passiveBridgeSourceProgress\(normalized, job\.progress, verifiedFinal\)/);
 assert.doesNotMatch(route,/terminal\s*\?\s*100/);
});
