import { Router, type IRouter, type Request, type Response } from "express";
import { count, eq, desc, sql, inArray, notInArray } from "drizzle-orm";
import {
  db,
  aiTasksTable,
  whatsappMessagesTable,
  documentsTable,
  teamMembersTable,
  auditLogsTable,
  AI_TASK_TERMINAL_STATUS_VARIANTS,
  getAiTaskStatusVariants,
  normalizeAiTaskStatus,
} from "@workspace/db";
import { requireAuth, getCompanyId } from "../middleware/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ─── GET /dashboard/stats ─────────────────────────────────────────────────────

router.get("/dashboard/stats", requireAuth, async (_req: Request, res: Response): Promise<void> => {
  try {
    const [totalTasks] = await db.select({ count: count() }).from(aiTasksTable);
    const [pendingTasks] = await db.select({ count: count() }).from(aiTasksTable).where(notInArray(aiTasksTable.status, AI_TASK_TERMINAL_STATUS_VARIANTS));
    const [completedTasks] = await db.select({ count: count() }).from(aiTasksTable).where(inArray(aiTasksTable.status, getAiTaskStatusVariants("completed")));
    const [urgentTasks] = await db.select({ count: count() }).from(aiTasksTable).where(eq(aiTasksTable.priority, "urgent"));

    const [activeAiTasks] = await db.select({ count: count() }).from(aiTasksTable).where(notInArray(aiTasksTable.status, AI_TASK_TERMINAL_STATUS_VARIANTS));

    const [totalMessages] = await db.select({ count: count() }).from(whatsappMessagesTable);
    const [pendingMessages] = await db.select({ count: count() }).from(whatsappMessagesTable).where(eq(whatsappMessagesTable.processed, false));

    const [totalDocuments] = await db.select({ count: count() }).from(documentsTable);
    const [auditedDocuments] = await db.select({ count: count() }).from(documentsTable).where(eq(documentsTable.status, "audited"));

    const [teamSize] = await db.select({ count: count() }).from(teamMembersTable);

    res.json({
      totalTasks:       totalTasks.count,
      openTasks:        pendingTasks.count,
      completedTasks:   completedTasks.count,
      urgentTasks:      urgentTasks.count,
      totalMessages:    totalMessages.count,
      pendingMessages:  pendingMessages.count,
      totalDocuments:   totalDocuments.count,
      auditedDocuments: auditedDocuments.count,
      teamSize:         teamSize.count,
      totalAiTasks:     totalTasks.count,
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
      .from(auditLogsTable)
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(20);

    res.json(
      rows.map((r, i) => ({
        id:          r.id ?? i + 1,
        type:        r.action,
        description: r.before ?? "",
        entityId:    r.entityId,
        createdAt:   r.createdAt.toISOString(),
      })),
    );
  } catch (err) {
    logger.error({ err }, "GET /dashboard/activity failed");
    res.status(500).json({ error: "Failed to load activity" });
  }
});

// ─── GET /dashboard/analytics ─────────────────────────────────────────────────

router.get("/dashboard/analytics", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req);
    const companyFilter = companyId
      ? sql`WHERE company_id = ${companyId}`
      : sql`WHERE 1=1`;

    // 1. Tren tugas bulanan — 6 bulan terakhir
    const monthlyTrend = await db.execute(sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', created_at), 'Mon YY') AS month,
        DATE_TRUNC('month', created_at) AS month_date,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE LOWER(REPLACE(status, ' ', '_')) IN ('completed', 'done', 'paid')) AS completed,
        COUNT(*) FILTER (WHERE LOWER(REPLACE(status, ' ', '_')) NOT IN ('completed', 'done', 'paid', 'cancelled', 'canceled')) AS active
      FROM ai_tasks
      ${companyFilter}
        AND created_at >= NOW() - INTERVAL '6 months'
      GROUP BY month_date, month
      ORDER BY month_date ASC
    `);

    // 2. Distribusi per kategori
    const byCategory = await db.execute(sql`
      SELECT
        COALESCE(category, 'Lainnya') AS name,
        COUNT(*) AS value
      FROM ai_tasks
      ${companyFilter}
      GROUP BY category
      ORDER BY value DESC
      LIMIT 10
    `);

    // 3. Distribusi per divisi
    const byDivision = await db.execute(sql`
      SELECT
        COALESCE(division, 'Belum Ditentukan') AS name,
        COUNT(*) AS value
      FROM ai_tasks
      ${companyFilter}
      GROUP BY division
      ORDER BY value DESC
      LIMIT 10
    `);

    // 4. Performa per anggota tim
    const teamPerformance = await db.execute(sql`
      SELECT
        COALESCE(assigned_to, 'Belum Diassign') AS name,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE LOWER(REPLACE(status, ' ', '_')) IN ('completed', 'done', 'paid')) AS completed,
        COUNT(*) FILTER (WHERE LOWER(REPLACE(status, ' ', '_')) NOT IN ('completed', 'done', 'paid', 'cancelled', 'canceled')) AS active,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE LOWER(REPLACE(status, ' ', '_')) IN ('completed', 'done', 'paid')) / NULLIF(COUNT(*), 0)
        ) AS completion_rate
      FROM ai_tasks
      ${companyFilter}
        AND assigned_to IS NOT NULL
      GROUP BY assigned_to
      ORDER BY total DESC
      LIMIT 10
    `);

    // 5. Distribusi status saat ini
    const byStatus = await db.execute(sql`
      SELECT
        status AS name,
        COUNT(*) AS value
      FROM ai_tasks
      ${companyFilter}
      GROUP BY status
      ORDER BY value DESC
    `);

    // Merge legacy/display values into the canonical ai_tasks status vocabulary.
    const canonicalStatusCounts = new Map<string, number>();
    for (const row of byStatus.rows as Array<{ name: unknown; value: unknown }>) {
      const rawName = String(row.name ?? "unknown");
      const name = normalizeAiTaskStatus(rawName) ?? rawName;
      canonicalStatusCounts.set(name, (canonicalStatusCounts.get(name) ?? 0) + Number(row.value ?? 0));
    }
    const canonicalByStatus = Array.from(canonicalStatusCounts, ([name, value]) => ({ name, value }));

    // 6. Distribusi prioritas
    const byPriority = await db.execute(sql`
      SELECT
        priority AS name,
        COUNT(*) AS value
      FROM ai_tasks
      ${companyFilter}
      GROUP BY priority
      ORDER BY value DESC
    `);

    // 7. Tren pesan WhatsApp masuk — 6 bulan terakhir
    const messageTrend = await db.execute(sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', created_at), 'Mon YY') AS month,
        DATE_TRUNC('month', created_at) AS month_date,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE processed = true) AS processed
      FROM whatsapp_messages
      WHERE created_at >= NOW() - INTERVAL '6 months'
      GROUP BY month_date, month
      ORDER BY month_date ASC
    `);

    // 8. Ringkasan cepat — bulan ini vs bulan lalu
    const thisMonthResult = await db.execute(sql`
      SELECT
        COUNT(*) AS new_tasks,
        COUNT(*) FILTER (WHERE LOWER(REPLACE(status, ' ', '_')) IN ('completed', 'done', 'paid')) AS completed
      FROM ai_tasks
      ${companyFilter}
        AND created_at >= DATE_TRUNC('month', NOW())
    `);
    const thisMonth = thisMonthResult.rows[0];

    const lastMonthResult = await db.execute(sql`
      SELECT
        COUNT(*) AS new_tasks,
        COUNT(*) FILTER (WHERE LOWER(REPLACE(status, ' ', '_')) IN ('completed', 'done', 'paid')) AS completed
      FROM ai_tasks
      ${companyFilter}
        AND created_at >= DATE_TRUNC('month', NOW() - INTERVAL '1 month')
        AND created_at < DATE_TRUNC('month', NOW())
    `);
    const lastMonth = lastMonthResult.rows[0];

    res.json({
      monthlyTrend:    monthlyTrend.rows,
      byCategory:      byCategory.rows,
      byDivision:      byDivision.rows,
      teamPerformance: teamPerformance.rows,
      byStatus:        canonicalByStatus,
      byPriority:      byPriority.rows,
      messageTrend:    messageTrend.rows,
      summary: {
        thisMonth: thisMonth,
        lastMonth: lastMonth,
      },
    });
  } catch (err) {
    logger.error({ err }, "GET /dashboard/analytics failed");
    res.status(500).json({ error: "Failed to load analytics" });
  }
});

export default router;
