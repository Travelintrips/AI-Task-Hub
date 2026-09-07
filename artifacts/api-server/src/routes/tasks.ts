import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, and } from "drizzle-orm";
import { db, aiTasksTable, teamMembersTable, auditLogsTable } from "@workspace/db";
import { requireAuth, getCompanyId } from "../middleware/auth";
import { logger } from "../lib/logger";
import { notifyStatusChanged, notifyTaskAssigned, notifyTaskCreated } from "../lib/notifications";
import { emitSseEvent } from "../lib/sse";

const router: IRouter = Router();

// ─── GET /tasks ────────────────────────────────────────────────────────────────

router.get("/tasks", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? "default";
    const { status, priority, search } = req.query as Record<string, string | undefined>;

    let rows = await db
      .select()
      .from(aiTasksTable)
      .where(eq(aiTasksTable.companyId, companyId))
      .orderBy(desc(aiTasksTable.createdAt))
      .limit(300);

    if (status)   rows = rows.filter((t) => t.status   === status);
    if (priority) rows = rows.filter((t) => t.priority === priority);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.customerName ?? "").toLowerCase().includes(q) ||
          (t.description ?? "").toLowerCase().includes(q),
      );
    }

    res.json(
      rows.map((r) => ({
        ...r,
        assigneeName: r.assignedTo ?? null,
      })),
    );
  } catch (err) {
    logger.error({ err }, "GET /tasks failed");
    res.status(500).json({ error: "Failed to load tasks" });
  }
});

// ─── GET /tasks/:id ────────────────────────────────────────────────────────────

router.get("/tasks/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const companyId = getCompanyId(req) ?? "default";
    const [task] = await db
      .select()
      .from(aiTasksTable)
      .where(and(eq(aiTasksTable.id, id), eq(aiTasksTable.companyId, companyId)))
      .limit(1);
    if (!task) { res.status(404).json({ error: "Task not found" }); return; }

    res.json({ ...task, assigneeName: task.assignedTo ?? null });
  } catch (err) {
    logger.error({ err }, "GET /tasks/:id failed");
    res.status(500).json({ error: "Failed to load task" });
  }
});

// ─── POST /tasks ────────────────────────────────────────────────────────────────

router.post("/tasks", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? "default";
    const { title, description, status, priority, assigneeId, customerName, dueDate } = req.body as {
      title: string;
      description?: string;
      status?: string;
      priority?: string;
      assigneeId?: number;
      customerName?: string;
      dueDate?: string;
    };

    if (!title?.trim()) {
      res.status(400).json({ error: "title diperlukan" });
      return;
    }

    let assignedTo: string | null = null;
    if (assigneeId) {
      const [member] = await db
        .select()
        .from(teamMembersTable)
        .where(eq(teamMembersTable.id, assigneeId))
        .limit(1);
      assignedTo = member?.name ?? null;
    }

    const now   = new Date();
    const yymm  = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, "0")}`;
    const rand  = Math.floor(Math.random() * 9000) + 1000;
    const taskNumber = `TASK-${yymm}-${rand}`;

    const [task] = await db
      .insert(aiTasksTable)
      .values({
        companyId,
        taskNumber,
        source: "manual",
        title:        title.trim(),
        description:  description ?? null,
        status:       status ?? "new_inquiry",
        priority:     priority ?? "medium",
        assignedTo,
        customerName: customerName ?? null,
        dueDate:      dueDate ? new Date(dueDate) : null,
      })
      .returning();

    await db.insert(auditLogsTable).values({
      action:   "task_created",
      module:   "tasks",
      before:   `Task #${task.id} dibuat: ${task.title}`,
      entityId: task.id,
    }).catch(() => {});

    emitSseEvent("task_created", { taskId: task.id }, companyId);

    notifyTaskCreated({
      taskId:       task.id,
      taskNumber,
      title:        task.title,
      customerName: task.customerName,
      customerPhone: null,
      status:       task.status ?? "new_inquiry",
      priority:     task.priority ?? "medium",
      companyId,
    }).catch((err) => logger.error({ err }, "notifyTaskCreated gagal"));

    res.status(201).json(task);
  } catch (err) {
    logger.error({ err }, "POST /tasks failed");
    res.status(500).json({ error: "Failed to create task" });
  }
});

// ─── PATCH /tasks/:id ──────────────────────────────────────────────────────────

