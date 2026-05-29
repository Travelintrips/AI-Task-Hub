import { Router, type IRouter, type Request, type Response } from "express";
import { eq, ne, desc, and, ilike, or, isNull, SQL } from "drizzle-orm";
import {
  db,
  aiTasksTable,
  taskCommentsTable,
  activityTable,
  teamMembersTable,
} from "@workspace/db";
import { requireAuth, getCompanyId } from "../middleware/auth";
import { logger } from "../lib/logger";
import { notifyStatusChanged, notifyTaskAssigned } from "../lib/notifications";

const router: IRouter = Router();

// ─── GET /ai-tasks ─────────────────────────────────────────────────────────────

router.get("/ai-tasks", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    // super_admin without ?companyId sees their own company; with ?companyId= sees that company
    const companyId = getCompanyId(req) ?? req.user!.companyId;
    const { status, priority, search } = req.query as Record<string, string | undefined>;

    let rows = await db
      .select()
      .from(aiTasksTable)
      .where(eq(aiTasksTable.companyId, companyId))
      .orderBy(desc(aiTasksTable.updatedAt))
      .limit(300);

    if (status)   rows = rows.filter((t) => t.status   === status);
    if (priority) rows = rows.filter((t) => t.priority === priority);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.customerName ?? "").toLowerCase().includes(q) ||
          (t.taskNumber ?? "").toLowerCase().includes(q) ||
          (t.aiSummary ?? "").toLowerCase().includes(q),
      );
    }

    res.json(rows);
  } catch (err) {
    logger.error({ err }, "GET /ai-tasks failed");
    res.status(500).json({ error: "Failed to load AI tasks" });
  }
});

// ─── GET /ai-tasks/:id ─────────────────────────────────────────────────────────

router.get("/ai-tasks/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const companyId = getCompanyId(req) ?? req.user!.companyId;

    const [task] = await db
      .select()
      .from(aiTasksTable)
      .where(and(eq(aiTasksTable.id, id), eq(aiTasksTable.companyId, companyId)))
      .limit(1);

    if (!task) { res.status(404).json({ error: "AI task not found" }); return; }

    const comments = await db
      .select()
      .from(taskCommentsTable)
      .where(eq(taskCommentsTable.taskId, id))
      .orderBy(taskCommentsTable.createdAt);

    res.json({ ...task, comments });
  } catch (err) {
    logger.error({ err }, "GET /ai-tasks/:id failed");
    res.status(500).json({ error: "Failed to load AI task" });
  }
});

// ─── PATCH /ai-tasks/:id ────────────────────────────────────────────────────────

