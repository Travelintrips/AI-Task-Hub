import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, ilike, or, and } from "drizzle-orm";
import {
  db,
  aiTasksTable,
  taskCommentsTable,
  taskAttachmentsTable,
  activityTable,
  type AiTaskStatus,
} from "@workspace/db";
import { requireAuth, getCompanyId } from "../middleware/auth";
import { logger } from "../lib/logger";
import { notifyTaskCreated, notifyStatusChanged, notifyTaskAssigned } from "../lib/notifications";

const router: IRouter = Router();

// ─── Status mapping ────────────────────────────────────────────────────────────

const DB_TO_DISPLAY: Record<string, string> = {
  new_inquiry:          "New Inquiry",
  waiting_documents:    "Waiting Documents",
  documents_received:   "Waiting Documents",
  audit_in_progress:    "Ready for Review",
  missing_data:         "Waiting Documents",
  ready_for_review:     "Ready for Review",
  assigned:             "Assigned",
  in_progress:          "In Progress",
  waiting_customer:     "Waiting Customer",
  waiting_vendor:       "In Progress",
  quotation_ready:      "Ready for Review",
  approved_by_customer: "In Progress",
  completed:            "Completed",
  cancelled:            "Completed",
};

const DISPLAY_TO_DB: Record<string, AiTaskStatus> = {
  "New Inquiry":       "new_inquiry",
  "Waiting Documents": "waiting_documents",
  "Ready for Review":  "ready_for_review",
  "Assigned":          "assigned",
  "In Progress":       "in_progress",
  "Waiting Customer":  "waiting_customer",
  "Completed":         "completed",
};

function toDisplay(dbStatus: string): string {
  return DB_TO_DISPLAY[dbStatus] ?? dbStatus;
}

function toDbStatus(displayOrDb: string): AiTaskStatus {
  if (DISPLAY_TO_DB[displayOrDb]) return DISPLAY_TO_DB[displayOrDb];
  return (displayOrDb as AiTaskStatus) ?? "new_inquiry";
}

function mapAiTask(r: typeof aiTasksTable.$inferSelect) {
  return {
    id:              r.id,
    companyId:       r.companyId,
    taskNumber:      r.taskNumber ?? `SO/2026/${String(r.id).padStart(5, "0")}`,
    source:          r.source,
    customerName:    r.customerName,
    customerPhone:   r.customerPhone,
    title:           r.title,
    description:     r.description,
    category:        r.category,
    division:        r.division,
    priority:        r.priority,
    status:          toDisplay(r.status),
    assignedTo:      r.assignedTo,
    assignedRole:    r.assignedRole,
    assignedDivision: r.assignedDivision,
    assignedVendor:  r.assignedVendor,
    driverName:      r.driverName,
    driverPhone:     r.driverPhone,
    plateNumber:     r.plateNumber,
    quotationAmount: r.quotationAmount ? Number(r.quotationAmount) : null,
    quotationNotes:  r.quotationNotes,
    dueDate:         r.dueDate?.toISOString() ?? null,
    aiSummary:       r.aiSummary,
    aiIntent:        r.aiIntent,
    missingData:     r.missingData,
    requiredAction:  r.requiredAction,
    adminNotes:      r.adminNotes,
    auditStatus:     null as string | null,
    latestMessage:   null as string | null,
    createdAt:       r.createdAt.toISOString(),
    updatedAt:       r.updatedAt.toISOString(),
  };
}

// ─── GET /ai-tasks ─────────────────────────────────────────────────────────────

router.get("/ai-tasks", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, priority, search } = req.query as Record<string, string | undefined>;
    const companyId = getCompanyId(req);

    const rows = await db
      .select()
      .from(aiTasksTable)
      .where(eq(aiTasksTable.companyId, companyId))
      .orderBy(desc(aiTasksTable.createdAt))
      .limit(300);

    let mapped = rows.map(mapAiTask);

    if (status) {
      const dbStatus = toDbStatus(status);
      mapped = mapped.filter((t) => t.status === toDisplay(dbStatus));
    }
    if (priority) {
      mapped = mapped.filter((t) => t.priority === priority);
    }
    if (search) {
      const q = search.toLowerCase();
      mapped = mapped.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.customerName ?? "").toLowerCase().includes(q) ||
          (t.taskNumber ?? "").toLowerCase().includes(q) ||
          (t.customerPhone ?? "").toLowerCase().includes(q) ||
          (t.aiSummary ?? "").toLowerCase().includes(q),
      );
    }

    res.json(mapped);
  } catch (err) {
    logger.error({ err }, "GET /ai-tasks failed");
    res.status(500).json({ error: "Failed to load AI tasks" });
  }
});

