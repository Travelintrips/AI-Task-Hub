import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, and, ilike, or } from "drizzle-orm";
import { db, tasksTable, teamMembersTable, activityTable, usersTable } from "@workspace/db";
import { requireAuth, getCompanyId, getCompanyIdForWrite } from "../middleware/auth";
import { logger } from "../lib/logger";
import { notifyStatusChanged, notifyTaskAssigned } from "../lib/notifications";
import { emitSseEvent } from "../lib/sse";

const router: IRouter = Router();

// ─── GET /tasks ────────────────────────────────────────────────────────────────

router.get("/tasks", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, priority, search } = req.query as Record<string, string | undefined>;

    let rows = await db
      .select()
      .from(tasksTable)
      .orderBy(desc(tasksTable.createdAt))
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

    const assigneeIds = [...new Set(rows.map((r) => r.assigneeId).filter(Boolean))] as number[];
    let assigneeMap: Record<number, string> = {};
    if (assigneeIds.length > 0) {
      const members = await db.select().from(teamMembersTable);
      assigneeMap = Object.fromEntries(members.map((m) => [m.id, m.name]));
    }

    res.json(
      rows.map((r) => ({
        ...r,
        assigneeName: r.assigneeId ? (assigneeMap[r.assigneeId] ?? null) : null,
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

    const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id)).limit(1);
    if (!task) { res.status(404).json({ error: "Task not found" }); return; }

    let assigneeName: string | null = null;
    if (task.assigneeId) {
      const [member] = await db
        .select()
        .from(teamMembersTable)
        .where(eq(teamMembersTable.id, task.assigneeId))
        .limit(1);
      assigneeName = member?.name ?? null;
    }

    res.json({ ...task, assigneeName });
  } catch (err) {
    logger.error({ err }, "GET /tasks/:id failed");
    res.status(500).json({ error: "Failed to load task" });
  }
});

// ─── POST /tasks ────────────────────────────────────────────────────────────────

router.post("/tasks", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { title, description, status, priority, assigneeId, customerName, dueDate, tags } = req.body as {
      title: string;
      description?: string;
      status?: string;
      priority?: string;
      assigneeId?: number;
      customerName?: string;
      dueDate?: string;
      tags?: string[];
    };

    if (!title?.trim()) {
      res.status(400).json({ error: "title diperlukan" });
      return;
    }

    const [task] = await db
      .insert(tasksTable)
      .values({
        title:        title.trim(),
        description:  description ?? null,
        status:       (status as typeof tasksTable.$inferInsert["status"]) ?? "pending",
        priority:     (priority as typeof tasksTable.$inferInsert["priority"]) ?? "medium",
        assigneeId:   assigneeId ?? null,
        customerName: customerName ?? null,
        dueDate:      dueDate ?? null,
        tags:         tags ?? [],
      })
      .returning();

    await db.insert(activityTable).values({
      type:        "task_created",
      description: `Task #${task.id} dibuat: ${task.title}`,
      entityId:    task.id,
    }).catch(() => {});

    emitSseEvent("task_created", { taskId: task.id }, "default");
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

    const [current] = await db.select().from(tasksTable).where(eq(tasksTable.id, id)).limit(1);
    if (!current) { res.status(404).json({ error: "Task not found" }); return; }

    const { status, priority, assigneeId, title, description, dueDate, tags } = req.body as {
      status?:      string;
      priority?:    string;
      assigneeId?:  number | null;
      title?:       string;
      description?: string;
      dueDate?:     string | null;
      tags?:        string[];
    };

    const updates: Partial<typeof tasksTable.$inferInsert> = {};
    if (status      !== undefined) updates.status      = status as typeof tasksTable.$inferInsert["status"];
    if (priority    !== undefined) updates.priority    = priority as typeof tasksTable.$inferInsert["priority"];
    if (assigneeId  !== undefined) updates.assigneeId  = assigneeId;
    if (title       !== undefined) updates.title       = title;
    if (description !== undefined) updates.description = description;
    if (dueDate     !== undefined) updates.dueDate     = dueDate;
    if (tags        !== undefined) updates.tags        = tags;

    const [updated] = await db
      .update(tasksTable)
      .set(updates)
      .where(eq(tasksTable.id, id))
      .returning();

    // ── Activity log ─────────────────────────────────────────────────────────
    const changes: string[] = [];
    if (status   && status   !== current.status)   changes.push(`status: ${current.status} → ${status}`);
    if (priority && priority !== current.priority) changes.push(`prioritas: ${current.priority} → ${priority}`);
    if (assigneeId !== undefined && assigneeId !== current.assigneeId) changes.push("assignee diubah");

    if (changes.length > 0) {
      await db.insert(activityTable).values({
        type:        "task_updated",
        description: `Task #${id} diperbarui — ${changes.join(", ")}`,
        entityId:    id,
      }).catch(() => {});
    }

    // ── WhatsApp notifications (fire-and-forget) ──────────────────────────────
    const companyId = getCompanyId(req) ?? "default";
    const taskNumber = `TASK-${String(id).padStart(4, "0")}`;

    if (status && status !== current.status) {
      notifyStatusChanged(
        {
          taskId:       id,
          taskNumber,
          title:        updated.title,
          customerName: updated.customerName,
          customerPhone: null,
          status:       status,
          priority:     updated.priority,
          companyId,
        },
        current.status,
      ).catch((err) => logger.error({ err }, "Notifikasi status change gagal"));
    }

    if (assigneeId && assigneeId !== current.assigneeId) {
      const [member] = await db
        .select()
        .from(teamMembersTable)
        .where(eq(teamMembersTable.id, assigneeId))
        .limit(1);

      notifyTaskAssigned(
        {
          taskId:       id,
          taskNumber,
          title:        updated.title,
          customerName: updated.customerName,
          customerPhone: null,
          assignedTo:   member?.name ?? null,
          status:       updated.status,
          priority:     updated.priority,
          companyId,
        },
        member?.phone ?? null,
      ).catch((err) => logger.error({ err }, "Notifikasi assign gagal"));
    }

    emitSseEvent("task_updated", { taskId: id }, "default");
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

    const [deleted] = await db.delete(tasksTable).where(eq(tasksTable.id, id)).returning();
    if (!deleted) { res.status(404).json({ error: "Task not found" }); return; }

    await db.insert(activityTable).values({
      type:        "task_deleted",
      description: `Task #${id} dihapus`,
      entityId:    id,
    }).catch(() => {});

    emitSseEvent("task_deleted", { taskId: id }, "default");
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

    const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id)).limit(1);
    if (!task) { res.status(404).json({ error: "Task not found" }); return; }

    const [member] = await db
      .select()
      .from(teamMembersTable)
      .where(eq(teamMembersTable.id, assigneeId))
      .limit(1);

    const [updated] = await db
      .update(tasksTable)
      .set({ assigneeId, status: "open" as typeof tasksTable.$inferInsert["status"] })
      .where(eq(tasksTable.id, id))
      .returning();

    notifyTaskAssigned(
      {
        taskId:       id,
        taskNumber:   `TASK-${String(id).padStart(4, "0")}`,
        title:        task.title,
        customerName: task.customerName,
        customerPhone: null,
        assignedTo:   member?.name ?? null,
        status:       "open",
        priority:     task.priority,
        companyId:    getCompanyId(req) ?? "default",
      },
      member?.phone ?? null,
    ).catch((err) => logger.error({ err }, "Notifikasi assign gagal"));

    emitSseEvent("task_updated", { taskId: id }, "default");
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
