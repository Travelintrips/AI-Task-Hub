import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, desc, gte, lte, count, sql } from "drizzle-orm";
import { db, aiTasksTable, customersTable, usersTable, followUpLogsTable, quotationsTable } from "@workspace/db";
import { requireAuth, getCompanyId } from "../middleware/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// GET /api/reports/overview
router.get("/reports/overview", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? req.user!.companyId;
    const { from, to } = req.query as Record<string, string>;
    const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const toDate = to ? new Date(to) : new Date();

    const tasks = await db.select().from(aiTasksTable).where(
      and(eq(aiTasksTable.companyId, companyId), gte(aiTasksTable.createdAt, fromDate), lte(aiTasksTable.createdAt, toDate))
    );

    const totalInquiry = tasks.length;
    const completedTask = tasks.filter((t) => t.status === "completed").length;
    const overdueTask = tasks.filter((t) => t.slaStatus === "overdue").length;
    const inProgressTask = tasks.filter((t) => !["completed", "cancelled"].includes(t.status)).length;

    const byStatus = Object.entries(
      tasks.reduce((acc, t) => { acc[t.status] = (acc[t.status] ?? 0) + 1; return acc; }, {} as Record<string, number>)
    ).map(([name, value]) => ({ name, value }));

    const byCategory = Object.entries(
      tasks.reduce((acc, t) => { const k = t.category ?? "Lainnya"; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {} as Record<string, number>)
    ).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

    const byPriority = Object.entries(
      tasks.reduce((acc, t) => { acc[t.priority] = (acc[t.priority] ?? 0) + 1; return acc; }, {} as Record<string, number>)
    ).map(([name, value]) => ({ name, value }));

    // SLA compliance
    const slaCompliance = totalInquiry > 0 ? Math.round(((totalInquiry - overdueTask) / totalInquiry) * 100) : 100;

    // Monthly trend
    const monthly: Record<string, { total: number; completed: number }> = {};
    for (const t of tasks) {
      const key = t.createdAt.toISOString().slice(0, 7);
      if (!monthly[key]) monthly[key] = { total: 0, completed: 0 };
      monthly[key].total++;
      if (t.status === "completed") monthly[key].completed++;
    }
    const monthlyTrend = Object.entries(monthly).sort().map(([month, v]) => ({ month, ...v }));

    res.json({ totalInquiry, completedTask, overdueTask, inProgressTask, slaCompliance, byStatus, byCategory, byPriority, monthlyTrend });
  } catch (err) {
    logger.error({ err }, "GET /reports/overview failed");
    res.status(500).json({ error: "Failed to load report" });
  }
});

// GET /api/reports/team
router.get("/reports/team", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? req.user!.companyId;
    const { from, to } = req.query as Record<string, string>;
    const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const toDate = to ? new Date(to) : new Date();

    const tasks = await db.select().from(aiTasksTable).where(
      and(eq(aiTasksTable.companyId, companyId), gte(aiTasksTable.createdAt, fromDate), lte(aiTasksTable.createdAt, toDate))
    );

    const staffMap: Record<string, { name: string; total: number; completed: number; active: number }> = {};
    for (const t of tasks) {
      const name = t.assignedTo ?? "Belum Ditugaskan";
      if (!staffMap[name]) staffMap[name] = { name, total: 0, completed: 0, active: 0 };
      staffMap[name].total++;
      if (t.status === "completed") staffMap[name].completed++;
      else staffMap[name].active++;
    }

    const teamPerformance = Object.values(staffMap).map((s) => ({
      ...s,
      completionRate: s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0,
    })).sort((a, b) => b.total - a.total);

    res.json({ teamPerformance });
  } catch (err) {
    logger.error({ err }, "GET /reports/team failed");
    res.status(500).json({ error: "Failed to load team report" });
  }
});

// GET /api/reports/ai
router.get("/reports/ai", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? req.user!.companyId;
    const { from, to } = req.query as Record<string, string>;
    const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const toDate = to ? new Date(to) : new Date();

    const tasks = await db.select().from(aiTasksTable).where(
      and(eq(aiTasksTable.companyId, companyId), gte(aiTasksTable.createdAt, fromDate), lte(aiTasksTable.createdAt, toDate))
    );

    const aiCreatedTasks = tasks.filter((t) => t.source === "whatsapp").length;
    const aiSummaryGenerated = tasks.filter((t) => !!t.aiSummary).length;

    const followUps = await db.select().from(followUpLogsTable).where(
      and(eq(followUpLogsTable.companyId, companyId), gte(followUpLogsTable.sentAt, fromDate), lte(followUpLogsTable.sentAt, toDate))
    );

    res.json({ aiCreatedTasks, aiSummaryGenerated, aiFollowUpSent: followUps.length, aiFollowUpSuccess: followUps.filter((f) => f.isSuccess).length });
  } catch (err) {
    logger.error({ err }, "GET /reports/ai failed");
    res.status(500).json({ error: "Failed to load AI report" });
  }
});

// GET /api/reports/customers
router.get("/reports/customers", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? req.user!.companyId;
    const { from, to } = req.query as Record<string, string>;
    const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const toDate = to ? new Date(to) : new Date();

    const newCustomers = await db.select().from(customersTable).where(
      and(eq(customersTable.companyId, companyId), gte(customersTable.createdAt, fromDate), lte(customersTable.createdAt, toDate))
    );

    const allCustomers = await db.select().from(customersTable).where(eq(customersTable.companyId, companyId));
    const repeatCustomers = allCustomers.filter((c) => (c.totalTasks ?? 0) > 1).length;

    res.json({ newCustomers: newCustomers.length, repeatCustomers, totalCustomers: allCustomers.length });
  } catch (err) {
    logger.error({ err }, "GET /reports/customers failed");
    res.status(500).json({ error: "Failed to load customer report" });
  }
});

export default router;