router.patch("/ai-tasks/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const companyId = getCompanyId(req) ?? req.user!.companyId;

    const [current] = await db
      .select()
      .from(aiTasksTable)
      .where(and(eq(aiTasksTable.id, id), eq(aiTasksTable.companyId, companyId)))
      .limit(1);

    if (!current) { res.status(404).json({ error: "AI task not found" }); return; }

    const {
      status, priority, assignedTo, assignedRole, assignedDivision,
      adminNotes, requiredAction, driverName, driverPhone, plateNumber,
      quotationAmount, quotationNotes,
    } = req.body as Record<string, string | number | null | undefined>;

    const updates: Partial<typeof aiTasksTable.$inferInsert> = {};
    if (status         !== undefined) updates.status         = status         as string;
    if (priority       !== undefined) updates.priority       = priority       as string;
    if (assignedTo     !== undefined) updates.assignedTo     = assignedTo     as string | null;
    if (assignedRole   !== undefined) updates.assignedRole   = assignedRole   as string | null;
    if (adminNotes     !== undefined) updates.adminNotes     = adminNotes     as string | null;
    if (requiredAction !== undefined) updates.requiredAction = requiredAction as string | null;
    if (driverName     !== undefined) updates.driverName     = driverName     as string | null;
    if (driverPhone    !== undefined) updates.driverPhone    = driverPhone    as string | null;
    if (plateNumber    !== undefined) updates.plateNumber    = plateNumber    as string | null;
    if (quotationAmount !== undefined) updates.quotationAmount = quotationAmount != null ? String(quotationAmount) : null;
    if (quotationNotes  !== undefined) updates.quotationNotes  = quotationNotes  as string | null;

    const [updated] = await db
      .update(aiTasksTable)
      .set(updates)
      .where(and(eq(aiTasksTable.id, id), eq(aiTasksTable.companyId, companyId)))
      .returning();

    // ── Activity log ─────────────────────────────────────────────────────────
    const changes: string[] = [];
    if (status && status !== current.status)
      changes.push(`status: ${current.status} → ${status}`);
    if (assignedTo && assignedTo !== current.assignedTo)
      changes.push(`petugas: ${assignedTo}`);

    if (changes.length > 0) {
      await db.insert(activityTable).values({
        type:        "task_updated",
        description: `AI Task ${current.taskNumber ?? id} diperbarui — ${changes.join(", ")}`,
        entityId:    id,
      }).catch(() => {});
    }

    // ── WhatsApp notifications (fire-and-forget) ──────────────────────────────
    const ctx = {
      taskId:       id,
      taskNumber:   current.taskNumber ?? `WA-${id}`,
      title:        updated.title,
      customerName: updated.customerName,
      customerPhone: updated.customerPhone,
      assignedTo:   updated.assignedTo,
      status:       updated.status,
      priority:     updated.priority,
      companyId,
    };

    if (status && status !== current.status) {
      notifyStatusChanged(ctx, current.status)
        .catch((err) => logger.error({ err }, "Notifikasi status change gagal"));
    }

    if (assignedTo && assignedTo !== current.assignedTo) {
      const [member] = await db
        .select()
        .from(teamMembersTable)
        .where(eq(teamMembersTable.name, assignedTo as string))
        .limit(1);

      notifyTaskAssigned(ctx, member?.phone ?? null)
        .catch((err) => logger.error({ err }, "Notifikasi assign gagal"));
    }

    res.json(updated);
  } catch (err) {
    logger.error({ err }, "PATCH /ai-tasks/:id failed");
    res.status(500).json({ error: "Failed to update AI task" });
  }
});

// ─── POST /ai-tasks/:id/comments ───────────────────────────────────────────────

router.post("/ai-tasks/:id/comments", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const taskId = Number(req.params.id);
    if (Number.isNaN(taskId)) { res.status(400).json({ error: "Invalid id" }); return; }

    const { comment, senderName } = req.body as { comment: string; senderName?: string };
    if (!comment?.trim()) { res.status(400).json({ error: "comment diperlukan" }); return; }

    const [row] = await db.insert(taskCommentsTable).values({
      taskId,
      senderType: "staff",
      senderName: senderName ?? "Staff",
      comment: comment.trim(),
    }).returning();

    res.status(201).json(row);
  } catch (err) {
    logger.error({ err }, "POST /ai-tasks/:id/comments failed");
    res.status(500).json({ error: "Failed to add comment" });
  }
});

// ─── Stub endpoints ────────────────────────────────────────────────────────────

router.get("/ai-tasks/:id/attachments",  requireAuth, (_req, res) => res.json([]));
router.post("/ai-tasks/:id/attachments", requireAuth, (_req, res) =>
  res.status(501).json({ error: "Upload belum tersedia" }));
router.delete("/ai-tasks/:id/attachments/:attachmentId", requireAuth, (_req, res) =>
  res.status(501).json({ error: "Hapus belum tersedia" }));
router.get("/ai-tasks/:id/audit",  requireAuth, (_req, res) =>
  res.status(404).json({ error: "Tidak ada audit" }));
router.post("/ai-tasks/:id/audit", requireAuth, (_req, res) =>
  res.status(501).json({ error: "Audit belum tersedia" }));
router.get("/ai-tasks/:id/timeline",  requireAuth, (_req, res) => res.json([]));
router.post("/ai-tasks/:id/generate-token", requireAuth, (_req, res) =>
  res.status(501).json({ error: "Token belum tersedia" }));

export default router;
