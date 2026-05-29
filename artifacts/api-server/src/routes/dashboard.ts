import { Router, type IRouter, type Request, type Response } from "express";
import { count, eq, ne, desc } from "drizzle-orm";
import {
  db,
  tasksTable,
  aiTasksTable,
  whatsappMessagesTable,
  documentsTable,
  teamMembersTable,
  activityTable,
} from "@workspace/db";
import { requireAuth } from "../middleware/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ─── GET /dashboard/stats ─────────────────────────────────────────────────────

router.get("/dashboard/stats", requireAuth, async (_req: Request, res: Response): Promise<void> => {
  try {
    const [totalTasks] = await db
      .select({ count: count() })
      .from(tasksTable);

    const [openTasks] = await db
      .select({ count: count() })
      .from(tasksTable)
      .where(eq(tasksTable.status, "open"));

    const [completedTasks] = await db
      .select({ count: count() })
      .from(tasksTable)
      .where(eq(tasksTable.status, "completed"));

    const [urgentTasks] = await db
      .select({ count: count() })
      .from(tasksTable)
      .where(eq(tasksTable.priority, "urgent"));

    const [totalAiTasks] = await db
      .select({ count: count() })
      .from(aiTasksTable);

    const [activeAiTasks] = await db
      .select({ count: count() })
      .from(aiTasksTable)
      .where(ne(aiTasksTable.status, "completed"));

    const [totalMessages] = await db
      .select({ count: count() })
      .from(whatsappMessagesTable);

    const [pendingMessages] = await db
      .select({ count: count() })
      .from(whatsappMessagesTable)
      .where(eq(whatsappMessagesTable.processed, false));

    const [totalDocuments] = await db
      .select({ count: count() })
      .from(documentsTable);

    const [auditedDocuments] = await db
      .select({ count: count() })
      .from(documentsTable)
      .where(eq(documentsTable.status, "audited"));

    const [teamSize] = await db
      .select({ count: count() })
      .from(teamMembersTable);

    res.json({
      totalTasks:       totalTasks.count,
      openTasks:        openTasks.count,
      completedTasks:   completedTasks.count,
      urgentTasks:      urgentTasks.count,
      totalMessages:    totalMessages.count,
      pendingMessages:  pendingMessages.count,
      totalDocuments:   totalDocuments.count,
      auditedDocuments: auditedDocuments.count,
      teamSize:         teamSize.count,
      totalAiTasks:     totalAiTasks.count,
      activeAiTasks:    activeAiTasks.count,
    });
  } catch (err) {
    logger.error({ err }, "GET /dashboard/stats failed");
    res.status(500).json({ error: "Failed to load stats" });
  }
});

// ─── GET /dashboard/activity ──────────────────────────────────────────────────

router.get("/dashboard/activity", requireAuth, async (_req: Request, res: Response): Promise<void> => {
  try {
    const rows = await db
      .select()
      .from(activityTable)
      .orderBy(desc(activityTable.createdAt))
      .limit(20);

    res.json(
      rows.map((r, i) => ({
        id:          r.id ?? i + 1,
        type:        r.type,
        description: r.description,
        entityId:    r.entityId,
        createdAt:   r.createdAt.toISOString(),
      })),
    );
  } catch (err) {
    logger.error({ err }, "GET /dashboard/activity failed");
    res.status(500).json({ error: "Failed to load activity" });
  }
});

export default router;
