import { eq } from "drizzle-orm";
import { db, taskAttachmentsTable, documentAuditsTable, activityTable, adminNotificationsTable } from "@workspace/db";
import { runImportAuditChecks, runCrossDocumentValidation, generateAuditNarrative, buildAuditResult } from "./audit";
import { logTimeline } from "./timeline";
import { logger } from "./logger";
import { emitSseEvent } from "./sse";

export async function runAuditForTask(taskId: number): Promise<typeof documentAuditsTable.$inferSelect> {
  const attachments = await db
    .select()
    .from(taskAttachmentsTable)
    .where(eq(taskAttachmentsTable.taskId, taskId));

  logger.info({ taskId, attachmentCount: attachments.length }, "Running audit for task");

  const checks = runImportAuditChecks(attachments);
  const crossChecks = runCrossDocumentValidation(attachments);
  const narrative = await generateAuditNarrative(checks, crossChecks);
  const result = buildAuditResult(checks, crossChecks, narrative);

  const [audit] = await db
    .insert(documentAuditsTable)
    .values({
      taskId,
      auditStatus: result.auditStatus,
      completeFields: result.completeFields,
      missingFields: result.missingFields,
      mismatchFields: result.mismatchFields,
      unclearFields: result.unclearFields,
      recommendation: result.recommendation,
      nextAction: result.nextAction,
      auditDetail: result.auditDetail as unknown as Record<string, unknown>[],
      crossDocDetail: result.crossDocDetail as unknown as Record<string, unknown>[],
      crossDocWarnings: result.crossDocWarnings,
    })
    .returning();

  await db.insert(activityTable).values({
    type: "task_updated",
    description: `Document audit run for task ${taskId} — status: ${audit.auditStatus}`,
    entityId: taskId,
  });

  await logTimeline({
    taskId,
    eventType: "audit_completed",
    title: `Audit dokumen selesai — ${audit.auditStatus}`,
    actorType: "ai",
    metadata: {
      auditStatus: audit.auditStatus,
      missingCount: Array.isArray(audit.missingFields) ? (audit.missingFields as string[]).length : 0,
    },
  });

  // ── Write in-app notification + push SSE ────────────────────────────────────
  const statusLabel: Record<string, string> = {
    pass:    "✅ Lulus",
    warning: "⚠️ Perlu perhatian",
    fail:    "❌ Gagal",
  };
  const [notif] = await db.insert(adminNotificationsTable).values({
    companyId: "default",
    type: "audit_complete",
    title: `Audit dokumen selesai — ${statusLabel[audit.auditStatus] ?? audit.auditStatus}`,
    body: `Task #${taskId} · Missing: ${Array.isArray(audit.missingFields) ? (audit.missingFields as string[]).length : 0} · Mismatch: ${Array.isArray(audit.mismatchFields) ? (audit.mismatchFields as string[]).length : 0}`,
    taskId,
  }).returning();

  emitSseEvent(
    "audit_complete",
    {
      taskId,
      auditId:     audit.id,
      auditStatus: audit.auditStatus,
      missingCount: Array.isArray(audit.missingFields) ? (audit.missingFields as string[]).length : 0,
      notifId:     notif.id,
    },
    "default",
  );

  logger.info({ taskId, auditId: audit.id, auditStatus: audit.auditStatus }, "Audit complete");

  return audit;
}
