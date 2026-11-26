import test from 'node:test';
import assert from 'node:assert/strict';
import { createSingleFlightGuard } from '../src/lib/single-flight.ts';

test('concurrent retry for same execution never overlaps', async () => {
 const guard=createSingleFlightGuard();let release;
 const pending=new Promise(resolve=>{release=resolve});let calls=0;
 const attempt=async id=>{if(!guard.enter(id))return false;try{calls++;await pending;return true;}finally{guard.leave(id)}};
 const first=attempt('job-123');
 assert.equal(await attempt('job-123'),false);
 assert.equal(calls,1);
 assert.equal(guard.enter('job-other'),true);
 guard.leave('job-other');
 release();assert.equal(await first,true);
 assert.equal(await attempt('job-123'),true);
 assert.equal(calls,2);
});
test('failure release permits retry',async()=>{
 const guard=createSingleFlightGuard();assert.equal(guard.enter('failed'),true);
 try{throw Error('simulated 429')}catch{}finally{guard.leave('failed')}
 assert.equal(guard.enter('failed'),true);guard.leave('failed');
});
