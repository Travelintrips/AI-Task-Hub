import { Router, type IRouter, type Request, type Response } from "express";
import { and, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { aiExecutionJobsTable, aiExecutionEventsTable, db } from "@workspace/db";
import { getCompanyId, requireAuth } from "../middleware/auth";
import { logger } from "../lib/logger";
import { projectUnifiedTimeline } from "../lib/unified-execution-timeline";
import { timelineSearchPattern } from "../lib/unified-timeline-search";

const router: IRouter = Router();

/** Read-only projection of AI Core and AI Task jobs. Never dispatch or claim work. */
router.get("/executions/unified-timeline", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const requested = Number(req.query.limit ?? 25);
    const limit = Number.isFinite(requested) ? Math.min(50, Math.max(1, Math.trunc(requested))) : 25;
    const requestedOffset = Number(req.query.offset ?? 0);
    const offset = Number.isSafeInteger(requestedOffset) && requestedOffset >= 0 && requestedOffset <= 5000
      ? requestedOffset : 0;
    const rawQuery = req.query.q;
    if (rawQuery !== undefined && (typeof rawQuery !== "string" || rawQuery.length > 120)) {
      res.status(400).json({ error: "Invalid timeline search" });
      return;
    }
    const pattern = timelineSearchPattern(typeof rawQuery === "string" ? rawQuery : "");
    const company = getCompanyId(req);
    const searchFilter = pattern ? or(
      ilike(aiExecutionJobsTable.source, pattern),
      ilike(aiExecutionJobsTable.externalId, pattern),
      ilike(aiExecutionJobsTable.status, pattern),
      ilike(aiExecutionJobsTable.workerId, pattern),
      ilike(aiExecutionJobsTable.assignedClientId, pattern),
      sql`CAST(${aiExecutionJobsTable.commandId} AS TEXT) ILIKE ${pattern}`,
      sql`CAST(${aiExecutionJobsTable.correlationId} AS TEXT) ILIKE ${pattern}`,
      sql`${aiExecutionJobsTable.metadata} ->> 'jobId' ILIKE ${pattern}`,
      sql`${aiExecutionJobsTable.metadata} ->> 'commandId' ILIKE ${pattern}`,
      sql`${aiExecutionJobsTable.metadata} ->> 'correlationId' ILIKE ${pattern}`,
      sql`COALESCE((
        SELECT e.status FROM ai_execution_events e
        WHERE e.execution_id = ${aiExecutionJobsTable.id} AND e.event_type = 'SOURCE_EVENT'
        ORDER BY e.created_at DESC, e.id DESC LIMIT 1
      ), '') ILIKE ${pattern}`,
      sql`EXISTS (
        SELECT 1 FROM ai_execution_events e
        WHERE e.execution_id = ${aiExecutionJobsTable.id}
          AND (e.payload ->> 'jobId' ILIKE ${pattern}
            OR e.payload ->> 'commandId' ILIKE ${pattern}
            OR e.payload ->> 'correlationId' ILIKE ${pattern}
            OR e.payload ->> 'workerId' ILIKE ${pattern})
      )`,
    ) : undefined;
    const companyFilter = and(
      company ? eq(aiExecutionJobsTable.companyId, company) : undefined,
      searchFilter,
    );
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
