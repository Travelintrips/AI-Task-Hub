/** Diagnostic-only projection of a bounded private ledger event snapshot.
 * Never infer native GPT02 completion from a progress counter or event flags.
 */
type EventRow = {eventType:string|null;status:string|null;signatureVerified:boolean};
export function summarizeBridgeLedgerEvents(rows:readonly EventRow[],status:string,progress:number){
 const capped=rows.slice(0,100);
 const truncated=rows.length>100;
 return {
  observedEventCount:capped.length,
  historyTruncated:truncated,
  sourceEventCount:capped.filter(e=>e.eventType==='SOURCE_EVENT').length,
  signedEventCount:capped.filter(e=>e.signatureVerified===true).length,
  lastObservedSourceStatus:[...capped].reverse().find(e=>e.eventType==='SOURCE_EVENT')?.status??null,
  reportedProgress:progress,
  reportedStatus:status,
  progressProvesCompletion:false as const,
  nativeWorkerCompletionVerified:false as const,
  // Individual signed event flags are not independently checked GPT02 attestations.
  mayIssueGrant:false as const,mayDispatchWorker:false as const,
 };
}
