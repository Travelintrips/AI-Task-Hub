import { Router, type IRouter, type Request, type Response } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, aiTasksTable, aiExecutionJobsTable } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const route = "/integrations/oc-dev/task/183";
const authorized = (req: Request): boolean => {
  if (process.env.APP_ENV !== "development" || process.env.NODE_ENV !== "development") return false;
  const expected = process.env.OC_DEV_TASK183_READER_SHA256?.trim().toLowerCase();
  if (!expected || !/^[a-f0-9]{64}$/.test(expected)) return false;
  const supplied = req.headers["authorization"];
  if (typeof supplied !== "string" || !supplied.startsWith("Bearer ")) return false;
  const token = supplied.slice(7).trim();
  if (token.length < 32 || token.length > 512) return false;
  const actual = createHash("sha256").update(token).digest();
  const expectedBuffer = Buffer.from(expected, "hex");
  return timingSafeEqual(actual, expectedBuffer);
};

router.all(route, async (req: Request, res: Response): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  if (process.env.APP_ENV !== "development" || process.env.NODE_ENV !== "development") {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (!authorized(req)) {
    logger.warn({ event: "OC_TASK183_READ_DENIED", method: req.method }, "OC DEV reader denied");
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (req.method !== "GET") {
    logger.warn({ event: "OC_TASK183_METHOD_DENIED", method: req.method }, "OC DEV reader method denied");
    res.status(405).setHeader("Allow", "GET").json({ error: "Method not allowed" });
    return;
  }
  try {
    const [task] = await db.select({
      id: aiTasksTable.id, companyId: aiTasksTable.companyId,
      taskNumber: aiTasksTable.taskNumber, title: aiTasksTable.title,
      status: aiTasksTable.status, assignedTo: aiTasksTable.assignedTo,
      assignedToId: aiTasksTable.assignedToId,
    }).from(aiTasksTable)
      .where(and(eq(aiTasksTable.id, 183), eq(aiTasksTable.companyId, "default"))).limit(1);
    if (!task) { res.status(404).json({ error: "Task not found" }); return; }
    const jobs = await db.select({ id: aiExecutionJobsTable.id, status: aiExecutionJobsTable.status })
      .from(aiExecutionJobsTable)
      .where(and(eq(aiExecutionJobsTable.taskId, 183), eq(aiExecutionJobsTable.companyId, "default"))).limit(10);
    logger.info({ event: "OC_TASK183_READ_OK", taskId: 183, jobCount: jobs.length }, "OC DEV read-only task view");
    res.json({ environment: "CST-DEV", scope: "task:183:read", task, jobs });
  } catch (error) {
    logger.error({ event: "OC_TASK183_READ_FAILED", error }, "OC DEV task read failed");
    res.status(503).json({ error: "Read unavailable" });
  }
});
export default router;