// ─── GET /ai-tasks/:id ────────────────────────────────────────────────────────

router.get("/ai-tasks/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [row] = await db
      .select()
      .from(aiTasksTable)
      .where(eq(aiTasksTable.id, id))
      .limit(1);

    if (!row) { res.status(404).json({ error: "AI task not found" }); return; }

    const comments = await db
      .select()
      .from(taskCommentsTable)
      .where(eq(taskCommentsTable.taskId, id))
      .orderBy(taskCommentsTable.createdAt);

    res.json({ ...mapAiTask(row), comments });
  } catch (err) {
    logger.error({ err }, "GET /ai-tasks/:id failed");
    res.status(500).json({ error: "Failed to load AI task" });
  }
});

// ─── POST /ai-tasks ───────────────────────────────────────────────────────────

router.post("/ai-tasks", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req);
    const body = req.body as Record<string, unknown>;

    if (!body.title) { res.status(400).json({ error: "title is required" }); return; }

    const taskNumber = `SO/${new Date().getFullYear()}/${String(
      (await db.select().from(aiTasksTable).where(eq(aiTasksTable.companyId, companyId))).length + 1
    ).padStart(5, "0")}`;

    const [created] = await db.insert(aiTasksTable).values({
      companyId,
      taskNumber: body.taskNumber ? String(body.taskNumber) : taskNumber,
      source: body.source ? String(body.source) : "manual",
      title: String(body.title),
      description: body.description ? String(body.description) : undefined,
      customerName: body.customerName ? String(body.customerName) : undefined,
      customerPhone: body.customerPhone ? String(body.customerPhone) : undefined,
      category: body.category ? String(body.category) : undefined,
      division: body.division ? String(body.division) : undefined,
      priority: body.priority ? String(body.priority) : "medium",
      status: body.status ? toDbStatus(String(body.status)) : "new_inquiry",
      assignedTo: body.assignedTo ? String(body.assignedTo) : undefined,
      assignedRole: body.assignedRole ? String(body.assignedRole) : undefined,
      assignedDivision: body.assignedDivision ? String(body.assignedDivision) : undefined,
      assignedVendor: body.assignedVendor ? String(body.assignedVendor) : undefined,
      adminNotes: body.adminNotes ? String(body.adminNotes) : undefined,
      requiredAction: body.requiredAction ? String(body.requiredAction) : undefined,
    }).returning();

    await db.insert(activityTable).values({
      type: "task_created",
      description: `Task ${created.taskNumber} dibuat`,
      entityId: created.id,
    });

    notifyTaskCreated({
      taskId:       created.id,
      taskNumber:   created.taskNumber ?? `SO/2026/${String(created.id).padStart(5, "0")}`,
      title:        created.title,
      customerName: created.customerName,
      customerPhone: created.customerPhone,
      assignedTo:   created.assignedTo,
      status:       toDisplay(created.status),
      priority:     created.priority ?? "medium",
      companyId:    created.companyId,
    }).catch((err) => logger.error({ err }, "notifyTaskCreated failed"));

    res.status(201).json(mapAiTask(created));
  } catch (err) {
    logger.error({ err }, "POST /ai-tasks failed");
    res.status(500).json({ error: "Failed to create AI task" });
  }
});

// ─── PATCH /ai-tasks/:id ──────────────────────────────────────────────────────