router.patch("/tasks/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const companyId = getCompanyId(req) ?? "default";
    const [current] = await db
      .select()
      .from(aiTasksTable)
      .where(and(eq(aiTasksTable.id, id), eq(aiTasksTable.companyId, companyId)))
      .limit(1);
    if (!current) { res.status(404).json({ error: "Task not found" }); return; }

    const { status, priority, assigneeId, title, description, dueDate } = req.body as {
      status?:      string;
      priority?:    string;
      assigneeId?:  number | null;
      title?:       string;
      description?: string;
      dueDate?:     string | null;
    };

    const updates: Record<string, unknown> = {};
    if (status      !== undefined) updates.status      = status;
    if (priority    !== undefined) updates.priority    = priority;
    if (title       !== undefined) updates.title       = title;
    if (description !== undefined) updates.description = description;
    if (dueDate     !== undefined) updates.dueDate     = dueDate ? new Date(dueDate) : null;

    let member: { id: number; name: string; phone: string | null } | undefined;
    if (assigneeId !== undefined) {
      if (assigneeId === null) {
        updates.assignedTo = null;
      } else {
        const [m] = await db
          .select()
          .from(teamMembersTable)
          .where(eq(teamMembersTable.id, assigneeId))
          .limit(1);
        member = m;
        updates.assignedTo = m?.name ?? null;
      }
    }

    const [updated] = await db
      .update(aiTasksTable)
      .set(updates)
      .where(and(eq(aiTasksTable.id, id), eq(aiTasksTable.companyId, companyId)))
      .returning();

    // ── Activity log ─────────────────────────────────────────────────────────
    const changes: string[] = [];
    if (status   && status   !== current.status)   changes.push(`status: ${current.status} → ${status}`);
    if (priority && priority !== current.priority) changes.push(`prioritas: ${current.priority} → ${priority}`);
    if (assigneeId !== undefined && assigneeId !== null) changes.push("assignee diubah");

    if (changes.length > 0) {
      await db.insert(auditLogsTable).values({
        action:   "task_updated",
        module:   "tasks",
        before:   `Task #${id} diperbarui — ${changes.join(", ")}`,
        entityId: id,
      }).catch(() => {});
    }

    // ── WhatsApp notifications (fire-and-forget) ──────────────────────────────
    const taskNumber = current.taskNumber ?? `TASK-${String(id).padStart(4, "0")}`;

    if (status && status !== current.status) {
      notifyStatusChanged(
        {
          taskId:       id,
          taskNumber,
          title:        updated.title,
          customerName: updated.customerName,
          customerPhone: updated.customerPhone ?? null,
          status:       status,
          priority:     updated.priority,
          companyId,
        },
        current.status,
      ).catch((err) => logger.error({ err }, "Notifikasi status change gagal"));
    }

    if (assigneeId && assigneeId !== null) {
      notifyTaskAssigned(
        {
          taskId:       id,
          taskNumber,
          title:        updated.title,
          customerName: updated.customerName,
          customerPhone: updated.customerPhone ?? null,
          assignedTo:   member?.name ?? null,
          status:       updated.status,
          priority:     updated.priority,
          companyId,
        },
        member?.phone ?? null,
      ).catch((err) => logger.error({ err }, "Notifikasi assign gagal"));
    }

    emitSseEvent("task_updated", { taskId: id }, companyId);
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "PATCH /tasks/:id failed");
    res.status(500).json({ error: "Failed to update task" });
  }
});

// ─── DELETE /tasks/:id ─────────────────────────────────────────────────────────

router.delete("/tasks/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const companyId = getCompanyId(req) ?? "default";
    const [deleted] = await db
      .delete(aiTasksTable)
      .where(and(eq(aiTasksTable.id, id), eq(aiTasksTable.companyId, companyId)))
      .returning();
    if (!deleted) { res.status(404).json({ error: "Task not found" }); return; }

    await db.insert(auditLogsTable).values({
      action:   "task_deleted",
      module:   "tasks",
      before:   `Task #${id} dihapus`,
      entityId: id,
    }).catch(() => {});

    emitSseEvent("task_deleted", { taskId: id }, companyId);
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "DELETE /tasks/:id failed");
    res.status(500).json({ error: "Failed to delete task" });
  }
});

// ─── PATCH /tasks/:id/assign ────────────────────────────────────────────────────

router.patch("/tasks/:id/assign", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const { assigneeId } = req.body as { assigneeId: number };
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const companyId = getCompanyId(req) ?? "default";
    const [task] = await db
      .select()
      .from(aiTasksTable)
      .where(and(eq(aiTasksTable.id, id), eq(aiTasksTable.companyId, companyId)))
      .limit(1);
    if (!task) { res.status(404).json({ error: "Task not found" }); return; }

    const [member] = await db
      .select()
      .from(teamMembersTable)
      .where(eq(teamMembersTable.id, assigneeId))
      .limit(1);

    const [updated] = await db
      .update(aiTasksTable)
      .set({ assignedTo: member?.name ?? null, status: "in_progress" })
      .where(and(eq(aiTasksTable.id, id), eq(aiTasksTable.companyId, companyId)))
      .returning();

    notifyTaskAssigned(
      {
        taskId:       id,
        taskNumber:   task.taskNumber ?? `TASK-${String(id).padStart(4, "0")}`,
        title:        task.title,
        customerName: task.customerName,
        customerPhone: task.customerPhone ?? null,
        assignedTo:   member?.name ?? null,
        status:       "in_progress",
        priority:     task.priority,
        companyId,
      },
      member?.phone ?? null,
    ).catch((err) => logger.error({ err }, "Notifikasi assign gagal"));

    emitSseEvent("task_updated", { taskId: id }, companyId);
    res.json({ ...updated, assigneeName: member?.name ?? null });
  } catch (err) {
    logger.error({ err }, "PATCH /tasks/:id/assign failed");
    res.status(500).json({ error: "Failed to assign task" });
  }
});

// ─── POST /tasks/:id/ai-summary ────────────────────────────────────────────────

router.post("/tasks/:id/ai-summary", requireAuth, async (_req: Request, res: Response): Promise<void> => {
  res.status(501).json({ error: "AI summary tidak tersedia untuk task ini" });
});

export default router;
