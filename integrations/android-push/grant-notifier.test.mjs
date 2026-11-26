import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGrantedJobNotifier } from './grant-notifier.mjs';

const id='e9203104-0938-4f58-9fea-0872b37e12d8';
const row={id,source:'OPENCLAW',status:'QUEUED',source_session_id:'android-dev:zfold4-paired-dev-04'};
const registry={'zfold4-paired-dev-04':{active:true,pushToken:'token_for_dev_1234567890'}};
const grants={[id]:{deviceId:'zfold4-paired-dev-04',active:true,expiresAt:100000}};
test('notifies only matching active DEV device and grant',async()=>{
 const sends=[];const notify=makeGrantedJobNotifier({sendPush:async v=>sends.push(v),now:()=>1000});
 assert.equal((await notify({rows:[row],registry,grants})).sent,1);
 assert.equal((await notify({rows:[row],registry,grants})).deduplicated,1);
 assert.equal(sends.length,1);
});
test('no token, expired grant and mismatched target cannot deliver',async()=>{
 const sends=[];const notify=makeGrantedJobNotifier({sendPush:async v=>sends.push(v),now:()=>1000});
 assert.equal((await notify({rows:[row],registry:{'zfold4-paired-dev-04':{active:true}},grants})).missingToken,1);
 assert.equal((await notify({rows:[row],registry,grants:{[id]:{...grants[id],expiresAt:1}}})).sent,0);
 assert.equal((await notify({rows:[row],registry,grants:{[id]:{...grants[id],deviceId:'other'}}})).sent,0);
 assert.equal((await notify({rows:[{...row,source_session_id:'android-prod:zfold4-paired-dev-04'}],registry,grants})).sent,0);
 assert.equal(sends.length,0);
});
test('failed transport remains retryable',async()=>{
 let i=0;const notify=makeGrantedJobNotifier({sendPush:async()=>{if(++i===1)throw Error('offline')},now:()=>1000});
 assert.equal((await notify({rows:[row],registry,grants})).failed,1);
 assert.equal((await notify({rows:[row],registry,grants})).sent,1);
});
