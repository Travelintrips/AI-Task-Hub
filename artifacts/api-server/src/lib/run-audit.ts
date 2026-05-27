import { eq } from "drizzle-orm";
import { db, taskAttachmentsTable, documentAuditsTable, activityTable } from "@workspace/db";
import { runImportAuditChecks, runCrossDocumentValidation, generateAuditNarrative, buildAuditResult } from "./audit";
import { logger } from "./logger";

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

  logger.info({ taskId, auditId: audit.id, auditStatus: audit.auditStatus }, "Audit complete");

  return audit;
}
