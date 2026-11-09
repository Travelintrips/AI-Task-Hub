import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeBridgeLedgerEvents} from '../src/lib/bridge-ledger-event-summary.ts';
const failed={eventType:'SOURCE_EVENT',status:'FAILED',signatureVerified:false};
const wa={eventType:'WA_DIGEST',status:'queued',signatureVerified:false};
test('failed job at 100 percent remains failed with no native completion',()=>{
 const result=summarizeBridgeLedgerEvents([failed,wa],'failed',100);
 assert.equal(result.reportedProgress,100);
 assert.equal(result.reportedStatus,'failed');
 assert.equal(result.lastObservedSourceStatus,'FAILED');
 assert.equal(result.observedEventCount,2);
 assert.equal(result.sourceEventCount,1);
 assert.equal(result.signedEventCount,0);
 assert.equal(result.historyTruncated,false);
 assert.equal(result.progressProvesCompletion,false);
 assert.equal(result.nativeWorkerCompletionVerified,false);
 assert.equal(result.mayIssueGrant,false);
 assert.equal(result.mayDispatchWorker,false);
});
test('no events means no synthetic completion',()=>{
 const r=summarizeBridgeLedgerEvents([],'completed',100);
 assert.equal(r.lastObservedSourceStatus,null);
 assert.equal(r.progressProvesCompletion,false);
 assert.equal(r.nativeWorkerCompletionVerified,false);
});
test('bounded 101 rows flag truncation; a signed ledger event is not native proof',()=>{
 const rows=Array.from({length:101},(_,i)=>({eventType:i%2?'WA_DIGEST':'SOURCE_EVENT',status:'COMPLETED',signatureVerified:true}));
 const r=summarizeBridgeLedgerEvents(rows,'completed',100);
 assert.equal(r.observedEventCount,100);
 assert.equal(r.signedEventCount,100);
 assert.equal(r.historyTruncated,true);
 assert.equal(r.nativeWorkerCompletionVerified,false);
});
