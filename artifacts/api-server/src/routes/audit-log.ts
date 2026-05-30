import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, desc, gte, lte, ilike } from "drizzle-orm";
import { db, auditLogsTable } from "@workspace/db";
import { requireAuth, getCompanyId } from "../middleware/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// GET /api/audit-logs
router.get("/audit-logs", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? req.user!.companyId;
    const { module, userId, from, to, action } = req.query as Record<string, string | undefined>;
    const limit = Math.min(parseInt((req.query.limit as string) ?? "100", 10), 500);

    let rows = await db.select().from(auditLogsTable)
      .where(eq(auditLogsTable.companyId, companyId))
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(limit);

    if (module) rows = rows.filter((r) => r.module === module);
    if (userId) rows = rows.filter((r) => r.userId === Number(userId));
    if (action) rows = rows.filter((r) => r.action?.toLowerCase().includes(action.toLowerCase()));
    if (from) { const d = new Date(from); rows = rows.filter((r) => r.createdAt >= d); }
    if (to) { const d = new Date(to); d.setHours(23,59,59,999); rows = rows.filter((r) => r.createdAt <= d); }

    res.json(rows);
  } catch (err) {
    logger.error({ err }, "GET /audit-logs failed");
    res.status(500).json({ error: "Failed to load audit logs" });
  }
});

// POST /api/audit-logs (internal use)
router.post("/audit-logs", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? req.user!.companyId;
    const { action, module, entityId, entityType, before, after } = req.body as Record<string, unknown>;
    if (!action || !module) { res.status(400).json({ error: "action and module required" }); return; }

    const [log] = await db.insert(auditLogsTable).values({
      companyId,
      userId: req.user?.id ?? null,
      userName: req.user?.name ?? null,
      userEmail: req.user?.email ?? null,
      action: String(action),
      module: String(module),
      entityId: entityId ? Number(entityId) : null,
      entityType: entityType ? String(entityType) : null,
      before: before ? JSON.stringify(before) : null,
      after: after ? JSON.stringify(after) : null,
      ipAddress: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
    }).returning();

    res.status(201).json(log);
  } catch (err) {
    logger.error({ err }, "POST /audit-logs failed");
    res.status(500).json({ error: "Failed to write audit log" });
  }
});

export default router;
