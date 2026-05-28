import { Router, type IRouter } from "express";
import { desc, eq, sql } from "drizzle-orm";
import { db, tasksTable, whatsappMessagesTable, documentsTable, teamMembersTable, activityTable, aiTasksTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/dashboard/stats", async (_req, res): Promise<void> => {
  const [
    [{ total: totalTasks, open: openTasks, completed: completedTasks, urgent: urgentTasks }],
    [{ total: totalMessages, pending: pendingMessages }],
    [{ total: totalDocuments, audited: auditedDocuments }],
    [{ total: teamSize }],
    [{ total: totalAiTasks, active: activeAiTasks }],
  ] = await Promise.all([
    db.select({
      total: sql<number>`count(*)::int`,
      open: sql<number>`count(*) filter (where status in ('pending','in_progress'))::int`,
      completed: sql<number>`count(*) filter (where status = 'completed')::int`,
      urgent: sql<number>`count(*) filter (where priority = 'urgent')::int`,
    }).from(tasksTable),

    db.select({
      total: sql<number>`count(*)::int`,
      pending: sql<number>`count(*) filter (where processed = false)::int`,
    }).from(whatsappMessagesTable),

    db.select({
      total: sql<number>`count(*)::int`,
      audited: sql<number>`count(*) filter (where status = 'audited')::int`,
    }).from(documentsTable),

    db.select({
      total: sql<number>`count(*)::int`,
    }).from(teamMembersTable),

    db.select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where status not in ('completed','cancelled'))::int`,
    }).from(aiTasksTable),
  ]);

  res.json({
    totalTasks,
    openTasks,
    completedTasks,
    urgentTasks,
    totalMessages,
    pendingMessages,
    totalDocuments,
    auditedDocuments,
    teamSize,
    totalAiTasks,
    activeAiTasks,
  });
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
