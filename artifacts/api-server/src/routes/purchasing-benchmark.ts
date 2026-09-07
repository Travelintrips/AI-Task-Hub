/**
 * Sprint 6C — Price Benchmark Engine (enhanced)
 *
 * GET  /api/purchasing/benchmark               — list benchmarks (+ isStale)
 * GET  /api/purchasing/benchmark/lookup        — lookup (+ isStale, sampleCount)
 * POST /api/purchasing/benchmark/refresh       — full refresh (+ detailed log)
 * GET  /api/purchasing/contract-rates          — list (activeOnly query param)
 * POST /api/purchasing/contract-rates          — create (with intel signal)
 * PATCH /api/purchasing/contract-rates/:id     — update (with intel signal)
 * DELETE /api/purchasing/contract-rates/:id    — deactivate (with intel signal)
 *
 * Sprint 6C additions:
 * - isStale: true when createdAt > 7 days ago
 * - refresh returns detailed log: { refreshed, categories, oldestSampleDate, log[] }
 * - contract rate mutations also write purchasing_intel_signals type=contract_rate_change
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  purchasingPriceBenchmarksTable,
  vendorContractRatesTable,
  purchasingSignalsTable,
  auditLogsTable,
  type InsertVendorContractRate,
} from "@workspace/db/schema";
import { requireAuth, requireRole } from "../middleware/auth";
import { logger } from "../lib/logger";
import { eq, and, desc } from "drizzle-orm";
import { refreshPriceBenchmarks } from "../lib/purchasing-engine";

const router: IRouter = Router();
function cid(req: Request): string { return req.user?.companyId ?? "default"; }

const STALE_DAYS = 7;
function isStaleDate(d: Date | string | null | undefined): boolean {
  if (!d) return true;
  const age = (Date.now() - new Date(d).getTime()) / (1000 * 60 * 60 * 24);
  return age > STALE_DAYS;
}

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

    const benchmarks = rows.map(r => ({
      ...r,
      isStale: isStaleDate(r.createdAt),
      lastRefreshedAt: r.createdAt,
    }));

    // Find oldest refresh date for summary
    const oldestRefresh = rows.reduce((oldest, r) => {
      if (!oldest) return r.createdAt;
      return r.createdAt && new Date(r.createdAt) < new Date(oldest) ? r.createdAt : oldest;
    }, null as Date | null);

    return res.json({
      benchmarks,
      total: benchmarks.length,
      hasStale: benchmarks.some(b => b.isStale),
      oldestRefresh,
    });
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

    return res.json({
      benchmark: {
        ...benchmark,
        isStale: isStaleDate(benchmark.createdAt),
        lastRefreshedAt: benchmark.createdAt,
      },
      confidence: benchmark.sampleCount && benchmark.sampleCount >= 5 ? "high" : benchmark.sampleCount && benchmark.sampleCount >= 2 ? "medium" : "low",
    });
  } catch (err) {
    logger.error({ err }, "GET /api/purchasing/benchmark/lookup failed");
    return res.status(500).json({ error: "Gagal lookup benchmark" });
  }
});

// ── POST /api/purchasing/benchmark/refresh ────────────────────────────────────

router.post("/purchasing/benchmark/refresh", requireAuth, requireRole("company_admin"), async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const startMs = Date.now();
    const result = await refreshPriceBenchmarks(companyId);
    const elapsedMs = Date.now() - startMs;

    // Fetch updated benchmarks for log summary
    const updated = await db
      .select({
        serviceCategory: purchasingPriceBenchmarksTable.serviceCategory,
        sampleCount: purchasingPriceBenchmarksTable.sampleCount,
        createdAt: purchasingPriceBenchmarksTable.createdAt,
      })
      .from(purchasingPriceBenchmarksTable)
      .where(eq(purchasingPriceBenchmarksTable.companyId, companyId))
      .orderBy(desc(purchasingPriceBenchmarksTable.sampleCount))
      .limit(20);

    const categories = [...new Set(updated.map(r => r.serviceCategory))];
    const totalSamples = updated.reduce((s, r) => s + (r.sampleCount ?? 0), 0);

    const refreshLog = {
      refreshedAt: new Date().toISOString(),
      elapsedMs,
      refreshed: (result as Record<string, number>).refreshed ?? updated.length,
      categoriesUpdated: categories,
      totalSamples,
      entries: updated.map(r => ({
        category: r.serviceCategory,
        samples: r.sampleCount,
        isStale: isStaleDate(r.createdAt),
      })),
    };

    await db.insert(auditLogsTable).values({
      companyId,
      userId: req.user?.id,
      userName: req.user?.name,
      action: "benchmark_refresh",
      module: "purchasing_intelligence",
      after: JSON.stringify(refreshLog),
    });

    return res.json({ success: true, ...refreshLog });
  } catch (err) {
    logger.error({ err }, "POST /api/purchasing/benchmark/refresh failed");
    return res.status(500).json({ error: "Gagal refresh benchmarks" });
  }
});

// ── GET /api/purchasing/contract-rates ────────────────────────────────────────

router.get("/purchasing/contract-rates", requireAuth, requireRole("supervisor"), async (req: Request, res: Response) => {
  try {
    const { vendorId, serviceCategory, activeOnly = "false" } = req.query as Record<string, string>;
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

    const now = new Date();
    const rates = rows.map(r => ({
      ...r,
      isExpired: r.validUntil ? new Date(r.validUntil) < now : false,
      expiresInDays: r.validUntil ? Math.ceil((new Date(r.validUntil).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null,
    }));

    return res.json({ contractRates: rates, total: rates.length });
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

    if (!serviceCategory || !contractedRate || !validFrom) {
      return res.status(400).json({ error: "serviceCategory, contractedRate, validFrom diperlukan" });
    }

    const [created] = await db.insert(vendorContractRatesTable).values({
      companyId,
      vendorId: (vendorId as number | undefined) ?? 0,
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

    // Write purchasing signal for contract rate change (feedback loop)
    await db.insert(purchasingSignalsTable).values({
      companyId,
      signalType: "contract_rate_change",
      vendorId: (vendorId as number | undefined) ?? 0,
      vendorName: vendorName as string | undefined,
      serviceCategory: serviceCategory as string | undefined,
      origin: origin as string | undefined,
      destination: destination as string | undefined,
      quotedAmount: contractedRate as number,
      actualAmount: contractedRate as number,
      currency: (currency as string) ?? "IDR",
      sourceTable: "vendor_contract_rates",
      sourceId: created.id,
      recordedAt: new Date(),
    });

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

    // Write purchasing signal for contract rate change (feedback loop)
    await db.insert(purchasingSignalsTable).values({
      companyId,
      signalType: "contract_rate_change",
      vendorId: before.vendorId,
      vendorName: before.vendorName ?? undefined,
      serviceCategory: before.serviceCategory,
      origin: before.origin ?? undefined,
      destination: before.destination ?? undefined,
      quotedAmount: before.contractedRate ?? undefined,
      actualAmount: updated.contractedRate ?? before.contractedRate ?? 0,
      currency: before.currency ?? "IDR",
      sourceTable: "vendor_contract_rates",
      sourceId: before.id,
      recordedAt: new Date(),
    });

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

    // Write purchasing signal for contract rate deactivation (feedback loop)
    await db.insert(purchasingSignalsTable).values({
      companyId,
      signalType: "contract_rate_change",
      vendorId: row.vendorId,
      vendorName: row.vendorName ?? undefined,
      serviceCategory: row.serviceCategory,
      origin: row.origin ?? undefined,
      destination: row.destination ?? undefined,
      actualAmount: row.contractedRate ?? 0,
      currency: row.currency ?? "IDR",
      sourceTable: "vendor_contract_rates",
      sourceId: row.id,
      recordedAt: new Date(),
    });

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