router.patch("/ai-tasks/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    // Ambil data lama sebelum update (untuk deteksi perubahan status & assignment)
    const [before] = await db
      .select()
      .from(aiTasksTable)
      .where(eq(aiTasksTable.id, id))
      .limit(1);

    if (!before) { res.status(404).json({ error: "AI task not found" }); return; }

    const body = req.body as Record<string, unknown>;
    const updates: Partial<typeof aiTasksTable.$inferInsert> = {};

    if (body.status != null)          updates.status = toDbStatus(String(body.status));
    if (body.priority != null)        updates.priority = String(body.priority);
    if (body.title != null)           updates.title = String(body.title);
    if (body.description != null)     updates.description = String(body.description);
    if (body.category != null)        updates.category = String(body.category);
    if (body.division != null)        updates.division = String(body.division);
    if (body.assignedTo != null)      updates.assignedTo = String(body.assignedTo);
    if (body.assignedRole != null)    updates.assignedRole = String(body.assignedRole);
    if (body.assignedDivision != null) updates.assignedDivision = String(body.assignedDivision);
    if (body.assignedVendor != null)  updates.assignedVendor = String(body.assignedVendor);
    if (body.driverName != null)      updates.driverName = String(body.driverName);
    if (body.driverPhone != null)     updates.driverPhone = String(body.driverPhone);
    if (body.plateNumber != null)     updates.plateNumber = String(body.plateNumber);
    if (body.quotationAmount != null) updates.quotationAmount = String(body.quotationAmount);
    if (body.quotationNotes != null)  updates.quotationNotes = String(body.quotationNotes);
    if (body.requiredAction != null)  updates.requiredAction = String(body.requiredAction);
    if (body.adminNotes != null)      updates.adminNotes = String(body.adminNotes);
    if (body.missingData != null)     updates.missingData = String(body.missingData);

    const [updated] = await db
      .update(aiTasksTable)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(aiTasksTable.id, id))
      .returning();

    if (!updated) { res.status(404).json({ error: "AI task not found" }); return; }

    const activityLines: string[] = [];
    const oldStatus = toDisplay(before.status);
    const newStatus = toDisplay(updated.status);
    if (oldStatus !== newStatus) activityLines.push(`status: ${oldStatus} → ${newStatus}`);
    if ((before.assignedTo ?? "") !== (updated.assignedTo ?? "")) activityLines.push(`petugas: ${updated.assignedTo ?? "-"}`);

    await db.insert(activityTable).values({
      type: "task_updated",
      description: `Task ${updated.taskNumber ?? id} diperbarui` + (activityLines.length ? ` (${activityLines.join(", ")})` : ""),
      entityId: id,
    });

    const ctx = {
      taskId:        updated.id,
      taskNumber:    updated.taskNumber ?? `SO/2026/${String(updated.id).padStart(5, "0")}`,
      title:         updated.title,
      customerName:  updated.customerName,
      customerPhone: updated.customerPhone,
      assignedTo:    updated.assignedTo,
      status:        newStatus,
      priority:      updated.priority ?? "medium",
      companyId:     updated.companyId,
    };

    // Kirim notifikasi status berubah
    if (oldStatus !== newStatus) {
      notifyStatusChanged(ctx, oldStatus).catch((err) => logger.error({ err }, "notifyStatusChanged failed"));
    }

    // Kirim notifikasi assignment baru
    const assignedToChanged = (before.assignedTo ?? "") !== (updated.assignedTo ?? "") && updated.assignedTo;
    if (assignedToChanged) {
      notifyTaskAssigned(ctx, body.staffPhone ? String(body.staffPhone) : null)
        .catch((err) => logger.error({ err }, "notifyTaskAssigned failed"));
    }

    res.json(mapAiTask(updated));
  } catch (err) {
    logger.error({ err }, "PATCH /ai-tasks/:id failed");
    res.status(500).json({ error: "Failed to update AI task" });
  }
});

// ─── POST /ai-tasks/:id/comments ──────────────────────────────────────────────

router.post("/ai-tasks/:id/comments", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const { comment, senderType, senderName } = req.body as {
      comment?: string; senderType?: string; senderName?: string;
    };
    if (!comment) { res.status(400).json({ error: "comment is required" }); return; }

    const [newComment] = await db
      .insert(taskCommentsTable)
      .values({
        taskId: id,
        comment,
        senderType: senderType ?? "agent",
        senderName: senderName ?? req.user?.name ?? "Admin",
      })
      .returning();

    res.status(201).json(newComment);
  } catch (err) {
    logger.error({ err }, "POST /ai-tasks/:id/comments failed");
    res.status(500).json({ error: "Failed to add comment" });
  }
});

// ─── GET /ai-tasks/:id/attachments ────────────────────────────────────────────

router.get("/ai-tasks/:id/attachments", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const attachments = await db
      .select()
      .from(taskAttachmentsTable)
      .where(eq(taskAttachmentsTable.taskId, id))
      .orderBy(taskAttachmentsTable.createdAt);

    res.json(attachments);
  } catch (err) {
    logger.error({ err }, "GET /ai-tasks/:id/attachments failed");
    res.status(500).json({ error: "Failed to load attachments" });
  }
});

// ─── POST /ai-tasks/:id/attachments ───────────────────────────────────────────

router.post("/ai-tasks/:id/attachments", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const { fileName, fileUrl, objectPath, mimeType, fileSize, documentType } = req.body as {
      fileName?: string; fileUrl?: string; objectPath?: string;
      mimeType?: string; fileSize?: number; documentType?: string;
    };

    if (!fileName) { res.status(400).json({ error: "fileName is required" }); return; }

    const [attachment] = await db
      .insert(taskAttachmentsTable)
      .values({
        taskId: id,
        fileName,
        fileUrl: fileUrl ?? null,
        objectPath: objectPath ?? null,
        mimeType: mimeType ?? null,
        fileSize: fileSize ?? null,
        documentType: documentType ?? null,
        uploadedBy: req.user?.name ?? "Admin",
      })
      .returning();

    res.status(201).json(attachment);
  } catch (err) {
    logger.error({ err }, "POST /ai-tasks/:id/attachments failed");
    res.status(500).json({ error: "Failed to upload attachment" });
  }
});

