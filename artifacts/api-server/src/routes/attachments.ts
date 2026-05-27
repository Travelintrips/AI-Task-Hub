import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, taskAttachmentsTable } from "@workspace/db";
import { extractTextFromAttachment, detectDocumentType, extractDocumentFields } from "../lib/extraction";
import { runAuditForTask } from "../lib/run-audit";
import { logger } from "../lib/logger";

function triggerAudit(taskId: number | null | undefined, source: string) {
  if (!taskId || taskId <= 0) return;
  setImmediate(() => {
    runAuditForTask(taskId).catch((err) =>
      logger.error({ taskId, source, err }, "OCR-triggered audit failed"),
    );
  });
}

const router: IRouter = Router();

router.get("/attachments", async (req, res): Promise<void> => {
  const taskId = req.query.taskId ? Number(req.query.taskId) : undefined;

  const rows = taskId
    ? await db.select().from(taskAttachmentsTable).where(eq(taskAttachmentsTable.taskId, taskId))
    : await db.select().from(taskAttachmentsTable);

  res.json(rows.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })));
});

router.get("/attachments/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid attachment ID" }); return; }

  const [attachment] = await db.select().from(taskAttachmentsTable).where(eq(taskAttachmentsTable.id, id));
  if (!attachment) { res.status(404).json({ error: "Attachment not found" }); return; }

  res.json({ ...attachment, createdAt: attachment.createdAt.toISOString() });
});

router.post("/attachments/:id/extract", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid attachment ID" }); return; }

  const [attachment] = await db.select().from(taskAttachmentsTable).where(eq(taskAttachmentsTable.id, id));
  if (!attachment) { res.status(404).json({ error: "Attachment not found" }); return; }

  await db.update(taskAttachmentsTable).set({ ocrStatus: "processing" }).where(eq(taskAttachmentsTable.id, id));
  logger.info({ attachmentId: id, fileName: attachment.fileName }, "Starting text extraction");

  const result = await extractTextFromAttachment({
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    fileUrl: attachment.fileUrl,
    objectPath: attachment.objectPath,
  });

  if (!result.success) {
    const [updated] = await db
      .update(taskAttachmentsTable)
      .set({ ocrStatus: "manual_review" })
      .where(eq(taskAttachmentsTable.id, id))
      .returning();
    logger.warn({ attachmentId: id, error: result.error }, "Text extraction failed — marked for manual review");
    res.status(422).json({
      error: "Extraction failed — file marked for manual review",
      reason: result.error,
      attachment: { ...updated, createdAt: updated.createdAt.toISOString() },
    });
    return;
  }

  logger.info({ attachmentId: id }, "Text extraction succeeded — detecting type and extracting fields");

  const [detection, fieldResult] = await Promise.all([
    detectDocumentType(result.text),
    extractDocumentFields(result.text, null),
  ]);

  const documentType = detection.success ? detection.documentType : null;
  const isUnknown = documentType === "Unknown" || !detection.success;
  const extractedFields = fieldResult.success ? fieldResult.fields : null;

  const [updated] = await db
    .update(taskAttachmentsTable)
    .set({
      extractedText: result.text,
      ocrStatus: isUnknown ? "admin_review" : "done",
      documentType: documentType ?? null,
      extractedFields: extractedFields as Record<string, unknown> | null,
    })
    .where(eq(taskAttachmentsTable.id, id))
    .returning();

  logger.info({ attachmentId: id, documentType, ocrStatus: updated.ocrStatus }, "Extraction pipeline complete");
  res.json({ ...updated, createdAt: updated.createdAt.toISOString() });

  triggerAudit(updated.taskId, "single-extract");
});

