/**
 * DEV AI Core / AI Task job digest for a narrow WhatsApp screen.
 * No PROD fallback. Sending is opt-in through AI_CORE_JOB_WA_* env vars.
 */
import { and, desc, eq } from "drizzle-orm";
import { aiExecutionEventsTable, aiExecutionJobsTable, db, whatsappNotificationsTable } from "@workspace/db";
import { jobWaConfig, jobWaRecipient, sendJobViaDevWaGateway } from "./ai-job-wa-gateway";
export { jobWaConfig } from "./ai-job-wa-gateway";
import { logger } from "./logger";

type Job = typeof aiExecutionJobsTable.$inferSelect;

const DONE = new Set(["completed"]);
const FAILED = new Set(["failed", "cancelled"]);
const BLOCKED = new Set(["blocked", "review_required"]);
const QUEUED = new Set(["queued", "received", "waiting_for_session"]);
const TERMINAL = new Set(["completed", "failed", "blocked", "cancelled"]);

function clean(value: string, limit: number): string {
  const oneLine = value.replace(/[\r\n\t|]+/g, " ").replace(/\s+/g, " ").trim();
  if (!oneLine) return "—";
  return oneLine.length <= limit ? oneLine : oneLine.slice(0, limit - 1).trimEnd() + "…";
}

function agentName(value: string | null): string {
  if (!value) return "—";
  const raw = value.toLowerCase();
  if (/(^|[-_\s])dell($|[-_\s])/.test(raw)) return "DELL";
  if (/(^|[-_\s])(pchp|hp)($|[-_\s])/.test(raw)) return "HP";
  if (raw.includes("travelintrips")) return "Travel";
  if (raw.includes("openclaw")) return clean(value.replace(/openclaw[-_]?/i, ""), 8);
  return clean(value, 8);
}

function statusSymbol(status: string): string {
  const s = status.toLowerCase();
  if (DONE.has(s)) return "✅";
  if (FAILED.has(s)) return "❌";
  if (BLOCKED.has(s)) return "⚠️";
  if (QUEUED.has(s)) return "⏳";
  if (s === "verifying") return "🔎";
  return "🔄";
}

function duration(job: Pick<Job, "status" | "startedAt" | "createdAt" | "completedAt">, now: Date): string {
  if (QUEUED.has(job.status.toLowerCase())) return "—";
  const from = job.startedAt ?? job.createdAt;
  const until = TERMINAL.has(job.status.toLowerCase()) && job.completedAt ? job.completedAt : now;
  const seconds = Math.max(0, Math.floor((until.getTime() - from.getTime()) / 1000));
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(seconds / 3600)}h${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}m`;
}

export function formatAiJobWhatsApp(jobs: Job[], now = new Date()): string {
  const date = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(now);
  const lines = ["📋 *JOB MONITORING AI CORE*", `_${date} WIB_`, ""];
  const shown = jobs.slice(0, 12);
  for (const job of shown) {
    const id = job.id.replace(/-/g, "").slice(0, 6).toUpperCase();
    lines.push(`${statusSymbol(job.status)} ${id} | ${clean(job.title, 12)} | ${agentName(job.workerId || job.assignedClientId)} | ${duration(job, now)}`);
  }
  if (shown.length === 0) lines.push("Belum ada job.");
  const done = shown.filter(j => DONE.has(j.status.toLowerCase())).length;
  const failed = shown.filter(j => FAILED.has(j.status.toLowerCase())).length;
  const blocked = shown.filter(j => BLOCKED.has(j.status.toLowerCase())).length;
  const queued = shown.filter(j => QUEUED.has(j.status.toLowerCase())).length;
  const active = shown.length - done - failed - blocked - queued;
  lines.push("", `Total ${shown.length} · ✅ ${done} · 🔄 ${active} · ⏳ ${queued} · ❌ ${failed} · ⚠️ ${blocked}`);
  if (jobs.length > shown.length) lines.push(`+${jobs.length - shown.length} job lainnya di AI Task`);
  return lines.join("\n");
}

/** Idempotent per execution + attempt (correlation ID) + state.
 *  Gateway acceptance is recorded as "queued", NOT as a delivered/read receipt.
 */
export async function notifyAiJobTransition(job: Job): Promise<void> {
  if (!jobWaConfig().ready) return;
  const state = job.status.toLowerCase();
  if (!(state === "completed" || state === "failed")) return;

  const eventId = `wa-job-digest:${job.id}:${job.correlationId}:${state}`;
  const [claim] = await db.insert(aiExecutionEventsTable).values({
    executionId: job.id,
    taskId: job.taskId,
    companyId: job.companyId,
    eventId,
    eventType: "WA_DIGEST",
    phase: "notification",
    status: "pending",
    message: "Job digest notification requested",
    payload: { triggerStatus: state },
  }).onConflictDoNothing({ target: aiExecutionEventsTable.eventId })
    .returning({ id: aiExecutionEventsTable.id });
  if (!claim) return;

  const recipientPhone = jobWaRecipient();
  if (!recipientPhone) return;
  const jobs = await db.select().from(aiExecutionJobsTable)
    .where(and(eq(aiExecutionJobsTable.companyId, job.companyId)))
    .orderBy(desc(aiExecutionJobsTable.createdAt)).limit(30);
  const messageText = formatAiJobWhatsApp(jobs);

  const [outbox] = await db.insert(whatsappNotificationsTable).values({
    taskId: job.taskId,
    companyId: job.companyId,
    recipientPhone,
    recipientType: "customer",
    templateName: "ai_core_job_digest",
    messageText,
    status: "pending",
  }).returning({ id: whatsappNotificationsTable.id });

  try {
    const result = await sendJobViaDevWaGateway(recipientPhone, messageText, eventId);
    await db.update(whatsappNotificationsTable).set({
      // Queued is not the same as delivered: delivery needs a sender-worker receipt.
      status: result.accepted ? "queued" : "pending",
      externalMessageId: result.messageId ?? null,
      sentAt: null,
      errorMessage: result.reason ?? null,
    }).where(eq(whatsappNotificationsTable.id, outbox.id));
    await db.update(aiExecutionEventsTable).set({
      status: result.accepted ? "queued" : "pending",
      message: result.accepted ? "DEV Gateway queued digest" : "DEV Gateway did not queue digest",
      payload: { triggerStatus: state, notificationId: outbox.id, gatewayQueued: result.accepted, retryCount: 1, lastAttemptAt: new Date().toISOString() },
    }).where(eq(aiExecutionEventsTable.id, claim.id));
    if (!result.accepted) logger.warn({ executionId: job.id, error: result.reason }, "AI job WhatsApp digest not queued");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await db.update(whatsappNotificationsTable).set({ status: "pending", errorMessage: reason })
      .where(eq(whatsappNotificationsTable.id, outbox.id));
    await db.update(aiExecutionEventsTable).set({
      status: "pending",
      message: "Gateway call deferred",
      payload: { triggerStatus: state, notificationId: outbox.id, retryCount: 1, lastAttemptAt: new Date().toISOString() },
    }).where(eq(aiExecutionEventsTable.id, claim.id));
    logger.warn({ executionId: job.id, error: reason }, "AI job WhatsApp notification failed");
  }
}
