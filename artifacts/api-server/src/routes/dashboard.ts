import { Router, type IRouter } from "express";
import { desc } from "drizzle-orm";
import { db, tasksTable, whatsappMessagesTable, documentsTable, teamMembersTable, activityTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/dashboard/stats", async (_req, res): Promise<void> => {
  const [tasks, messages, documents, members] = await Promise.all([
    db.select().from(tasksTable),
    db.select().from(whatsappMessagesTable),
    db.select().from(documentsTable),
    db.select().from(teamMembersTable),
  ]);

  const stats = {
    totalTasks: tasks.length,
    openTasks: tasks.filter((t) => t.status === "pending" || t.status === "in_progress").length,
    completedTasks: tasks.filter((t) => t.status === "completed").length,
    urgentTasks: tasks.filter((t) => t.priority === "urgent").length,
    totalMessages: messages.length,
    pendingMessages: messages.filter((m) => !m.processed).length,
    totalDocuments: documents.length,
    auditedDocuments: documents.filter((d) => d.status === "audited").length,
    teamSize: members.length,
  };

  res.json(stats);
});

router.get("/dashboard/activity", async (_req, res): Promise<void> => {
  const activity = await db
    .select()
    .from(activityTable)
    .orderBy(desc(activityTable.createdAt))
    .limit(20);

  res.json(
    activity.map((a) => ({
      ...a,
      createdAt: a.createdAt.toISOString(),
    }))
  );
});

export default router;