router.post("/attachments/:id/detect-type", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid attachment ID" }); return; }

  const [attachment] = await db.select().from(taskAttachmentsTable).where(eq(taskAttachmentsTable.id, id));
  if (!attachment) { res.status(404).json({ error: "Attachment not found" }); return; }
  if (!attachment.extractedText) {
    res.status(422).json({ error: "No extracted text available — run /extract first" });
    return;
  }

  const detection = await detectDocumentType(attachment.extractedText);
  if (!detection.success) {
    res.status(500).json({ error: "Document type detection failed", reason: detection.error });
    return;
  }

  const isUnknown = detection.documentType === "Unknown";
  const [updated] = await db
    .update(taskAttachmentsTable)
    .set({
      documentType: detection.documentType,
      ocrStatus: isUnknown ? "admin_review" : attachment.ocrStatus,
    })
    .where(eq(taskAttachmentsTable.id, id))
    .returning();

  logger.info({ attachmentId: id, documentType: detection.documentType }, "Document type detection complete");
  res.json({ ...updated, createdAt: updated.createdAt.toISOString() });
});

router.post("/attachments/:id/extract-fields", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid attachment ID" }); return; }

  const [attachment] = await db.select().from(taskAttachmentsTable).where(eq(taskAttachmentsTable.id, id));
  if (!attachment) { res.status(404).json({ error: "Attachment not found" }); return; }
  if (!attachment.extractedText) {
    res.status(422).json({ error: "No extracted text available — run /extract first" });
    return;
  }

  logger.info({ attachmentId: id, documentType: attachment.documentType }, "Extracting document fields");

  const fieldResult = await extractDocumentFields(attachment.extractedText, attachment.documentType);
  if (!fieldResult.success) {
    res.status(500).json({ error: "Field extraction failed", reason: fieldResult.error });
    return;
  }

  const [updated] = await db
    .update(taskAttachmentsTable)
    .set({ extractedFields: fieldResult.fields as Record<string, unknown> })
    .where(eq(taskAttachmentsTable.id, id))
    .returning();

  logger.info(
    { attachmentId: id, fieldsFound: Object.values(fieldResult.fields).filter(Boolean).length },
    "Document field extraction complete",
  );
  res.json({ ...updated, createdAt: updated.createdAt.toISOString() });
});

router.post("/attachments/:id/extract/batch", async (req, res): Promise<void> => {
  const taskId = req.body?.taskId ? Number(req.body.taskId) : undefined;
  if (!taskId || isNaN(taskId)) { res.status(400).json({ error: "taskId is required" }); return; }

  const attachments = await db.select().from(taskAttachmentsTable).where(eq(taskAttachmentsTable.taskId, taskId));
  if (attachments.length === 0) { res.json({ processed: 0, results: [] }); return; }

  await db.update(taskAttachmentsTable).set({ ocrStatus: "processing" }).where(eq(taskAttachmentsTable.taskId, taskId));
  res.json({ queued: attachments.length, message: "Extraction, detection, and field extraction started" });

  setImmediate(async () => {
    for (const attachment of attachments) {
      const result = await extractTextFromAttachment({
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        fileUrl: attachment.fileUrl,
        objectPath: attachment.objectPath,
      });

      if (!result.success) {
        await db.update(taskAttachmentsTable).set({ ocrStatus: "manual_review" }).where(eq(taskAttachmentsTable.id, attachment.id));
        logger.warn({ attachmentId: attachment.id, error: result.error }, "Batch extraction failed");
        continue;
      }

      const [detection, fieldResult] = await Promise.all([
        detectDocumentType(result.text),
        extractDocumentFields(result.text, null),
      ]);

      const documentType = detection.success ? detection.documentType : null;
      const isUnknown = documentType === "Unknown" || !detection.success;
      const extractedFields = fieldResult.success ? fieldResult.fields : null;

      await db
        .update(taskAttachmentsTable)
        .set({
          extractedText: result.text,
          ocrStatus: isUnknown ? "admin_review" : "done",
          documentType: documentType ?? null,
          extractedFields: extractedFields as Record<string, unknown> | null,
        })
        .where(eq(taskAttachmentsTable.id, attachment.id));

      logger.info({ attachmentId: attachment.id, documentType }, "Batch pipeline complete");
    }

    triggerAudit(taskId, "batch-extract");
  });
});

export default router;
