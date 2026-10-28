/**
 * Bounded, opt-in DEV WhatsApp delivery reconciliation.
 * AI_TASK_DEV only: no PROD host fallback, no QR/session access.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { aiExecutionEventsTable, db, whatsappNotificationsTable } from "@workspace/db";
import {
  fetchJobWaDevDeliveryReceipt,
  jobWaConfig,
  jobWaRecipient,
  probeJobWaDevGateway,
  sendJobViaDevWaGateway,
} from "./ai-job-wa-gateway";
import { logger } from "./logger";

function metadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function due(payload: Record<string, unknown>, now: number): boolean {
  const attempts = Number(payload.retryCount ?? 0);
  if (attempts >= 12) return false;
  const last = typeof payload.lastAttemptAt === "string" ? Date.parse(payload.lastAttemptAt) : NaN;
  const backoff = Math.min(30 * 60_000, 60_000 * Math.pow(2, Math.min(attempts, 5)));
  return !Number.isFinite(last) || now - last >= backoff;
}

let inProgress = false;

/** Retry pending outbox messages and reconcile actual provider receipts. */
export async function reconcileAiJobWhatsAppDeliveryOnce(): Promise<{
  retried: number; confirmed: number; operational: boolean;
}> {
  if (!jobWaConfig().ready || inProgress) return { retried: 0, confirmed: 0, operational: false };
  inProgress = true;
  let retried = 0;
  let confirmed = 0;
  try {
    const readiness = await probeJobWaDevGateway();
    if (!readiness.operational) return { retried: 0, confirmed: 0, operational: false };
    const expectedRecipient = jobWaRecipient();
    if (!expectedRecipient) return { retried: 0, confirmed: 0, operational: false };
    const events = await db.select().from(aiExecutionEventsTable)
      .where(and(eq(aiExecutionEventsTable.eventType, "WA_DIGEST"), eq(aiExecutionEventsTable.status, "pending")))
      .orderBy(asc(aiExecutionEventsTable.createdAt)).limit(30);

    for (const event of events) {
      const payload = metadata(event.payload);
      if (!due(payload, Date.now())) continue;
      const notificationId = Number(payload.notificationId);
      if (!Number.isInteger(notificationId) || notificationId <= 0) continue;
      const [notification] = await db.select().from(whatsappNotificationsTable)
        .where(eq(whatsappNotificationsTable.id, notificationId)).limit(1);
      if (!notification || notification.templateName !== "ai_core_job_digest") continue;
      if (notification.recipientPhone !== expectedRecipient) {
        await db.update(aiExecutionEventsTable).set({ status: "skipped", message: "DEV recipient changed; not sending to outdated target" })
          .where(eq(aiExecutionEventsTable.id, event.id));
        await db.update(whatsappNotificationsTable).set({ status: "skipped", errorMessage: "DEV recipient changed" })
          .where(eq(whatsappNotificationsTable.id, notificationId));
        continue;
      }
      const attempts = Number(payload.retryCount ?? 0) + 1;
      const result = await sendJobViaDevWaGateway(notification.recipientPhone, notification.messageText, event.eventId);
      await db.update(whatsappNotificationsTable).set({
        status: result.accepted ? "queued" : "pending",
        externalMessageId: result.messageId ?? null,
        errorMessage: result.reason ?? null,
      }).where(eq(whatsappNotificationsTable.id, notificationId));
      await db.update(aiExecutionEventsTable).set({
        status: result.accepted ? "queued" : attempts >= 12 ? "failed" : "pending",
        message: result.accepted ? "DEV gateway queued digest" : "Retry deferred: gateway did not queue digest",
        payload: { ...payload, retryCount: attempts, lastAttemptAt: new Date().toISOString(), gatewayQueued: result.accepted },
      }).where(eq(aiExecutionEventsTable.id, event.id));
      retried++;
    }

    const outbox = await db.select().from(whatsappNotificationsTable)
      .where(and(eq(whatsappNotificationsTable.templateName, "ai_core_job_digest"),
        inArray(whatsappNotificationsTable.status, ["queued", "sent", "delivered"])))
      .orderBy(
        sql`CASE WHEN ${whatsappNotificationsTable.status} = 'queued' THEN 0 ELSE 1 END`,
        desc(whatsappNotificationsTable.createdAt),
      ).limit(30);
    for (const notification of outbox) {
      if (!notification.externalMessageId || notification.recipientPhone !== expectedRecipient) continue;
      const receipt = await fetchJobWaDevDeliveryReceipt(notification.externalMessageId);
      if (!receipt || ["queued", "processing"].includes(receipt.status)) continue;
      if (receipt.status === notification.status) continue;
      const sentAt = receipt.sentAt ? new Date(receipt.sentAt) : null;
      await db.update(whatsappNotificationsTable).set({
        status: receipt.status,
        sentAt: sentAt && !Number.isNaN(sentAt.getTime()) ? sentAt : notification.sentAt,
        errorMessage: receipt.status === "failed" ? "Gateway reported delivery failed" : null,
      }).where(eq(whatsappNotificationsTable.id, notification.id));
      confirmed++;
    }
    return { retried, confirmed, operational: true };
  } finally {
    inProgress = false;
  }
}

export function startAiJobWhatsAppDeliveryReconciliation(): void {
  if (!jobWaConfig().ready) return;
  const run = () => void reconcileAiJobWhatsAppDeliveryOnce()
    .catch(err => logger.warn({ err }, "AI Core DEV WA delivery reconciliation deferred"));
  const timer = setInterval(run, 60_000);
  timer.unref?.();
  // Avoid startup races with DB migrations: first poll at the next scheduled interval.
}
