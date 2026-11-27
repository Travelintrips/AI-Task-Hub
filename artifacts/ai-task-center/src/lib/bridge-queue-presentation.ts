/** Only the server's canonical source classification can remove a queued row
 * from execution counts. Missing/unknown evidence conservatively stays queued. */
export type BridgeQueueRecord = {
  source: string;
  status: string;
  queue_classification?: string | null;
};
export type PassiveEventClassification = "AVAILABLE" | "UNAVAILABLE";
export function isPassiveBridgeEvent(job: BridgeQueueRecord): boolean {
  return job.source === "AI_CORE" && job.status === "QUEUED" &&
    job.queue_classification === "PASSIVE_EVENT";
}
export function isExecutionQueued(job: BridgeQueueRecord): boolean {
  return ["QUEUED", "WAITING_FOR_WORKER"].includes(job.status) && !isPassiveBridgeEvent(job);
}
