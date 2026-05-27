import { Router, type IRouter } from "express";
import { eq, desc, ilike, and, or } from "drizzle-orm";
import { db, aiTasksTable, taskCommentsTable, activityTable } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ─── GET /ai-tasks ────────────────────────────────────────────────────────────

router.get("/ai-tasks", async (req, res): Promise<void> => {
  try {
    const { status, category, priority, search, companyId } = req.query as Record<string, string>;

    const conditions = [];

    if (companyId) conditions.push(eq(aiTasksTable.companyId, companyId));
    if (status)    conditions.push(eq(aiTasksTable.status, status));
    if (category)  conditions.push(eq(aiTasksTable.category, category));
    if (priority)  conditions.push(eq(aiTasksTable.priority, priority));

    const rows = await db
      .select()
      .from(aiTasksTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(aiTasksTable.createdAt));

    // Apply search client-side (simpler than SQL ILIKE on multiple cols)
    const q = search?.toLowerCase().trim();
    const filtered = q
      ? rows.filter(
          (t) =>
            t.title.toLowerCase().includes(q) ||
            (t.customerName ?? "").toLowerCase().includes(q) ||
            (t.taskNumber ?? "").toLowerCase().includes(q) ||
            (t.aiSummary ?? "").toLowerCase().includes(q),
        )
      : rows;

    res.json(
      filtered.map((t) => ({
        ...t,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
        dueDate: t.dueDate ? t.dueDate.toISOString() : null,
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

export default router;
