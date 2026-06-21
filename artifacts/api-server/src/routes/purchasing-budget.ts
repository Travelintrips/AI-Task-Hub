/**
 * Sprint 6B — Budget Tracker
 *
 * GET  /api/purchasing/budget/summary          — budget overview current month
 * GET  /api/purchasing/requests/:id/budget-impact — impact of specific request
 * POST /api/purchasing/budget/refresh          — refresh from Supabase sources
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  purchasingBudgetTrackerTable,
  logisticPurchaseRequestsTable,
  auditLogsTable,
} from "@workspace/db/schema";
import { requireAuth, requireRole } from "../middleware/auth";
import { logger } from "../lib/logger";
import { eq, and, sql, desc } from "drizzle-orm";
import { refreshBudgetTracker, scoreBudgetImpact } from "../lib/purchasing-engine";

const router: IRouter = Router();
function cid(req: Request): string { return req.user?.companyId ?? "default"; }

// ── GET /api/purchasing/budget/summary ────────────────────────────────────────

router.get("/purchasing/budget/summary", requireAuth, requireRole("supervisor"), async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const now = new Date();
    const year = parseInt((req.query.year as string) || String(now.getFullYear()));
    const month = parseInt((req.query.month as string) || String(now.getMonth() + 1));

    const rows = await db
      .select()
      .from(purchasingBudgetTrackerTable)
      .where(and(
        eq(purchasingBudgetTrackerTable.companyId, companyId),
        eq(purchasingBudgetTrackerTable.periodYear, year),
        eq(purchasingBudgetTrackerTable.periodMonth, month),
      ))
      .orderBy(desc(purchasingBudgetTrackerTable.budgetAllocated));

    // Aggregated totals
    const totals = rows.reduce((acc, r) => ({
      budgetAllocated: acc.budgetAllocated + (r.budgetAllocated ?? 0),
      budgetUsed: acc.budgetUsed + (r.budgetUsed ?? 0),
      budgetPending: acc.budgetPending + (r.budgetPending ?? 0),
      budgetRemaining: acc.budgetRemaining + (r.budgetRemaining ?? 0),
    }), { budgetAllocated: 0, budgetUsed: 0, budgetPending: 0, budgetRemaining: 0 });

    const utilizationPct = totals.budgetAllocated > 0
      ? ((totals.budgetUsed + totals.budgetPending) / totals.budgetAllocated) * 100
      : 0;

    return res.json({
      year, month,
      categories: rows,
      totals: { ...totals, utilizationPct: Math.round(utilizationPct) },
    });
  } catch (err) {
    logger.error({ err }, "GET /api/purchasing/budget/summary failed");
    return res.status(500).json({ error: "Gagal memuat budget summary" });
  }
});

// ── GET /api/purchasing/requests/:id/budget-impact ────────────────────────────

router.get("/purchasing/requests/:id/budget-impact", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const [lpr] = await db
      .select()
      .from(logisticPurchaseRequestsTable)
      .where(and(
        eq(logisticPurchaseRequestsTable.id, parseInt(req.params.id as string)),
        eq(logisticPurchaseRequestsTable.companyId, companyId),
      ));
    if (!lpr) return res.status(404).json({ error: "Request tidak ditemukan" });

    const now = new Date();
    const result = await scoreBudgetImpact({
      companyId,
      serviceCategory: lpr.serviceCategory,
      estimatedAmount: lpr.estimatedAmount ?? 0,
      periodYear: now.getFullYear(),
      periodMonth: now.getMonth() + 1,
      excludeRequestId: lpr.id,
    });

    return res.json({ budgetImpact: result });
  } catch (err) {
    logger.error({ err }, "GET /api/purchasing/requests/:id/budget-impact failed");
    return res.status(500).json({ error: "Gagal menghitung budget impact" });
  }
});

// ── POST /api/purchasing/budget/refresh ───────────────────────────────────────

router.post("/purchasing/budget/refresh", requireAuth, requireRole("company_admin"), async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const now = new Date();
    const year = parseInt((req.body.year as string) || String(now.getFullYear()));
    const month = parseInt((req.body.month as string) || String(now.getMonth() + 1));

    await refreshBudgetTracker(companyId, year, month);

    await db.insert(auditLogsTable).values({
      companyId, userId: req.user?.id, userName: req.user?.name,
      action: "budget_tracker_refresh",
      module: "purchasing_intelligence",
      after: JSON.stringify({ year, month }),
    });

    return res.json({ success: true, message: `Budget tracker refreshed untuk ${month}/${year}` });
  } catch (err) {
    logger.error({ err }, "POST /api/purchasing/budget/refresh failed");
    return res.status(500).json({ error: "Gagal refresh budget tracker" });
  }
});

export default router;
