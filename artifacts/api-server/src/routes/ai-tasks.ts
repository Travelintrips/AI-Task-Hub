import { Router, type IRouter } from "express";
import { eq, desc, and, inArray } from "drizzle-orm";
import { db, aiTasksTable, taskCommentsTable, activityTable, taskAttachmentsTable, documentAuditsTable, whatsappMessagesTable } from "@workspace/db";
import { runAuditForTask } from "../lib/run-audit";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ─── GET /ai-tasks ────────────────────────────────────────────────────────────

router.get("/ai-tasks", async (req, res): Promise<void> => {
  try {
    const { status, category, priority, search, companyId, division, assignedTo } = req.query as Record<string, string>;

    const conditions = [];

    if (companyId)  conditions.push(eq(aiTasksTable.companyId, companyId));
    if (status)     conditions.push(eq(aiTasksTable.status, status));
    if (category)   conditions.push(eq(aiTasksTable.category, category));
    if (priority)   conditions.push(eq(aiTasksTable.priority, priority));
    if (division)   conditions.push(eq(aiTasksTable.division, division));
    if (assignedTo) conditions.push(eq(aiTasksTable.assignedTo, assignedTo));

    const rows = await db
      .select()
      .from(aiTasksTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(aiTasksTable.createdAt));

    // Apply search client-side (name, phone, title, taskNumber, aiSummary)
    const q = search?.toLowerCase().trim();
    const filtered = q
      ? rows.filter(
          (t) =>
            t.title.toLowerCase().includes(q) ||
            (t.customerName ?? "").toLowerCase().includes(q) ||
            (t.customerPhone ?? "").toLowerCase().includes(q) ||
            (t.taskNumber ?? "").toLowerCase().includes(q) ||
            (t.aiSummary ?? "").toLowerCase().includes(q),
        )
      : rows;

    // ── Enrich with latest audit status ──────────────────────────────────────
    const taskIds = filtered.map((t) => t.id);
    const auditMap: Record<number, string> = {};
    if (taskIds.length > 0) {
      const audits = await db
        .select({ taskId: documentAuditsTable.taskId, auditStatus: documentAuditsTable.auditStatus })
        .from(documentAuditsTable)
        .where(inArray(documentAuditsTable.taskId, taskIds))
        .orderBy(desc(documentAuditsTable.updatedAt));
      for (const a of audits) {
        if (!(a.taskId in auditMap)) auditMap[a.taskId] = a.auditStatus;
      }
    }

    // ── Enrich with latest WhatsApp message per customer phone ────────────────
    const phones = [...new Set(filtered.map((t) => t.customerPhone).filter(Boolean))] as string[];
    const msgMap: Record<string, string> = {};
    if (phones.length > 0) {
      const msgs = await db
        .select({ senderPhone: whatsappMessagesTable.senderPhone, body: whatsappMessagesTable.body })
        .from(whatsappMessagesTable)
        .orderBy(desc(whatsappMessagesTable.createdAt));
      for (const m of msgs) {
        const key = m.senderPhone ?? "";
        if (key && !msgMap[key]) msgMap[key] = m.body;
      }
    }

    res.json(
      filtered.map((t) => ({
        ...t,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
        dueDate: t.dueDate ? t.dueDate.toISOString() : null,
        auditStatus: auditMap[t.id] ?? null,
        latestMessage: t.customerPhone ? (msgMap[t.customerPhone] ?? null) : null,
      })),
    );
  } catch (err) {
    logger.error({ err }, "GET /ai-tasks failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /ai-tasks/:id ────────────────────────────────────────────────────────

router.get("/ai-tasks/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [task] = await db.select().from(aiTasksTable).where(eq(aiTasksTable.id, id));
    if (!task) { res.status(404).json({ error: "Task not found" }); return; }

    const comments = await db
      .select()
      .from(taskCommentsTable)
      .where(eq(taskCommentsTable.taskId, id))
      .orderBy(taskCommentsTable.createdAt);

    res.json({
      ...task,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
      dueDate: task.dueDate ? task.dueDate.toISOString() : null,
      comments: comments.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })),
    });
  } catch (err) {
    logger.error({ err }, "GET /ai-tasks/:id failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PATCH /ai-tasks/:id ──────────────────────────────────────────────────────

router.patch("/ai-tasks/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const allowed = ["status", "priority", "assignedTo", "assignedRole", "division", "aiSummary"] as const;
    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No valid fields to update" });
      return;
    }

    const [task] = await db
      .update(aiTasksTable)
      .set(updates)
      .where(eq(aiTasksTable.id, id))
      .returning();

    if (!task) { res.status(404).json({ error: "Task not found" }); return; }

    await db.insert(activityTable).values({
      type: "task_updated",
      description: `AI task ${task.taskNumber ?? id} updated — ${JSON.stringify(updates)}`,
      entityId: task.id,
    });

    res.json({
      ...task,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
      dueDate: task.dueDate ? task.dueDate.toISOString() : null,
    });
  } catch (err) {
    logger.error({ err }, "PATCH /ai-tasks/:id failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /ai-tasks/:id/comments ─────────────────────────────────────────────

router.post("/ai-tasks/:id/comments", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const { comment, senderName, senderType } = req.body as {
      comment: string;
      senderName?: string;
      senderType?: string;
    };

    if (!comment?.trim()) {
      res.status(400).json({ error: "comment is required" });
      return;
    }

    const [saved] = await db
      .insert(taskCommentsTable)
      .values({
        taskId: id,
        comment: comment.trim(),
        senderName: senderName ?? "Agent",
        senderType: senderType ?? "agent",
      })
      .returning();

    res.status(201).json({ ...saved, createdAt: saved.createdAt.toISOString() });
  } catch (err) {
    logger.error({ err }, "POST /ai-tasks/:id/comments failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /ai-tasks/:id/attachments ───────────────────────────────────────────

router.get("/ai-tasks/:id/attachments", async (req, res): Promise<void> => {
  try {
    const taskId = parseInt(req.params.id, 10);
    if (isNaN(taskId)) { res.status(400).json({ error: "Invalid id" }); return; }

    const attachments = await db
      .select()
      .from(taskAttachmentsTable)
      .where(eq(taskAttachmentsTable.taskId, taskId))
      .orderBy(desc(taskAttachmentsTable.createdAt));

    res.json(attachments.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })));
  } catch (err) {
    logger.error({ err }, "GET /ai-tasks/:id/attachments failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /ai-tasks/:id/attachments ──────────────────────────────────────────
// Called after the client has uploaded the file directly to object storage.

router.post("/ai-tasks/:id/attachments", async (req, res): Promise<void> => {
  try {
    const taskId = parseInt(req.params.id, 10);
    if (isNaN(taskId)) { res.status(400).json({ error: "Invalid id" }); return; }

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

    const fileType = mimeType?.startsWith("image/")
      ? "image"
      : mimeType === "application/pdf"
      ? "pdf"
      : mimeType?.includes("word")
      ? "word"
      : mimeType?.includes("sheet") || mimeType?.includes("excel")
      ? "spreadsheet"
      : "document";

    const fileUrl = `/api/storage/objects${objectPath}`;

    const [attachment] = await db
      .insert(taskAttachmentsTable)
      .values({
        taskId,
        fileName,
        fileUrl,
        objectPath,
        mimeType,
        fileSize,
        fileType,
        documentType: documentType ?? null,
        ocrStatus: "pending",
        uploadedBy: uploadedBy ?? null,
      })
      .returning();

    res.status(201).json({ ...attachment, createdAt: attachment.createdAt.toISOString() });
  } catch (err) {
    logger.error({ err }, "POST /ai-tasks/:id/attachments failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /ai-tasks/:id/audit ─────────────────────────────────────────────────

router.get("/ai-tasks/:id/audit", async (req, res): Promise<void> => {
  try {
    const taskId = parseInt(req.params.id, 10);
    if (isNaN(taskId)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [audit] = await db
      .select()
      .from(documentAuditsTable)
      .where(eq(documentAuditsTable.taskId, taskId))
      .orderBy(desc(documentAuditsTable.createdAt))
      .limit(1);

    if (!audit) { res.status(404).json({ error: "No audit found" }); return; }

    res.json({
      ...audit,
      createdAt: audit.createdAt.toISOString(),
      updatedAt: audit.updatedAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "GET /ai-tasks/:id/audit failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /ai-tasks/:id/audit ─────────────────────────────────────────────────

router.post("/ai-tasks/:id/audit", async (req, res): Promise<void> => {
  try {
    const taskId = parseInt(req.params.id, 10);
    if (isNaN(taskId)) { res.status(400).json({ error: "Invalid id" }); return; }

    const audit = await runAuditForTask(taskId);

    res.status(201).json({
      ...audit,
      createdAt: audit.createdAt.toISOString(),
      updatedAt: audit.updatedAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "POST /ai-tasks/:id/audit failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── DELETE /ai-tasks/:id/attachments/:attachmentId ──────────────────────────

router.delete("/ai-tasks/:id/attachments/:attachmentId", async (req, res): Promise<void> => {
  try {
    const taskId = parseInt(req.params.id, 10);
    const attachmentId = parseInt(req.params.attachmentId, 10);
    if (isNaN(taskId) || isNaN(attachmentId)) { res.status(400).json({ error: "Invalid id" }); return; }

    await db
      .delete(taskAttachmentsTable)
      .where(and(eq(taskAttachmentsTable.id, attachmentId), eq(taskAttachmentsTable.taskId, taskId)));

    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "DELETE /ai-tasks/:id/attachments failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
