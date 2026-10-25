import { Router, type IRouter, type Request, type Response } from "express";
import { desc, eq, inArray } from "drizzle-orm";
import { aiExecutionJobsTable, aiExecutionEventsTable, db } from "@workspace/db";
import { getCompanyId, requireAuth } from "../middleware/auth";
import { logger } from "../lib/logger";
import { projectUnifiedTimeline } from "../lib/unified-execution-timeline";

const router: IRouter = Router();

/** Read-only projection of AI Core and AI Task jobs. Never dispatch or claim work. */
router.get("/executions/unified-timeline", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const requested = Number(req.query.limit ?? 25);
    const limit = Number.isFinite(requested) ? Math.min(50, Math.max(1, Math.trunc(requested))) : 25;
    const company = getCompanyId(req);
    const jobs = await db.select().from(aiExecutionJobsTable)
      .where(company ? eq(aiExecutionJobsTable.companyId, company) : undefined)
      .orderBy(desc(aiExecutionJobsTable.createdAt))
      .limit(limit);
    const events = jobs.length ? await db.select().from(aiExecutionEventsTable)
      .where(inArray(aiExecutionEventsTable.executionId, jobs.map((job) => job.id)))
      .orderBy(desc(aiExecutionEventsTable.createdAt)).limit(limit * 80) : [];
    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      authority: "AI_CORE",
      dispatchEnabled: false,
      syncedAt: new Date().toISOString(),
      jobs: projectUnifiedTimeline(jobs, events),
    });
  } catch (err) {
    logger.error({ err }, "GET unified execution timeline failed");
    res.status(503).json({ error: "Timeline unavailable" });
  }
});

export default router;
