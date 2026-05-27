import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, taskAttachmentsTable } from "@workspace/db";
import { extractTextFromAttachment, detectDocumentType } from "../lib/extraction";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/attachments", async (req, res): Promise<void> => {
  const taskId = req.query.taskId ? Number(req.query.taskId) : undefined;

  const rows = taskId
    ? await db
        .select()
        .from(taskAttachmentsTable)
        .where(eq(taskAttachmentsTable.taskId, taskId))
    : await db.select().from(taskAttachmentsTable);

  res.json(
    rows.map((a) => ({
      ...a,
      createdAt: a.createdAt.toISOString(),
    })),
  );
});

router.get("/attachments/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid attachment ID" });
    return;
  }

  const [attachment] = await db
    .select()
    .from(taskAttachmentsTable)
    .where(eq(taskAttachmentsTable.id, id));

  if (!attachment) {
    res.status(404).json({ error: "Attachment not found" });
    return;
  }

  res.json({ ...attachment, createdAt: attachment.createdAt.toISOString() });
});

router.post("/attachments/:id/extract", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid attachment ID" });
    return;
  }

  const [attachment] = await db
    .select()
    .from(taskAttachmentsTable)
    .where(eq(taskAttachmentsTable.id, id));

  if (!attachment) {
    res.status(404).json({ error: "Attachment not found" });
    return;
  }

  await db
    .update(taskAttachmentsTable)
    .set({ ocrStatus: "processing" })
    .where(eq(taskAttachmentsTable.id, id));

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

  logger.info({ attachmentId: id }, "Text extraction succeeded, detecting document type");

  const detection = await detectDocumentType(result.text);
  const documentType = detection.success ? detection.documentType : null;
  const isUnknown = documentType === "Unknown" || !detection.success;

  const [updated] = await db
    .update(taskAttachmentsTable)
    .set({
      extractedText: result.text,
      ocrStatus: isUnknown ? "admin_review" : "done",
      documentType: documentType ?? null,
    })
    .where(eq(taskAttachmentsTable.id, id))
    .returning();

  logger.info(
    { attachmentId: id, documentType, ocrStatus: updated.ocrStatus },
    "Extraction and detection complete",
  );

  res.json({ ...updated, createdAt: updated.createdAt.toISOString() });
});

router.post("/attachments/:id/detect-type", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid attachment ID" });
    return;
  }

  const [attachment] = await db
    .select()
    .from(taskAttachmentsTable)
    .where(eq(taskAttachmentsTable.id, id));

  if (!attachment) {
    res.status(404).json({ error: "Attachment not found" });
    return;
  }

  if (!attachment.extractedText) {
    res.status(422).json({ error: "No extracted text available — run /extract first" });
    return;
  }

  logger.info({ attachmentId: id }, "Detecting document type");

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

  logger.info(
    { attachmentId: id, documentType: detection.documentType, markedAdminReview: isUnknown },
    "Document type detection complete",
  );

  res.json({ ...updated, createdAt: updated.createdAt.toISOString() });
});

router.post("/attachments/:id/extract/batch", async (req, res): Promise<void> => {
  const taskId = req.body?.taskId ? Number(req.body.taskId) : undefined;
  if (!taskId || isNaN(taskId)) {
    res.status(400).json({ error: "taskId is required" });
    return;
  }

  const attachments = await db
    .select()
    .from(taskAttachmentsTable)
    .where(eq(taskAttachmentsTable.taskId, taskId));

  if (attachments.length === 0) {
    res.json({ processed: 0, results: [] });
    return;
  }

  await db
    .update(taskAttachmentsTable)
    .set({ ocrStatus: "processing" })
    .where(eq(taskAttachmentsTable.taskId, taskId));

  res.json({ queued: attachments.length, message: "Extraction and detection started for all attachments" });

  setImmediate(async () => {
    for (const attachment of attachments) {
      const result = await extractTextFromAttachment({
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        fileUrl: attachment.fileUrl,
        objectPath: attachment.objectPath,
      });

      if (!result.success) {
        await db
          .update(taskAttachmentsTable)
          .set({ ocrStatus: "manual_review" })
          .where(eq(taskAttachmentsTable.id, attachment.id));
        logger.warn({ attachmentId: attachment.id, error: result.error }, "Batch extraction failed");
        continue;
      }

      const detection = await detectDocumentType(result.text);
      const documentType = detection.success ? detection.documentType : null;
      const isUnknown = documentType === "Unknown" || !detection.success;

      await db
        .update(taskAttachmentsTable)
        .set({
          extractedText: result.text,
          ocrStatus: isUnknown ? "admin_review" : "done",
          documentType: documentType ?? null,
        })
        .where(eq(taskAttachmentsTable.id, attachment.id));

      logger.info({ attachmentId: attachment.id, documentType }, "Batch extraction and detection complete");
    }
  });
});

export default router;
