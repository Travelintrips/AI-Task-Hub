import { Router, type IRouter, type Request, type Response } from "express";
import { count, desc, eq, inArray } from "drizzle-orm";
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
    const requestedOffset = Number(req.query.offset ?? 0);
    const offset = Number.isSafeInteger(requestedOffset) && requestedOffset >= 0 && requestedOffset <= 5000
      ? requestedOffset : 0;
    const company = getCompanyId(req);
    const companyFilter = company ? eq(aiExecutionJobsTable.companyId, company) : undefined;
    const [[totals], jobs] = await Promise.all([
      db.select({ total: count() }).from(aiExecutionJobsTable).where(companyFilter),
      db.select().from(aiExecutionJobsTable)
        .where(companyFilter)
        .orderBy(desc(aiExecutionJobsTable.createdAt), desc(aiExecutionJobsTable.id))
        .limit(limit).offset(offset),
    ]);
    const events = jobs.length ? await db.select().from(aiExecutionEventsTable)
      .where(inArray(aiExecutionEventsTable.executionId, jobs.map((job) => job.id)))
      .orderBy(desc(aiExecutionEventsTable.createdAt)).limit(limit * 80) : [];
    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      authority: "AI_CORE",
      dispatchEnabled: false,
      syncedAt: new Date().toISOString(),
      paging: { limit, offset, total: totals?.total ?? 0 },
      jobs: projectUnifiedTimeline(jobs, events),
    });
  } catch (err) {
    logger.error({ err }, "GET unified execution timeline failed");
    res.status(503).json({ error: "Timeline unavailable" });
  }
});

export default router;
