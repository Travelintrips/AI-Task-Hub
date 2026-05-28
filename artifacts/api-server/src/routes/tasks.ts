import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc } from "drizzle-orm";
import { db, tasksTable, activityTable } from "@workspace/db";
import { requireAuth, getCompanyId } from "../middleware/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function mapTask(r: typeof tasksTable.$inferSelect) {
  return {
    id:              r.id,
    title:           r.title,
    description:     r.description,
    status:          r.status,
    priority:        r.priority,
    assigneeId:      r.assigneeId,
    assigneeName:    null as string | null,
    customerName:    r.customerName,
    assignedRole:    r.assignedRole,
    assignedDivision: r.assignedDivision,
    assignedVendor:  r.assignedVendor,
    sourceMessageId: r.sourceMessageId,
    tags:            r.tags,
    dueDate:         r.dueDate ?? null,
    createdAt:       r.createdAt.toISOString(),
    updatedAt:       r.updatedAt.toISOString(),
  };
}

// ─── GET /tasks ───────────────────────────────────────────────────────────────

router.get("/tasks", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { status } = req.query as Record<string, string | undefined>;

    const rows = await db
      .select()
      .from(tasksTable)
      .orderBy(desc(tasksTable.createdAt))
      .limit(300);

    let mapped = rows.map(mapTask);
    if (status) mapped = mapped.filter((t) => t.status === status);

    res.json(mapped);
  } catch (err) {
    logger.error({ err }, "GET /tasks failed");
    res.status(500).json({ error: "Failed to load tasks" });
  }
});

// ─── GET /tasks/:id ───────────────────────────────────────────────────────────

router.get("/tasks/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [row] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, id))
      .limit(1);

    if (!row) { res.status(404).json({ error: "Task not found" }); return; }

    res.json(mapTask(row));
  } catch (err) {
    logger.error({ err }, "GET /tasks/:id failed");
    res.status(500).json({ error: "Failed to load task" });
  }
});

// ─── POST /tasks ──────────────────────────────────────────────────────────────

router.post("/tasks", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { title, description, status, priority, assigneeId, customerName,
            assignedRole, assignedDivision, assignedVendor, sourceMessageId,
            tags, dueDate } = req.body as Record<string, unknown>;

    if (!title) { res.status(400).json({ error: "title is required" }); return; }

    const [task] = await db.insert(tasksTable).values({
      title: String(title),
      description: description ? String(description) : undefined,
      status: status ? String(status) : "pending",
      priority: priority ? String(priority) : "medium",
      assigneeId: assigneeId ? Number(assigneeId) : undefined,
      customerName: customerName ? String(customerName) : undefined,
      assignedRole: assignedRole ? String(assignedRole) : undefined,
      assignedDivision: assignedDivision ? String(assignedDivision) : undefined,
      assignedVendor: assignedVendor ? String(assignedVendor) : undefined,
      sourceMessageId: sourceMessageId ? Number(sourceMessageId) : undefined,
      tags: Array.isArray(tags) ? (tags as string[]) : [],
      dueDate: dueDate ? String(dueDate) : undefined,
    }).returning();

    await db.insert(activityTable).values({
      type: "task_created",
      description: `Task "${task.title}" dibuat`,
      entityId: task.id,
    });

    res.status(201).json(mapTask(task));
  } catch (err) {
    logger.error({ err }, "POST /tasks failed");
    res.status(500).json({ error: "Failed to create task" });
  }
});

// ─── PATCH /tasks/:id ─────────────────────────────────────────────────────────

router.patch("/tasks/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const body = req.body as Record<string, unknown>;
    const updates: Partial<typeof tasksTable.$inferInsert> = {};

    if (body.title != null)           updates.title = String(body.title);
    if (body.description != null)     updates.description = String(body.description);
    if (body.status != null)          updates.status = String(body.status);
    if (body.priority != null)        updates.priority = String(body.priority);
    if (body.assigneeId != null)      updates.assigneeId = Number(body.assigneeId);
    if (body.customerName != null)    updates.customerName = String(body.customerName);
    if (body.assignedRole != null)    updates.assignedRole = String(body.assignedRole);
    if (body.assignedDivision != null) updates.assignedDivision = String(body.assignedDivision);
    if (body.assignedVendor != null)  updates.assignedVendor = String(body.assignedVendor);
    if (body.dueDate != null)         updates.dueDate = String(body.dueDate);
    if (Array.isArray(body.tags))     updates.tags = body.tags as string[];

    const [updated] = await db
      .update(tasksTable)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(tasksTable.id, id))
      .returning();

    if (!updated) { res.status(404).json({ error: "Task not found" }); return; }

    res.json(mapTask(updated));
  } catch (err) {
    logger.error({ err }, "PATCH /tasks/:id failed");
    res.status(500).json({ error: "Failed to update task" });
  }
});

// ─── DELETE /tasks/:id ────────────────────────────────────────────────────────

router.delete("/tasks/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [deleted] = await db
      .delete(tasksTable)
      .where(eq(tasksTable.id, id))
      .returning();

    if (!deleted) { res.status(404).json({ error: "Task not found" }); return; }

    res.sendStatus(204);
  } catch (err) {
    logger.error({ err }, "DELETE /tasks/:id failed");
    res.status(500).json({ error: "Failed to delete task" });
  }
});

// ─── PATCH /tasks/:id/assign ──────────────────────────────────────────────────

router.patch("/tasks/:id/assign", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const { assigneeId } = req.body as { assigneeId?: number };

    const [updated] = await db
      .update(tasksTable)
      .set({ assigneeId: assigneeId ?? null, updatedAt: new Date() })
      .where(eq(tasksTable.id, id))
      .returning();

    if (!updated) { res.status(404).json({ error: "Task not found" }); return; }

    res.json(mapTask(updated));
  } catch (err) {
    logger.error({ err }, "PATCH /tasks/:id/assign failed");
    res.status(500).json({ error: "Failed to assign task" });
  }
});

// ─── POST /tasks/:id/ai-summary ───────────────────────────────────────────────

router.post("/tasks/:id/ai-summary", requireAuth, (_req: Request, res: Response): void => {
  res.status(501).json({ error: "AI summary not implemented" });
});

export default router;
