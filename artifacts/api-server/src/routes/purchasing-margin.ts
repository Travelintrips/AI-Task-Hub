/**
 * Sprint 6B — Margin Impact
 *
 * GET /api/purchasing/requests/:id/margin-impact
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { logisticPurchaseRequestsTable } from "@workspace/db/schema";
import { requireAuth } from "../middleware/auth";
import { logger } from "../lib/logger";
import { eq, and } from "drizzle-orm";
import { scoreMarginImpact } from "../lib/purchasing-engine";

const router: IRouter = Router();
function cid(req: Request): string { return req.user?.companyId ?? "default"; }

router.get("/purchasing/requests/:id/margin-impact", requireAuth, async (req: Request, res: Response) => {
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

    const result = await scoreMarginImpact({
      companyId,
      serviceCategory: lpr.serviceCategory,
      vendorId: lpr.vendorId,
      estimatedAmount: lpr.estimatedAmount ?? 0,
      logisticOrderId: lpr.logisticOrderId,
    });

    return res.json({ marginImpact: result });
  } catch (err) {
    logger.error({ err }, "GET /api/purchasing/requests/:id/margin-impact failed");
    return res.status(500).json({ error: "Gagal menghitung margin impact" });
  }
});

export default router;
