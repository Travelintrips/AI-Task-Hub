import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { eq, desc } from "drizzle-orm";
import multer from "multer";
import {
  db,
  aiTasksTable,
  taskAttachmentsTable,
  documentAuditsTable,
  taskTimelineTable,
  intakeSessionsTable,
} from "@workspace/db";
import { validateToken, createPublicToken } from "../lib/tokens";
import { logTimeline } from "../lib/timeline";
import { runAuditForTask } from "../lib/run-audit";
import { sendWhatsAppNotification } from "../lib/whatsapp-sender";
import { getUploadUrl, ensureBucket, uploadBuffer } from "../lib/supabase";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const PAYMENT_PROOF_MAX_BYTES = 10 * 1024 * 1024;
const PAYMENT_PROOF_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);
const PAYMENT_PROOF_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".pdf"]);
const miniFormPaymentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PAYMENT_PROOF_MAX_BYTES },
});

// ─── Helper: serialize task for public response (hides adminNotes) ────────────
function publicTask(task: typeof aiTasksTable.$inferSelect) {
  const { adminNotes: _adminNotes, ...safe } = task;
  return {
    ...safe,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    dueDate: task.dueDate ? task.dueDate.toISOString() : null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN: Generate public token for a task
// POST /public/generate-token
// ═══════════════════════════════════════════════════════════════════════════════
router.post("/public/generate-token", async (req, res): Promise<void> => {
  try {
    const { taskId, tokenType, createdBy, expiresInDays } = req.body as {
      taskId: number;
      tokenType: "mini_task" | "customer_data";
      createdBy?: string;
      expiresInDays?: number;
    };

    if (!taskId || !tokenType) {
      res.status(400).json({ error: "taskId and tokenType are required" });
      return;
    }
    if (!["mini_task", "customer_data"].includes(tokenType)) {
      res.status(400).json({ error: "tokenType must be mini_task or customer_data" });
      return;
    }

    const [task] = await db.select().from(aiTasksTable).where(eq(aiTasksTable.id, taskId));
    if (!task) { res.status(404).json({ error: "Task not found" }); return; }

    const token = await createPublicToken(taskId, tokenType, createdBy, expiresInDays ?? 30);
    const baseUrl = process.env.PUBLIC_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN ?? "localhost:5173"}`;
    const path = tokenType === "mini_task" ? "mini-task" : "customer-data";
    const url = `${baseUrl}/${path}/${taskId}/${token}`;

    await logTimeline({
      taskId,
      eventType: "token_created",
      title: `Link publik dibuat (${tokenType === "mini_task" ? "Mini Task" : "Customer Data"})`,
      actor: createdBy ?? "Admin",
      actorType: "admin",
      metadata: { tokenType, url },
    });

    res.json({ token, url, expiresInDays: expiresInDays ?? 30 });
  } catch (err) {
    logger.error({ err }, "POST /public/generate-token failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// MINI TASK FORM — Team/Vendor access
// ═══════════════════════════════════════════════════════════════════════════════

// GET /public/mini-task/:taskId/:token — load task data
router.get("/public/mini-task/:taskId/:token", async (req, res): Promise<void> => {
  try {
    const taskId = parseInt(req.params.taskId, 10);
    const { token } = req.params;

    const validation = await validateToken(token, "mini_task");
    if (!validation.valid || validation.taskId !== taskId) {
      res.status(401).json({ error: validation.error ?? "Token tidak valid" });
      return;
    }

    const [task] = await db.select().from(aiTasksTable).where(eq(aiTasksTable.id, taskId));
    if (!task) { res.status(404).json({ error: "Task not found" }); return; }

    const attachments = await db
      .select()
      .from(taskAttachmentsTable)
      .where(eq(taskAttachmentsTable.taskId, taskId))
      .orderBy(desc(taskAttachmentsTable.createdAt));

    const [latestAudit] = await db
      .select()
      .from(documentAuditsTable)
      .where(eq(documentAuditsTable.taskId, taskId))
      .orderBy(desc(documentAuditsTable.createdAt))
      .limit(1);

    res.json({
      task: publicTask(task),
      attachments: attachments.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
      audit: latestAudit
        ? {
            auditStatus: latestAudit.auditStatus,
            missingFields: latestAudit.missingFields,
            recommendation: latestAudit.recommendation,
            nextAction: latestAudit.nextAction,
          }
        : null,
    });
  } catch (err) {
    logger.error({ err }, "GET /public/mini-task failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /public/mini-task/:taskId/:token — submit progress update
router.post("/public/mini-task/:taskId/:token", async (req, res): Promise<void> => {
  try {
    const taskId = parseInt(req.params.taskId, 10);
    const { token } = req.params;

    const validation = await validateToken(token, "mini_task");
    if (!validation.valid || validation.taskId !== taskId) {
      res.status(401).json({ error: validation.error ?? "Token tidak valid" });
      return;
    }

    const {
      progressNote,
      statusUpdate,
      driverName,
      driverPhone,
      plateNumber,
      quotationAmount,
      quotationNotes,
      submittedBy,
    } = req.body as {
      progressNote?: string;
      statusUpdate?: string;
      driverName?: string;
      driverPhone?: string;
      plateNumber?: string;
      quotationAmount?: string;
      quotationNotes?: string;
      submittedBy?: string;
    };

    const updates: Record<string, unknown> = {};
    if (statusUpdate) updates.status = statusUpdate;
    if (driverName) updates.driverName = driverName;
    if (driverPhone) updates.driverPhone = driverPhone;
    if (plateNumber) updates.plateNumber = plateNumber;
    if (quotationAmount) {
      updates.quotationAmount = quotationAmount;
      updates.status = "quotation_ready";
    }
    if (quotationNotes) updates.quotationNotes = quotationNotes;

    const [task] = await db
      .update(aiTasksTable)
      .set(updates)
      .where(eq(aiTasksTable.id, taskId))
      .returning();

    if (!task) { res.status(404).json({ error: "Task not found" }); return; }

    let eventTitle = "Progress diperbarui";
    let eventType: Parameters<typeof logTimeline>[0]["eventType"] = "progress_updated";

    if (statusUpdate === "in_progress") { eventTitle = "Task dimulai (In Progress)"; eventType = "status_changed"; }
    else if (statusUpdate === "completed") { eventTitle = "Task selesai"; eventType = "task_completed"; }
    else if (quotationAmount) { eventTitle = `Quotation dikirim: ${quotationAmount}`; eventType = "quotation_submitted"; }
    else if (driverName) { eventTitle = `Info trucking ditambahkan: ${driverName} / ${plateNumber}`; eventType = "trucking_info_added"; }

    await logTimeline({
      taskId,
      eventType,
      title: eventTitle,
      description: progressNote,
      actor: submittedBy ?? "Tim",
      actorType: "team",
      metadata: { statusUpdate, driverName, plateNumber, quotationAmount },
    });

    res.json({ success: true, task: publicTask(task) });
  } catch (err) {
    logger.error({ err }, "POST /public/mini-task failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /public/mini-task/:taskId/:token/upload-url — get presigned upload URL
router.post("/public/mini-task/:taskId/:token/upload-url", async (req, res): Promise<void> => {
  try {
    const taskId = parseInt(req.params.taskId, 10);
    const { token } = req.params;

    const validation = await validateToken(token, "mini_task");
    if (!validation.valid || validation.taskId !== taskId) {
      res.status(401).json({ error: validation.error ?? "Token tidak valid" });
      return;
    }

    const { filename, mimeType } = req.body as { filename: string; mimeType: string };
    if (!filename) { res.status(400).json({ error: "filename is required" }); return; }

    const result = await getUploadUrl(filename, mimeType ?? "application/octet-stream");
    res.json(result);
  } catch (err) {
    logger.error({ err }, "POST /public/mini-task/upload-url failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /public/mini-task/:taskId/:token/attachments — register uploaded file
router.post("/public/mini-task/:taskId/:token/attachments", async (req, res): Promise<void> => {
  try {
    const taskId = parseInt(req.params.taskId, 10);
    const { token } = req.params;

    const validation = await validateToken(token, "mini_task");
    if (!validation.valid || validation.taskId !== taskId) {
      res.status(401).json({ error: validation.error ?? "Token tidak valid" });
      return;
    }

    const { fileName, objectPath, mimeType, fileSize, documentType, uploadedBy } = req.body as {
      fileName: string;
      objectPath: string;
      mimeType?: string;
      fileSize?: number;
      documentType?: string;
      uploadedBy?: string;
    };

    if (!fileName || !objectPath) {
      res.status(400).json({ error: "fileName and objectPath are required" });
      return;
    }

    const fileType = mimeType?.startsWith("image/") ? "image"
      : mimeType === "application/pdf" ? "pdf"
      : "document";

    const fileUrl = `/api/storage/objects${objectPath}`;

    const [attachment] = await db
      .insert(taskAttachmentsTable)
      .values({ taskId, fileName, fileUrl, objectPath, mimeType, fileSize, fileType, documentType: documentType ?? null, ocrStatus: "pending", uploadedBy: uploadedBy ?? "team_public" })
      .returning();

    await logTimeline({
      taskId,
      eventType: "document_uploaded",
      title: `File diupload: ${fileName}`,
      actor: uploadedBy ?? "Tim",
      actorType: "team",
      metadata: { fileName, fileType },
    });

    res.status(201).json({ ...attachment, createdAt: attachment.createdAt.toISOString() });
  } catch (err) {
    logger.error({ err }, "POST /public/mini-task/attachments failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// CUSTOMER MISSING DATA FORM
// ═══════════════════════════════════════════════════════════════════════════════

// GET /public/customer-data/:taskId/:token — load missing data checklist
router.get("/public/customer-data/:taskId/:token", async (req, res): Promise<void> => {
  try {
    const taskId = parseInt(req.params.taskId, 10);
    const { token } = req.params;

    const validation = await validateToken(token, "customer_data");
    if (!validation.valid || validation.taskId !== taskId) {
      res.status(401).json({ error: validation.error ?? "Token tidak valid" });
      return;
    }

    const [task] = await db.select().from(aiTasksTable).where(eq(aiTasksTable.id, taskId));
    if (!task) { res.status(404).json({ error: "Task not found" }); return; }

    const [latestAudit] = await db
      .select()
      .from(documentAuditsTable)
      .where(eq(documentAuditsTable.taskId, taskId))
      .orderBy(desc(documentAuditsTable.createdAt))
      .limit(1);

    const safeTask = publicTask(task);

    res.json({
      task: {
        id: safeTask.id,
        taskNumber: safeTask.taskNumber,
        title: safeTask.title,
        customerName: safeTask.customerName,
        status: safeTask.status,
        missingData: safeTask.missingData,
        requiredAction: safeTask.requiredAction,
      },
      audit: latestAudit
        ? {
            auditStatus: latestAudit.auditStatus,
            missingFields: latestAudit.missingFields,
            unclearFields: latestAudit.unclearFields,
            recommendation: latestAudit.recommendation,
          }
        : null,
    });
  } catch (err) {
    logger.error({ err }, "GET /public/customer-data failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /public/customer-data/:taskId/:token — submit missing data
router.post("/public/customer-data/:taskId/:token", async (req, res): Promise<void> => {
  try {
    const taskId = parseInt(req.params.taskId, 10);
    const { token } = req.params;

    const validation = await validateToken(token, "customer_data");
    if (!validation.valid || validation.taskId !== taskId) {
      res.status(401).json({ error: validation.error ?? "Token tidak valid" });
      return;
    }

    const { fields, notes, submittedBy } = req.body as {
      fields?: Record<string, string>;
      notes?: string;
      submittedBy?: string;
    };

    const [task] = await db.select().from(aiTasksTable).where(eq(aiTasksTable.id, taskId));
    if (!task) { res.status(404).json({ error: "Task not found" }); return; }

    const customerName = submittedBy ?? task.customerName ?? "Customer";

    await logTimeline({
      taskId,
      eventType: "customer_submitted_data",
      title: "Customer mengirim data yang diminta",
      description: notes,
      actor: customerName,
      actorType: "customer",
      metadata: { fields, notes },
    });

    await db
      .update(aiTasksTable)
      .set({ status: "audit_in_progress" })
      .where(eq(aiTasksTable.id, taskId));

    // Re-run audit asynchronously
    runReauditAndNotify(taskId, task.companyId).catch((e) =>
      logger.error({ err: e, taskId }, "Re-audit after customer submit failed"),
    );

    res.json({ success: true, message: "Data berhasil dikirim. Kami akan segera memprosesnya." });
  } catch (err) {
    logger.error({ err }, "POST /public/customer-data failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /public/customer-data/:taskId/:token/upload-url
router.post("/public/customer-data/:taskId/:token/upload-url", async (req, res): Promise<void> => {
  try {
    const taskId = parseInt(req.params.taskId, 10);
    const { token } = req.params;

    const validation = await validateToken(token, "customer_data");
    if (!validation.valid || validation.taskId !== taskId) {
      res.status(401).json({ error: validation.error ?? "Token tidak valid" });
      return;
    }

    const { filename, mimeType } = req.body as { filename: string; mimeType: string };
    if (!filename) { res.status(400).json({ error: "filename is required" }); return; }

    const result = await getUploadUrl(filename, mimeType ?? "application/octet-stream");
    res.json(result);
  } catch (err) {
    logger.error({ err }, "POST /public/customer-data/upload-url failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /public/customer-data/:taskId/:token/attachments
router.post("/public/customer-data/:taskId/:token/attachments", async (req, res): Promise<void> => {
  try {
    const taskId = parseInt(req.params.taskId, 10);
    const { token } = req.params;

    const validation = await validateToken(token, "customer_data");
    if (!validation.valid || validation.taskId !== taskId) {
      res.status(401).json({ error: validation.error ?? "Token tidak valid" });
      return;
    }

    const { fileName, objectPath, mimeType, fileSize, documentType, uploadedBy } = req.body as {
      fileName: string;
      objectPath: string;
      mimeType?: string;
      fileSize?: number;
      documentType?: string;
      uploadedBy?: string;
    };

    if (!fileName || !objectPath) {
      res.status(400).json({ error: "fileName and objectPath are required" });
      return;
    }

    const fileType = mimeType?.startsWith("image/") ? "image"
      : mimeType === "application/pdf" ? "pdf"
      : "document";

    const fileUrl = `/api/storage/objects${objectPath}`;

    const [attachment] = await db
      .insert(taskAttachmentsTable)
      .values({ taskId, fileName, fileUrl, objectPath, mimeType, fileSize, fileType, documentType: documentType ?? null, ocrStatus: "pending", uploadedBy: uploadedBy ?? "customer_public" })
      .returning();

    await logTimeline({
      taskId,
      eventType: "document_uploaded",
      title: `Dokumen diupload customer: ${fileName}`,
      actor: uploadedBy ?? "Customer",
      actorType: "customer",
      metadata: { fileName, fileType },
    });

    res.status(201).json({ ...attachment, createdAt: attachment.createdAt.toISOString() });
  } catch (err) {
    logger.error({ err }, "POST /public/customer-data/attachments failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /public/task-timeline/:taskId/:token — timeline for mini-task form ───
router.get("/public/task-timeline/:taskId/:token", async (req, res): Promise<void> => {
  try {
    const taskId = parseInt(req.params.taskId, 10);
    const { token } = req.params;

    const validation = await validateToken(token, "mini_task");
    if (!validation.valid || validation.taskId !== taskId) {
      res.status(401).json({ error: validation.error ?? "Token tidak valid" });
      return;
    }

    const timeline = await db
      .select()
      .from(taskTimelineTable)
      .where(eq(taskTimelineTable.taskId, taskId))
      .orderBy(desc(taskTimelineTable.createdAt));

    res.json(timeline.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() })));
  } catch (err) {
    logger.error({ err }, "GET /public/task-timeline failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Internal: Re-audit + status update + notify admin ───────────────────────
async function runReauditAndNotify(taskId: number, companyId: string): Promise<void> {
  try {
    const audit = await runAuditForTask(taskId);

    await logTimeline({
      taskId,
      eventType: "audit_completed",
      title: `Re-audit selesai — status: ${audit.auditStatus}`,
      actorType: "ai",
      metadata: { auditStatus: audit.auditStatus, missingFields: audit.missingFields },
    });

    const noCritical =
      !audit.missingFields ||
      (Array.isArray(audit.missingFields) && (audit.missingFields as string[]).length === 0);

    if (noCritical) {
      await db
        .update(aiTasksTable)
        .set({ status: "ready_for_review" })
        .where(eq(aiTasksTable.id, taskId));

      await logTimeline({
        taskId,
        eventType: "status_changed",
        title: "Status berubah → Ready for Review",
        actorType: "system",
      });

      const [task] = await db.select().from(aiTasksTable).where(eq(aiTasksTable.id, taskId));
      if (task?.assignedTo) {
        const assignedPhone = task.assignedTo.match(/^\+?\d+$/) ? task.assignedTo : null;
        if (assignedPhone) {
          await sendWhatsAppNotification({
            to: assignedPhone,
            recipientType: "admin",
            templateName: "new_task_notification",
            variables: {
              title: `Task ${task.taskNumber ?? task.id} siap direview`,
              customerName: task.customerName ?? "-",
              category: "Ready for Review",
            },
            taskId,
            companyId,
          });
        }
      }
    } else {
      await db
        .update(aiTasksTable)
        .set({ status: "missing_data" })
        .where(eq(aiTasksTable.id, taskId));
    }
  } catch (err) {
    logger.error({ err, taskId }, "runReauditAndNotify failed");
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MINI FORM: Upload URL (tanpa token task — untuk upload file dari mini-form)
// POST /public/mini-form-upload-url
// Body: { filename: string, mimeType?: string }
// Returns: { uploadUrl, publicUrl, path }
// ═══════════════════════════════════════════════════════════════════════════════
router.post("/public/mini-form-upload-url", async (req, res): Promise<void> => {
  try {
    const { filename, mimeType } = req.body as { filename: string; mimeType?: string };
    if (!filename || typeof filename !== "string") {
      res.status(400).json({ error: "filename wajib diisi" });
      return;
    }
    await ensureBucket();
    const result = await getUploadUrl(filename, mimeType ?? "application/octet-stream");
    res.json(result);
  } catch (err) {
    logger.error({ err }, "POST /public/mini-form-upload-url failed");
    res.status(500).json({ error: "Gagal membuat upload URL" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// MINI FORM: Payment proof upload
// POST /public/mini-form-upload
// Multipart body: file, token, fieldName=payment_proof
// The bytes are received by the API, validated, then stored in Supabase Storage.
// ═══════════════════════════════════════════════════════════════════════════════
router.post(
  "/public/mini-form-upload",
  (req: Request, res: Response, next: NextFunction): void => {
    miniFormPaymentUpload.single("file")(req, res, (err: unknown) => {
      if (!err) {
        next();
        return;
      }
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({ error: "Ukuran file maksimal 10 MB" });
        return;
      }
      res.status(400).json({ error: "File bukti pembayaran tidak valid" });
    });
  },
  async (req: Request, res: Response): Promise<void> => {
    try {
      const token = String(req.body?.token ?? "").trim();
      const fieldName = String(req.body?.fieldName ?? "").trim();
      const file = req.file;

      if (!token || token.length < 16 || fieldName !== "payment_proof") {
        res.status(400).json({ error: "Permintaan upload bukti pembayaran tidak valid" });
        return;
      }
      if (!file) {
        res.status(400).json({ error: "File bukti pembayaran wajib diunggah" });
        return;
      }

      const extension = file.originalname.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
      if (
        file.size > PAYMENT_PROOF_MAX_BYTES ||
        !PAYMENT_PROOF_MIME_TYPES.has(file.mimetype) ||
        !PAYMENT_PROOF_EXTENSIONS.has(extension)
      ) {
        res.status(400).json({
          error: "Format bukti pembayaran harus JPG, PNG, WebP, atau PDF dengan ukuran maksimal 10 MB",
        });
        return;
      }

      const [session] = await db
        .select({ id: intakeSessionsTable.id, status: intakeSessionsTable.status })
        .from(intakeSessionsTable)
        .where(eq(intakeSessionsTable.formToken, token))
        .limit(1);
      if (!session || ["submitted", "cancelled", "expired"].includes(session.status)) {
        res.status(404).json({ error: "Form tidak ditemukan atau sudah tidak aktif" });
        return;
      }

      await ensureBucket();
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      const stored = await uploadBuffer(
        file.buffer,
        `payment-proofs/${session.id}/${Date.now()}_${safeName}`,
        file.mimetype,
      );

      res.json({
        publicUrl: stored.publicUrl,
        path: stored.path,
        filename: file.originalname,
        size: file.size,
        mimeType: file.mimetype,
      });
    } catch (err) {
      logger.error({ err }, "POST /public/mini-form-upload failed");
      res.status(500).json({ error: "Gagal mengupload bukti pembayaran" });
    }
  },
);

export default router;
