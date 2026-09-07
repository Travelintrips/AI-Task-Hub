/**
 * Sprint 5E — Intelligence Readiness Layer API
 *
 * RBAC:
 *   staff(3)         → GET /api/intel/routes only
 *   supervisor(4)+   → GET all datasets (routes, vendors, customers, quotations)
 *                      except margin detail
 *   company_admin(5)+ → full access including profit/margin + manual refresh trigger
 *
 * All reads served from intel_* tables (single-table SELECT — no joins at query time).
 * Stale rows carry X-Intel-Stale: true response header.
 * Results are cached in memory for 10 minutes per (companyId + dataset).
 *
 * Endpoints:
 *   GET  /api/intel/health
 *   GET  /api/intel/routes
 *   GET  /api/intel/vendors
 *   GET  /api/intel/customers
 *   GET  /api/intel/profit
 *   GET  /api/intel/quotations
 *   GET  /api/intel/readiness
 *   POST /api/intel/refresh
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  intelRoutesTable,
  intelVendorsTable,
  intelCustomersTable,
  intelProfitTable,
  intelQuotationsTable,
  intelReadinessScoresTable,
  intelRefreshLogTable,
} from "@workspace/db/schema";
import { requireAuth, requireRole } from "../middleware/auth";
import { triggerManualRefresh } from "../lib/intel-scheduler";
import { logger } from "../lib/logger";
import { sql, eq, and, desc, gte } from "drizzle-orm";

const router: IRouter = Router();

// ── Cache ─────────────────────────────────────────────────────────────────────

interface CacheEntry<T> { data: T; expiresAt: number }
const CACHE_TTL_MS = 10 * 60 * 1_000; // 10 minutes
const intelCache = new Map<string, CacheEntry<unknown>>();

function isFresh<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
  return !!entry && Date.now() < entry.expiresAt;
}

function cacheSet<T>(key: string, data: T): void {
  intelCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

function cacheGet<T>(key: string): T | undefined {
  const entry = intelCache.get(key) as CacheEntry<T> | undefined;
  return isFresh(entry) ? entry.data : undefined;
}

export function invalidateIntelCache(companyId?: string): void {
  if (companyId) {
    for (const key of intelCache.keys()) {
      if (key.startsWith(`${companyId}:`)) intelCache.delete(key);
    }
  } else {
    intelCache.clear();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function cid(req: Request): string {
  return req.user?.companyId ?? "default";
}

function setStaleHeader(res: Response, rows: Array<{ isStale: boolean | null }>): void {
  if (rows.some((r) => r.isStale)) res.setHeader("X-Intel-Stale", "true");
}

function getPeriodStart(daysBack = 90): Date {
  return new Date(Date.now() - daysBack * 86_400_000);
}

// ── GET /api/intel/health ──────────────────────────────────────────────────────

router.get("/intel/health", requireAuth, async (req, res) => {
  try {
    const companyId = cid(req);
    const cacheKey = `${companyId}:health`;
    const cached = cacheGet<object>(cacheKey);
    if (cached) { res.json(cached); return; }

    // Readiness scores per dataset
    const scores = await db
      .select()
      .from(intelReadinessScoresTable)
      .where(eq(intelReadinessScoresTable.companyId, companyId))
      .orderBy(desc(intelReadinessScoresTable.computedAt))
      .limit(10);

    // Latest refresh log entries per dataset
    const logs = await db
      .select()
      .from(intelRefreshLogTable)
      .where(
        and(
          eq(intelRefreshLogTable.companyId, companyId),
          gte(intelRefreshLogTable.startedAt, new Date(Date.now() - 7 * 86_400_000)),
        ),
      )
      .orderBy(desc(intelRefreshLogTable.startedAt))
      .limit(20);

    // Compute overall health
    const latestByDataset = new Map<string, typeof scores[0]>();
    for (const s of scores) {
      if (!latestByDataset.has(s.datasetName)) latestByDataset.set(s.datasetName, s);
    }

    const datasetHealth: Record<string, object> = {};
    for (const [name, score] of latestByDataset) {
      const lastLog = logs.find((l) => l.datasetName === name);
      const status = (() => {
        if (!score) return "stale";
        if ((score.overallReadinessScore ?? 0) >= 60) return "healthy";
        if ((score.overallReadinessScore ?? 0) >= 40) return "degraded";
        return "insufficient";
      })();

      datasetHealth[name] = {
        status,
        overallReadinessScore: score.overallReadinessScore,
        overallConfidenceTier: score.overallConfidenceTier,
        rowCount: score.rowCount,
        rowsAbove80: score.rowsAbove80,
        rowsBelow40: score.rowsBelow40,
        topFlags: score.topFlags,
        computedAt: score.computedAt,
        lastRefresh: lastLog
          ? { trigger: lastLog.trigger, status: lastLog.status, durationMs: lastLog.durationMs, completedAt: lastLog.completedAt }
          : null,
      };
    }

    const overallScores = [...latestByDataset.values()].map((s) => s.overallReadinessScore ?? 0);
    const overallHealth = overallScores.length === 0 ? "stale" : (() => {
      const avg = overallScores.reduce((a, b) => a + b, 0) / overallScores.length;
      if (avg >= 60) return "healthy";
      if (avg >= 40) return "degraded";
      return "insufficient";
    })();

    const payload = {
      status: overallHealth,
      datasetsConfigured: latestByDataset.size,
      datasets: datasetHealth,
      recentRefreshes: logs.slice(0, 5).map((l) => ({
        dataset: l.datasetName,
        trigger: l.trigger,
        status: l.status,
        rowsWritten: l.rowsWritten,
        durationMs: l.durationMs,
        startedAt: l.startedAt,
      })),
      computedAt: new Date().toISOString(),
    };

    cacheSet(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    logger.error({ err }, "GET /api/intel/health failed");
    res.status(500).json({ error: "Failed to load intel health" });
  }
});

// ── GET /api/intel/routes ──────────────────────────────────────────────────────

router.get(
  "/intel/routes",
  requireAuth,
  requireRole("staff", "supervisor", "company_admin", "super_admin"),
  async (req, res) => {
    try {
      const companyId = cid(req);
      const { origin, destination, category, limit = "50", offset = "0" } = req.query as Record<string, string>;
      const cacheKey = `${companyId}:routes:${origin ?? ""}:${destination ?? ""}:${category ?? ""}:${limit}:${offset}`;

      const cached = cacheGet<object[]>(cacheKey);
      if (cached) {
        if (cached.some((r: any) => r.isStale)) res.setHeader("X-Intel-Stale", "true");
        res.json(cached); return;
      }

      let q = db.select().from(intelRoutesTable).where(eq(intelRoutesTable.companyId, companyId)).$dynamic();
      if (origin) q = q.where(sql`origin = ${origin}`);
      if (destination) q = q.where(sql`destination = ${destination}`);
      if (category) q = q.where(sql`service_category = ${category}`);

      const rows = await q
        .orderBy(desc(intelRoutesTable.readinessScore))
        .limit(Math.min(Number(limit), 200))
        .offset(Number(offset));

      setStaleHeader(res, rows);
      cacheSet(cacheKey, rows);
      res.json(rows);
    } catch (err) {
      logger.error({ err }, "GET /api/intel/routes failed");
      res.status(500).json({ error: "Failed to load route intelligence" });
    }
  },
);

// ── GET /api/intel/vendors ─────────────────────────────────────────────────────

router.get(
  "/intel/vendors",
  requireAuth,
  requireRole("supervisor", "company_admin", "super_admin"),
  async (req, res) => {
    try {
      const companyId = cid(req);
      const { grade, riskTier, limit = "50", offset = "0" } = req.query as Record<string, string>;
      const cacheKey = `${companyId}:vendors:${grade ?? ""}:${riskTier ?? ""}:${limit}:${offset}`;

      const cached = cacheGet<object[]>(cacheKey);
      if (cached) {
        if (cached.some((r: any) => r.isStale)) res.setHeader("X-Intel-Stale", "true");
        res.json(cached); return;
      }

      let q = db.select().from(intelVendorsTable).where(eq(intelVendorsTable.companyId, companyId)).$dynamic();
      if (grade) q = q.where(sql`performance_grade = ${grade}`);
      if (riskTier) q = q.where(sql`risk_tier = ${riskTier}`);

      const rows = await q
        .orderBy(desc(intelVendorsTable.readinessScore))
        .limit(Math.min(Number(limit), 200))
        .offset(Number(offset));

      setStaleHeader(res, rows);
      cacheSet(cacheKey, rows);
      res.json(rows);
    } catch (err) {
      logger.error({ err }, "GET /api/intel/vendors failed");
      res.status(500).json({ error: "Failed to load vendor intelligence" });
    }
  },
);

// ── GET /api/intel/customers ───────────────────────────────────────────────────

router.get(
  "/intel/customers",
  requireAuth,
  requireRole("supervisor", "company_admin", "super_admin"),
  async (req, res) => {
    try {
      const companyId = cid(req);
      const { tier, riskTier, limit = "50", offset = "0" } = req.query as Record<string, string>;
      const cacheKey = `${companyId}:customers:${tier ?? ""}:${riskTier ?? ""}:${limit}:${offset}`;

      const cached = cacheGet<object[]>(cacheKey);
      if (cached) {
        if (cached.some((r: any) => r.isStale)) res.setHeader("X-Intel-Stale", "true");
        res.json(cached); return;
      }

      let q = db.select().from(intelCustomersTable).where(eq(intelCustomersTable.companyId, companyId)).$dynamic();
      if (tier) q = q.where(sql`tier = ${tier}`);
      if (riskTier) q = q.where(sql`risk_tier = ${riskTier}`);

      const rows = await q
        .orderBy(desc(intelCustomersTable.readinessScore))
        .limit(Math.min(Number(limit), 200))
        .offset(Number(offset));

      setStaleHeader(res, rows);
      cacheSet(cacheKey, rows);
      res.json(rows);
    } catch (err) {
      logger.error({ err }, "GET /api/intel/customers failed");
      res.status(500).json({ error: "Failed to load customer intelligence" });
    }
  },
);

// ── GET /api/intel/profit ──────────────────────────────────────────────────────

router.get(
  "/intel/profit",
  requireAuth,
  requireRole("company_admin", "super_admin"),
  async (req, res) => {
    try {
      const companyId = cid(req);
      const { dimension = "total", limit = "50", offset = "0" } = req.query as Record<string, string>;
      const cacheKey = `${companyId}:profit:${dimension}:${limit}:${offset}`;

      const cached = cacheGet<object[]>(cacheKey);
      if (cached) {
        if (cached.some((r: any) => r.isStale)) res.setHeader("X-Intel-Stale", "true");
        res.json(cached); return;
      }

      const rows = await db
        .select()
        .from(intelProfitTable)
        .where(
          and(
            eq(intelProfitTable.companyId, companyId),
            eq(intelProfitTable.dimension, dimension),
          ),
        )
        .orderBy(desc(intelProfitTable.totalActualRevenue))
        .limit(Math.min(Number(limit), 200))
        .offset(Number(offset));

      setStaleHeader(res, rows);
      cacheSet(cacheKey, rows);
      res.json(rows);
    } catch (err) {
      logger.error({ err }, "GET /api/intel/profit failed");
      res.status(500).json({ error: "Failed to load profit intelligence" });
    }
  },
);

// ── GET /api/intel/quotations ──────────────────────────────────────────────────

router.get(
  "/intel/quotations",
  requireAuth,
  requireRole("supervisor", "company_admin", "super_admin"),
  async (req, res) => {
    try {
      const companyId = cid(req);
      const { category, limit = "50", offset = "0" } = req.query as Record<string, string>;
      const cacheKey = `${companyId}:quotations:${category ?? ""}:${limit}:${offset}`;

      const cached = cacheGet<object[]>(cacheKey);
      if (cached) {
        if (cached.some((r: any) => r.isStale)) res.setHeader("X-Intel-Stale", "true");
        res.json(cached); return;
      }

      let q = db.select().from(intelQuotationsTable).where(eq(intelQuotationsTable.companyId, companyId)).$dynamic();
      if (category) q = q.where(sql`service_category = ${category}`);

      const rows = await q
        .orderBy(desc(intelQuotationsTable.readinessScore))
        .limit(Math.min(Number(limit), 200))
        .offset(Number(offset));

      setStaleHeader(res, rows);
      cacheSet(cacheKey, rows);
      res.json(rows);
    } catch (err) {
      logger.error({ err }, "GET /api/intel/quotations failed");
      res.status(500).json({ error: "Failed to load quotation intelligence" });
    }
  },
);

// ── GET /api/intel/readiness ───────────────────────────────────────────────────

router.get(
  "/intel/readiness",
  requireAuth,
  requireRole("supervisor", "company_admin", "super_admin"),
  async (req, res) => {
    try {
      const companyId = cid(req);
      const cacheKey = `${companyId}:readiness`;

      const cached = cacheGet<object[]>(cacheKey);
      if (cached) { res.json(cached); return; }

      const rows = await db
        .select()
        .from(intelReadinessScoresTable)
        .where(eq(intelReadinessScoresTable.companyId, companyId))
        .orderBy(desc(intelReadinessScoresTable.computedAt))
        .limit(10);

      cacheSet(cacheKey, rows);
      res.json(rows);
    } catch (err) {
      logger.error({ err }, "GET /api/intel/readiness failed");
      res.status(500).json({ error: "Failed to load readiness scores" });
    }
  },
);

// ── POST /api/intel/refresh ────────────────────────────────────────────────────

router.post(
  "/intel/refresh",
  requireAuth,
  requireRole("company_admin", "super_admin"),
  async (req, res) => {
    try {
      const companyId = cid(req);
      const triggeredBy = req.user?.email ?? req.user?.id?.toString() ?? "manual";

      // Fire and return job started response
      res.status(202).json({
        message: "Intel refresh started",
        companyId,
        triggeredBy,
        startedAt: new Date().toISOString(),
      });

      // Invalidate cache and run refresh in background
      invalidateIntelCache(companyId);

      triggerManualRefresh(companyId, triggeredBy)
        .then((results) => {
          logger.info({ companyId, results }, "Manual intel refresh completed");
        })
        .catch((err) => {
          logger.error({ companyId, err }, "Manual intel refresh failed");
        });
    } catch (err) {
      logger.error({ err }, "POST /api/intel/refresh failed");
      res.status(500).json({ error: "Failed to trigger intel refresh" });
    }
  },
);

// ── GET /api/intel/refresh-log ─────────────────────────────────────────────────

router.get(
  "/intel/refresh-log",
  requireAuth,
  requireRole("supervisor", "company_admin", "super_admin"),
  async (req, res) => {
    try {
      const companyId = cid(req);
      const { dataset, limit = "20" } = req.query as Record<string, string>;

      let q = db
        .select()
        .from(intelRefreshLogTable)
        .where(
          and(
            eq(intelRefreshLogTable.companyId, companyId),
            gte(intelRefreshLogTable.startedAt, new Date(Date.now() - 30 * 86_400_000)),
          ),
        )
        .$dynamic();
      if (dataset) q = q.where(sql`dataset_name = ${dataset}`);

      const rows = await q
        .orderBy(desc(intelRefreshLogTable.startedAt))
        .limit(Math.min(Number(limit), 100));

      res.json(rows);
    } catch (err) {
      logger.error({ err }, "GET /api/intel/refresh-log failed");
      res.status(500).json({ error: "Failed to load refresh log" });
    }
  },
);

export default router;
