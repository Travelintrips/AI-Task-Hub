export type ExecutionProjection = {
  id: string; source: string; taskId: number | null; externalId: string;
  correlationId: string; commandId: string | null; workerId: string | null;
  assignedClientId: string | null; status: string; metadata: Record<string, unknown>;
  callbackVerified: boolean; attestationVerified: boolean; finalAckVerified: boolean;
  createdAt: Date; updatedAt: Date;
};
export type ExecutionEventProjection = {
  executionId: string; eventId: string; eventType: string;
  status: string | null; message: string | null; workerId: string | null;
  payload: Record<string, unknown>; createdAt: Date;
};
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
const safe = (value: unknown, max = 250): string | null =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max
    ? value.trim() : null;
export function sopSnapshot(value: unknown) {
  const data = object(value);
  const inner = object(data["sopSnapshot"] ?? data["operationalSop"]);
  const sop = Object.keys(inner).length ? inner : data;
  const version = safe(sop["version"], 120);
  const title = safe(sop["title"], 300);
  const steps = Array.isArray(sop["steps"])
    ? sop["steps"].filter((s): s is string => typeof s === "string" && s.length < 1500).slice(0, 5)
    : [];
  return version || title || steps.length ? { version, title, steps } : null;
}
export function projectUnifiedTimeline(jobs: ExecutionProjection[], events: ExecutionEventProjection[]) {
  const grouped = new Map<string, ExecutionEventProjection[]>();
  for (const event of events) {
    const rows = grouped.get(event.executionId) ?? [];
    rows.push(event);
    grouped.set(event.executionId, rows);
  }
  return jobs.map((job) => {
    const meta = object(job.metadata);
    const seen = new Set<string>();
    const sourceEvents = (grouped.get(job.id) ?? [])
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .filter((x) => {
        if (seen.has(x.eventId)) return false;
        seen.add(x.eventId);
        return true;
      }).slice(-80);
    const sopHistory: Array<{
      eventId: string; capturedAt: string; version: string | null;
      title: string | null; steps: string[];
    }> = [];
    const initialSop = sopSnapshot(meta);
    if (initialSop) sopHistory.push({
      eventId: "job:" + job.id, capturedAt: job.createdAt.toISOString(), ...initialSop,
    });
    const displayedEvents = sourceEvents.map((event) => {
      const snapshot = sopSnapshot(event.payload);
      if (snapshot && !sopHistory.some((s) => s.version === snapshot.version &&
          s.title === snapshot.title && s.steps.join("|") === snapshot.steps.join("|"))) {
        sopHistory.push({
          eventId: event.eventId, capturedAt: event.createdAt.toISOString(), ...snapshot,
        });
      }
      return {
        eventId: event.eventId, kind: event.eventType, status: event.status,
        message: event.message, workerId: event.workerId,
        occurredAt: event.createdAt.toISOString(), sopVersion: snapshot?.version ?? null,
      };
    });
    return {
      id: job.id, source: job.source, taskId: job.taskId, externalId: job.externalId,
      jobId: safe(meta["jobId"]) ?? null,
      commandId: safe(meta["commandId"]) ?? job.commandId,
      correlationId: safe(meta["correlationId"]) ?? job.correlationId,
      workerId: safe(meta["workerId"]) ?? job.workerId ?? job.assignedClientId,
      workerStatus: job.status,
      createdAt: job.createdAt.toISOString(), updatedAt: job.updatedAt.toISOString(),
      sopVersion: sopHistory.at(-1)?.version ?? null, sopHistory,
      ack: {
        received: sourceEvents.some((x) => x.eventType === "ACK"),
        callbackObserved: job.callbackVerified || sourceEvents.some((x) => ["COMPLETED", "FAILED"].includes(x.eventType)),
        attestationVerified: job.attestationVerified,
        finalVerified: job.finalAckVerified,
      },
      events: displayedEvents,
    };
  });
}