// ─── DELETE /ai-tasks/:id ────────────────────────────────────────────────────

router.delete("/ai-tasks/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    await db.delete(taskCommentsTable).where(eq(taskCommentsTable.taskId, id));
    await db.delete(taskAttachmentsTable).where(eq(taskAttachmentsTable.taskId, id));

    const [deleted] = await db
      .delete(aiTasksTable)
      .where(eq(aiTasksTable.id, id))
      .returning();

    if (!deleted) { res.status(404).json({ error: "Task not found" }); return; }

    res.sendStatus(204);
  } catch (err) {
    logger.error({ err }, "DELETE /ai-tasks/:id failed");
    res.status(500).json({ error: "Failed to delete task" });
  }
});

// ─── DELETE /ai-tasks/:id/attachments/:attachmentId ───────────────────────────

router.delete("/ai-tasks/:id/attachments/:attachmentId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const attachmentId = Number(req.params.attachmentId);
    if (Number.isNaN(attachmentId)) { res.status(400).json({ error: "Invalid attachment id" }); return; }

    const [deleted] = await db
      .delete(taskAttachmentsTable)
      .where(eq(taskAttachmentsTable.id, attachmentId))
      .returning();

    if (!deleted) { res.status(404).json({ error: "Attachment not found" }); return; }

    res.sendStatus(204);
  } catch (err) {
    logger.error({ err }, "DELETE /ai-tasks/:id/attachments/:attachmentId failed");
    res.status(500).json({ error: "Failed to delete attachment" });
  }
});

// ─── POST /ai-tasks/:id/send-wa ───────────────────────────────────────────────

router.post("/ai-tasks/:id/send-wa", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [task] = await db.select().from(aiTasksTable).where(eq(aiTasksTable.id, id)).limit(1);
    if (!task) { res.status(404).json({ error: "Task not found" }); return; }

    if (!task.customerPhone) {
      res.status(422).json({ error: "Task tidak memiliki nomor WhatsApp customer" });
      return;
    }

    const { message, templateName } = req.body as { message?: string; templateName?: string };
    if (!message || !message.trim()) {
      res.status(400).json({ error: "message is required" });
      return;
    }

    const { sendFonnte } = await import("../lib/fonnte");
    const { db: _db, whatsappNotificationsTable } = await import("@workspace/db");

    const result = await sendFonnte(task.customerPhone, message.trim());

    await _db.insert(whatsappNotificationsTable).values({
      taskId:            id,
      companyId:         task.companyId,
      recipientPhone:    task.customerPhone,
      recipientType:     "customer",
      templateName:      templateName ?? "manual",
      messageText:       message.trim(),
      status:            result.success ? "sent" : "failed",
      externalMessageId: result.messageId,
      errorMessage:      result.error,
      sentAt:            result.success ? new Date() : null,
    });

    await db.insert(activityTable).values({
      type:        "task_updated",
      description: `WA manual dikirim ke ${task.customerPhone}${result.success ? "" : " (gagal)"}`,
      entityId:    id,
    });

    if (result.success) {
      res.json({ success: true, messageId: result.messageId });
    } else {
      res.status(502).json({ success: false, error: result.error ?? "Gagal mengirim WA" });
    }
  } catch (err) {
    logger.error({ err }, "POST /ai-tasks/:id/send-wa failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /ai-tasks/:id/audit ──────────────────────────────────────────────────

router.get("/ai-tasks/:id/audit", requireAuth, (_req: Request, res: Response): void => {
  res.status(404).json({ error: "No audit" });
});

router.post("/ai-tasks/:id/audit", requireAuth, (_req: Request, res: Response): void => {
  res.status(501).json({ error: "Audit not implemented" });
});

// ─── GET /ai-tasks/:id/timeline ───────────────────────────────────────────────

router.get("/ai-tasks/:id/timeline", requireAuth, (_req: Request, res: Response): void => {
  res.json([]);
});

// ─── POST /ai-tasks/:id/generate-token ───────────────────────────────────────

router.post("/ai-tasks/:id/generate-token", requireAuth, (_req: Request, res: Response): void => {
  res.status(501).json({ error: "Token generation not implemented" });
});

export default router;
