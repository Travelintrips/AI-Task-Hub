/**
 * Sprint 6B — Price Benchmark Engine
 *
 * GET  /api/purchasing/benchmark               — list benchmarks
 * GET  /api/purchasing/benchmark/lookup        — lookup for specific params
 * POST /api/purchasing/benchmark/refresh       — trigger full refresh
 * GET  /api/purchasing/contract-rates          — list contract rates
 * POST /api/purchasing/contract-rates          — create contract rate
 * PATCH /api/purchasing/contract-rates/:id     — update contract rate
 * DELETE /api/purchasing/contract-rates/:id    — deactivate
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  purchasingPriceBenchmarksTable,
  vendorContractRatesTable,
  auditLogsTable,
  type InsertVendorContractRate,
} from "@workspace/db/schema";
import { requireAuth, requireRole } from "../middleware/auth";
import { logger } from "../lib/logger";
import { eq, and, desc, sql } from "drizzle-orm";
import { refreshPriceBenchmarks } from "../lib/purchasing-engine";

const router: IRouter = Router();
function cid(req: Request): string { return req.user?.companyId ?? "default"; }

// ── GET /api/purchasing/benchmark ─────────────────────────────────────────────

router.get("/purchasing/benchmark", requireAuth, requireRole("supervisor"), async (req: Request, res: Response) => {
  try {
    const { serviceCategory, vendorId, limit = "50" } = req.query as Record<string, string>;
    const companyId = cid(req);

    const conditions = [eq(purchasingPriceBenchmarksTable.companyId, companyId)];
    if (serviceCategory) conditions.push(eq(purchasingPriceBenchmarksTable.serviceCategory, serviceCategory));
    if (vendorId) conditions.push(eq(purchasingPriceBenchmarksTable.vendorId, parseInt(vendorId)));

    const rows = await db
      .select()
      .from(purchasingPriceBenchmarksTable)
      .where(and(...conditions))
      .orderBy(desc(purchasingPriceBenchmarksTable.sampleCount))
      .limit(Math.min(parseInt(limit) || 50, 100));

    return res.json({ benchmarks: rows, total: rows.length });
  } catch (err) {
    logger.error({ err }, "GET /api/purchasing/benchmark failed");
    return res.status(500).json({ error: "Gagal memuat benchmarks" });
  }
});

// ── GET /api/purchasing/benchmark/lookup ──────────────────────────────────────

router.get("/purchasing/benchmark/lookup", requireAuth, async (req: Request, res: Response) => {
  try {
    const { serviceCategory, vendorId, origin, destination } = req.query as Record<string, string>;
    const companyId = cid(req);

    if (!serviceCategory) return res.status(400).json({ error: "serviceCategory diperlukan" });

    const conditions = [
      eq(purchasingPriceBenchmarksTable.companyId, companyId),
      eq(purchasingPriceBenchmarksTable.serviceCategory, serviceCategory),
    ];
    if (vendorId) conditions.push(eq(purchasingPriceBenchmarksTable.vendorId, parseInt(vendorId)));
    if (origin) conditions.push(eq(purchasingPriceBenchmarksTable.origin, origin));
    if (destination) conditions.push(eq(purchasingPriceBenchmarksTable.destination, destination));

    const rows = await db
      .select()
      .from(purchasingPriceBenchmarksTable)
      .where(and(...conditions))
      .orderBy(desc(purchasingPriceBenchmarksTable.sampleCount))
      .limit(1);

    let benchmark = rows[0];

    // Fallback: broader match (ignore route)
    if (!benchmark && (origin || destination)) {
      const [wider] = await db
        .select()
        .from(purchasingPriceBenchmarksTable)
        .where(and(
          eq(purchasingPriceBenchmarksTable.companyId, companyId),
          eq(purchasingPriceBenchmarksTable.serviceCategory, serviceCategory),
        ))
        .orderBy(desc(purchasingPriceBenchmarksTable.sampleCount))
        .limit(1);
      benchmark = wider;
    }

    if (!benchmark) {
      return res.json({ benchmark: null, confidence: "insufficient", message: "Belum ada data benchmark untuk parameter ini" });
    }

    return res.json({ benchmark });
  } catch (err) {
    logger.error({ err }, "GET /api/purchasing/benchmark/lookup failed");
    return res.status(500).json({ error: "Gagal lookup benchmark" });
  }
});

// ── POST /api/purchasing/benchmark/refresh ────────────────────────────────────

router.post("/purchasing/benchmark/refresh", requireAuth, requireRole("company_admin"), async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const result = await refreshPriceBenchmarks(companyId);

    await db.insert(auditLogsTable).values({
      companyId,
      userId: req.user?.id,
      userName: req.user?.name,
      action: "benchmark_refresh",
      module: "purchasing_intelligence",
      after: JSON.stringify(result),
    });

    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error({ err }, "POST /api/purchasing/benchmark/refresh failed");
    return res.status(500).json({ error: "Gagal refresh benchmarks" });
  }
});

// ── GET /api/purchasing/contract-rates ────────────────────────────────────────

router.get("/purchasing/contract-rates", requireAuth, requireRole("supervisor"), async (req: Request, res: Response) => {
  try {
    const { vendorId, serviceCategory, activeOnly = "true" } = req.query as Record<string, string>;
    const companyId = cid(req);

    const conditions = [eq(vendorContractRatesTable.companyId, companyId)];
    if (vendorId) conditions.push(eq(vendorContractRatesTable.vendorId, parseInt(vendorId)));
    if (serviceCategory) conditions.push(eq(vendorContractRatesTable.serviceCategory, serviceCategory));
    if (activeOnly === "true") conditions.push(eq(vendorContractRatesTable.isActive, true));

    const rows = await db
      .select()
      .from(vendorContractRatesTable)
      .where(and(...conditions))
      .orderBy(desc(vendorContractRatesTable.createdAt));

    return res.json({ contractRates: rows });
  } catch (err) {
    logger.error({ err }, "GET /api/purchasing/contract-rates failed");
    return res.status(500).json({ error: "Gagal memuat contract rates" });
  }
});

// ── POST /api/purchasing/contract-rates ───────────────────────────────────────

router.post("/purchasing/contract-rates", requireAuth, requireRole("company_admin"), async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const {
      vendorId, vendorName, serviceCategory, origin, destination,
      contractedRate, currency = "IDR", rateUnit = "per_shipment",
      validFrom, validUntil, contractReference, notes,
    } = req.body as Record<string, unknown>;

    if (!vendorId || !serviceCategory || !contractedRate || !validFrom) {
      return res.status(400).json({ error: "vendorId, serviceCategory, contractedRate, validFrom diperlukan" });
    }

    const [created] = await db.insert(vendorContractRatesTable).values({
      companyId,
      vendorId: vendorId as number,
      vendorName: vendorName as string | undefined,
      serviceCategory: serviceCategory as string,
      origin: origin as string | undefined,
      destination: destination as string | undefined,
      contractedRate: contractedRate as number,
      currency: currency as string,
      rateUnit: rateUnit as string,
      validFrom: validFrom as string,
      validUntil: validUntil as string | undefined,
      contractReference: contractReference as string | undefined,
      notes: notes as string | undefined,
      createdBy: req.user?.name ?? req.user?.email,
    } satisfies InsertVendorContractRate).returning();

    await db.insert(auditLogsTable).values({
      companyId,
      userId: req.user?.id,
      userName: req.user?.name,
      action: "vendor_contract_rate_changed",
      module: "purchasing_intelligence",
      entityId: created.id,
      entityType: "vendor_contract_rate",
      after: JSON.stringify({ vendorId, serviceCategory, contractedRate }),
    });

    return res.status(201).json({ success: true, contractRate: created });
  } catch (err) {
    logger.error({ err }, "POST /api/purchasing/contract-rates failed");
    return res.status(500).json({ error: "Gagal membuat contract rate" });
  }
});

// ── PATCH /api/purchasing/contract-rates/:id ──────────────────────────────────

router.patch("/purchasing/contract-rates/:id", requireAuth, requireRole("company_admin"), async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const [before] = await db.select().from(vendorContractRatesTable)
      .where(and(eq(vendorContractRatesTable.id, parseInt(req.params.id as string)), eq(vendorContractRatesTable.companyId, companyId)));
    if (!before) return res.status(404).json({ error: "Contract rate tidak ditemukan" });

    const [updated] = await db.update(vendorContractRatesTable)
      .set({ ...req.body as Partial<typeof vendorContractRatesTable.$inferInsert> })
      .where(eq(vendorContractRatesTable.id, before.id))
      .returning();

    await db.insert(auditLogsTable).values({
      companyId, userId: req.user?.id, userName: req.user?.name,
      action: "vendor_contract_rate_changed",
      module: "purchasing_intelligence",
      entityId: before.id, entityType: "vendor_contract_rate",
      before: JSON.stringify({ contractedRate: before.contractedRate }),
      after: JSON.stringify({ contractedRate: updated.contractedRate }),
    });

    return res.json({ success: true, contractRate: updated });
  } catch (err) {
    logger.error({ err }, "PATCH /api/purchasing/contract-rates/:id failed");
    return res.status(500).json({ error: "Gagal update contract rate" });
  }
});

// ── DELETE /api/purchasing/contract-rates/:id ─────────────────────────────────

router.delete("/purchasing/contract-rates/:id", requireAuth, requireRole("company_admin"), async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const [row] = await db.select().from(vendorContractRatesTable)
      .where(and(eq(vendorContractRatesTable.id, parseInt(req.params.id as string)), eq(vendorContractRatesTable.companyId, companyId)));
    if (!row) return res.status(404).json({ error: "Contract rate tidak ditemukan" });

    await db.update(vendorContractRatesTable).set({ isActive: false }).where(eq(vendorContractRatesTable.id, row.id));

    await db.insert(auditLogsTable).values({
      companyId, userId: req.user?.id, userName: req.user?.name,
      action: "vendor_contract_rate_changed",
      module: "purchasing_intelligence",
      entityId: row.id, entityType: "vendor_contract_rate",
      after: JSON.stringify({ isActive: false }),
    });

    return res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "DELETE /api/purchasing/contract-rates/:id failed");
    return res.status(500).json({ error: "Gagal menghapus contract rate" });
  }
});

export default router;
