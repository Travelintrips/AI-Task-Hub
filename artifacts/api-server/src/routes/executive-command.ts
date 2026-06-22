/**
 * Sprint 8B — Executive Command Center
 *
 * Endpoints:
 *   GET /api/executive/kpis
 *   GET /api/executive/alerts
 *   GET /api/executive/readiness
 *   GET /api/executive/financial-protection
 *   GET /api/executive/refresh-health
 *
 * RBAC: company_admin and above (company_admin, super_admin)
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireAuth, requireRole, getCompanyId } from "../middleware/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const RBAC = [requireAuth, requireRole("company_admin")] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function safeCount(query: ReturnType<typeof sql>): Promise<number> {
  try {
    const result = await db.execute(query);
    const row = result.rows[0] as { cnt?: string | number } | undefined;
    return Number(row?.cnt ?? 0);
  } catch {
    return 0;
  }
}

async function safeRow<T extends Record<string, unknown>>(
  query: ReturnType<typeof sql>,
): Promise<T | undefined> {
  try {
    const result = await db.execute(query);
    return result.rows[0] as T | undefined;
  } catch {
    return undefined;
  }
}

async function safeRows<T extends Record<string, unknown>>(
  query: ReturnType<typeof sql>,
): Promise<T[]> {
  try {
    const result = await db.execute(query);
    return result.rows as T[];
  } catch {
    return [];
  }
}

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

// ── GET /api/executive/kpis ──────────────────────────────────────────────────

router.get(
  "/executive/kpis",
  ...RBAC,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = getCompanyId(req) ?? "default";

      const [
        totalActiveTasks,
        highRiskCustomers,
        highRiskVendors,
        highRiskFleetUnits,
        pendingApprovals,
        projectedMarginRisk,
        duplicatePurchaseRisk,
      ] = await Promise.all([
        safeCount(sql`
          SELECT COUNT(*)::int AS cnt
          FROM ai_tasks
          WHERE company_id = ${companyId}
            AND status NOT IN ('completed','cancelled','closed')
        `),
        safeCount(sql`
          SELECT COUNT(*)::int AS cnt
          FROM customers
          WHERE risk_tier IN ('high','critical')
        `),
        safeCount(sql`
          SELECT COUNT(*)::int AS cnt
          FROM intel_vendors
          WHERE company_id = ${companyId}
            AND risk_tier IN ('high','critical')
            AND is_stale = false
        `),
        safeCount(sql`
          SELECT COUNT(*)::int AS cnt
          FROM fleet_units
          WHERE company_id = ${companyId}
            AND status IN ('maintenance','inactive')
        `),
        safeCount(sql`
          SELECT COUNT(*)::int AS cnt
          FROM logistic_purchase_requests
          WHERE company_id = ${companyId}
            AND status IN ('pending_approval','pending')
        `),
        safeCount(sql`
          SELECT COUNT(*)::int AS cnt
          FROM logistic_purchase_requests
          WHERE company_id = ${companyId}
            AND ai_margin_impact_pct IS NOT NULL
            AND ai_margin_impact_pct < 0.15
            AND status NOT IN ('rejected','cancelled','completed')
        `),
        safeCount(sql`
          SELECT COUNT(*)::int AS cnt
          FROM logistic_purchase_requests
          WHERE company_id = ${companyId}
            AND ai_duplicate_flag = true
            AND status NOT IN ('rejected','cancelled','completed')
        `),
      ]);

      const costRow = await safeRow<{ avg_cost_per_km: number | null }>(sql`
        SELECT ROUND(AVG(cost_per_km)::numeric, 0)::int AS avg_cost_per_km
        FROM fleet_units
        WHERE company_id = ${companyId}
          AND cost_per_km IS NOT NULL
          AND cost_per_km > 0
      `);

      res.json({
        generatedAt: new Date().toISOString(),
        totalActiveTasks,
        highRiskCustomers,
        highRiskVendors,
        highRiskFleetUnits,
        pendingApprovals,
        projectedMarginRisk,
        duplicatePurchaseRisk,
        avgFleetCostPerKm: costRow?.avg_cost_per_km ?? null,
      });
    } catch (err) {
      logger.error({ err }, "GET /executive/kpis failed");
      res.status(500).json({ error: "Gagal memuat KPI eksekutif" });
    }
  },
);

// ── GET /api/executive/alerts ────────────────────────────────────────────────

router.get(
  "/executive/alerts",
  ...RBAC,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = getCompanyId(req) ?? "default";

      const alerts: Array<{
        id: string;
        type: string;
        severity: "critical" | "high" | "medium" | "low";
        title: string;
        detail: string;
        count: number;
        href?: string;
      }> = [];

      // 1. Overdue tasks
      const overdueCount = await safeCount(sql`
        SELECT COUNT(*)::int AS cnt
        FROM ai_tasks
        WHERE company_id = ${companyId}
          AND status NOT IN ('completed','cancelled','closed')
          AND sla_deadline IS NOT NULL
          AND sla_deadline < NOW()
      `);
      if (overdueCount > 0) {
        alerts.push({
          id: "overdue-tasks",
          type: "task",
          severity: overdueCount > 10 ? "critical" : overdueCount > 5 ? "high" : "medium",
          title: "Tugas Melewati Tenggat",
          detail: `${overdueCount} tugas aktif sudah melewati deadline SLA`,
          count: overdueCount,
          href: "/ai-tasks",
        });
      }

      // 2. Expiring fleet documents (≤30 days)
      const expiringDocs = await safeCount(sql`
        SELECT COUNT(*)::int AS cnt
        FROM fleet_documents
        WHERE company_id = ${companyId}
          AND expiry_date IS NOT NULL
          AND expiry_date BETWEEN NOW() AND NOW() + INTERVAL '30 days'
          AND status != 'expired'
      `);
      if (expiringDocs > 0) {
        alerts.push({
          id: "expiring-fleet-docs",
          type: "fleet",
          severity: expiringDocs > 5 ? "high" : "medium",
          title: "Dokumen Armada Segera Kadaluarsa",
          detail: `${expiringDocs} dokumen armada akan kadaluarsa dalam 30 hari`,
          count: expiringDocs,
          href: "/fleet/documents",
        });
      }

      // Expired fleet documents
      const expiredDocs = await safeCount(sql`
        SELECT COUNT(*)::int AS cnt
        FROM fleet_documents
        WHERE company_id = ${companyId}
          AND status = 'expired'
      `);
      if (expiredDocs > 0) {
        alerts.push({
          id: "expired-fleet-docs",
          type: "fleet",
          severity: "critical",
          title: "Dokumen Armada Kadaluarsa",
          detail: `${expiredDocs} dokumen armada sudah kadaluarsa`,
          count: expiredDocs,
          href: "/fleet/documents",
        });
      }

      // 3. Vendor risk alerts
      const criticalVendors = await safeCount(sql`
        SELECT COUNT(*)::int AS cnt
        FROM intel_vendors
        WHERE company_id = ${companyId}
          AND risk_tier = 'critical'
          AND is_stale = false
      `);
      if (criticalVendors > 0) {
        alerts.push({
          id: "critical-vendors",
          type: "vendor",
          severity: "critical",
          title: "Vendor Risiko Kritis",
          detail: `${criticalVendors} vendor dengan risiko kritis terdeteksi`,
          count: criticalVendors,
          href: "/vendors",
        });
      }

      // 4. Duplicate purchase alerts
      const duplicateRisk = await safeCount(sql`
        SELECT COUNT(*)::int AS cnt
        FROM logistic_purchase_requests
        WHERE company_id = ${companyId}
          AND ai_duplicate_flag = true
          AND status NOT IN ('rejected','cancelled','completed')
      `);
      if (duplicateRisk > 0) {
        alerts.push({
          id: "duplicate-purchases",
          type: "purchasing",
          severity: duplicateRisk > 5 ? "high" : "medium",
          title: "Potensi Pembelian Duplikat",
          detail: `${duplicateRisk} permintaan berpotensi duplikat dari pembelian sebelumnya`,
          count: duplicateRisk,
          href: "/purchasing-intelligence",
        });
      }

      // 5. Margin below floor alerts
      const marginRisk = await safeCount(sql`
        SELECT COUNT(*)::int AS cnt
        FROM logistic_purchase_requests
        WHERE company_id = ${companyId}
          AND ai_margin_impact_pct IS NOT NULL
          AND ai_margin_impact_pct < 0.15
          AND status NOT IN ('rejected','cancelled','completed')
      `);
      if (marginRisk > 0) {
        alerts.push({
          id: "margin-risk",
          type: "purchasing",
          severity: marginRisk > 3 ? "high" : "medium",
          title: "Margin Di Bawah Ambang Batas",
          detail: `${marginRisk} permintaan dengan margin diprediksi di bawah 15%`,
          count: marginRisk,
          href: "/purchasing-intelligence",
        });
      }

      // 6. Fleet fuel anomalies
      const fuelAnomalies = await safeCount(sql`
        SELECT COUNT(*)::int AS cnt
        FROM fleet_fuel_logs
        WHERE company_id = ${companyId}
          AND is_anomaly = true
          AND logged_at >= NOW() - INTERVAL '7 days'
      `);
      if (fuelAnomalies > 0) {
        alerts.push({
          id: "fuel-anomalies",
          type: "fleet",
          severity: fuelAnomalies > 10 ? "high" : "medium",
          title: "Anomali Konsumsi BBM",
          detail: `${fuelAnomalies} transaksi BBM anomali terdeteksi dalam 7 hari terakhir`,
          count: fuelAnomalies,
          href: "/fleet/fuel",
        });
      }

      // 7. AI low confidence alerts
      const lowConfidence = await safeCount(sql`
        SELECT COUNT(*)::int AS cnt
        FROM ai_tasks
        WHERE company_id = ${companyId}
          AND ai_confidence_score = 'low'
          AND status NOT IN ('completed','cancelled','closed')
      `);
      if (lowConfidence > 0) {
        alerts.push({
          id: "low-confidence-ai",
          type: "ai",
          severity: lowConfidence > 20 ? "high" : "medium",
          title: "AI Kepercayaan Rendah",
          detail: `${lowConfidence} tugas aktif dengan skor kepercayaan AI rendah`,
          count: lowConfidence,
          href: "/ai-tasks",
        });
      }

      // Sort: CRITICAL > HIGH > MEDIUM > LOW
      alerts.sort(
        (a, b) =>
          (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
      );

      res.json({ generatedAt: new Date().toISOString(), alerts });
    } catch (err) {
      logger.error({ err }, "GET /executive/alerts failed");
      res.status(500).json({ error: "Gagal memuat alert eksekutif" });
    }
  },
);

// ── GET /api/executive/readiness ─────────────────────────────────────────────

router.get(
  "/executive/readiness",
  ...RBAC,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = getCompanyId(req) ?? "default";

      // 1. Customer Memory
      const custMem = await safeRow<{
        total: number;
        with_snapshot: number;
        stale: number;
        last_refresh: string | null;
      }>(sql`
        SELECT
          (SELECT COUNT(*)::int FROM customers)                           AS total,
          COUNT(DISTINCT customer_id)::int                                AS with_snapshot,
          COUNT(*) FILTER (WHERE is_stale = true)::int                   AS stale,
          MAX(created_at)::text                                           AS last_refresh
        FROM customer_memory_snapshots
        WHERE company_id = ${companyId}
      `);

      // 2. Vendor Memory
      const vendorMem = await safeRow<{
        total: number;
        ready: number;
        stale: number;
        last_refresh: string | null;
        avg_score: number;
      }>(sql`
        SELECT
          COUNT(DISTINCT vendor_id)::int                                  AS total,
          COUNT(DISTINCT vendor_id) FILTER (WHERE readiness_score >= 60)::int AS ready,
          COUNT(*) FILTER (WHERE is_stale = true)::int                   AS stale,
          MAX(last_updated_at)::text                                      AS last_refresh,
          COALESCE(ROUND(AVG(readiness_score))::int, 0)                  AS avg_score
        FROM intel_vendors
        WHERE company_id = ${companyId}
      `);

      // 3. Purchasing
      const purchasing = await safeRow<{
        total: number;
        evaluated: number;
        last_refresh: string | null;
      }>(sql`
        SELECT
          COUNT(*)::int                                         AS total,
          COUNT(*) FILTER (WHERE ai_evaluated_at IS NOT NULL)::int AS evaluated,
          MAX(ai_evaluated_at)::text                            AS last_refresh
        FROM logistic_purchase_requests
        WHERE company_id = ${companyId}
      `);

      // 4. Fleet
      const fleet = await safeRow<{
        total: number;
        active: number;
        last_refresh: string | null;
      }>(sql`
        SELECT
          COUNT(*)::int                                                   AS total,
          COUNT(*) FILTER (WHERE status = 'available')::int              AS active,
          MAX(updated_at)::text                                           AS last_refresh
        FROM fleet_units
        WHERE company_id = ${companyId}
      `);

      // 5. Driver Memory
      const driverMem = await safeRow<{
        total_drivers: number;
        with_perf: number;
        last_refresh: string | null;
      }>(sql`
        SELECT
          (SELECT COUNT(*)::int FROM fleet_drivers WHERE company_id = ${companyId} AND status = 'active') AS total_drivers,
          COUNT(DISTINCT driver_id)::int                                  AS with_perf,
          MAX(period_end)::text                                           AS last_refresh
        FROM fleet_driver_performance
        WHERE company_id = ${companyId}
      `);

      const totalCust = custMem?.total ?? 0;
      const withCustSnap = custMem?.with_snapshot ?? 0;
      const staleCust = custMem?.stale ?? 0;
      const custScore = totalCust > 0 ? Math.round((withCustSnap / totalCust) * 100) : 0;

      const totalVendors = vendorMem?.total ?? 0;
      const readyVendors = vendorMem?.ready ?? 0;
      const vendorScore = totalVendors > 0 ? Math.round((readyVendors / totalVendors) * 100) : 0;

      const totalPurch = purchasing?.total ?? 0;
      const evaluatedPurch = purchasing?.evaluated ?? 0;
      const purchScore = totalPurch > 0 ? Math.round((evaluatedPurch / totalPurch) * 100) : 0;

      const totalFleet = fleet?.total ?? 0;
      const activeFleet = fleet?.active ?? 0;
      const fleetScore = totalFleet > 0 ? Math.round((activeFleet / totalFleet) * 100) : 0;

      const totalDrivers = driverMem?.total_drivers ?? 0;
      const driversWithPerf = driverMem?.with_perf ?? 0;
      const driverScore = totalDrivers > 0 ? Math.round((driversWithPerf / totalDrivers) * 100) : 0;

      function readinessStatus(score: number): "good" | "warning" | "critical" | "empty" {
        if (score === 0) return "empty";
        if (score >= 70) return "good";
        if (score >= 40) return "warning";
        return "critical";
      }

      const modules = [
        {
          name: "Customer Memory",
          score: custScore,
          status: readinessStatus(custScore),
          lastRefresh: custMem?.last_refresh ?? null,
          staleCount: staleCust,
          totalCount: totalCust,
        },
        {
          name: "Vendor Memory",
          score: vendorScore,
          status: readinessStatus(vendorScore),
          lastRefresh: vendorMem?.last_refresh ?? null,
          staleCount: vendorMem?.stale ?? 0,
          totalCount: totalVendors,
        },
        {
          name: "Purchasing",
          score: purchScore,
          status: readinessStatus(purchScore),
          lastRefresh: purchasing?.last_refresh ?? null,
          staleCount: totalPurch - evaluatedPurch,
          totalCount: totalPurch,
        },
        {
          name: "Fleet",
          score: fleetScore,
          status: readinessStatus(fleetScore),
          lastRefresh: fleet?.last_refresh ?? null,
          staleCount: totalFleet - activeFleet,
          totalCount: totalFleet,
        },
        {
          name: "Driver Memory",
          score: driverScore,
          status: readinessStatus(driverScore),
          lastRefresh: driverMem?.last_refresh ?? null,
          staleCount: totalDrivers - driversWithPerf,
          totalCount: totalDrivers,
        },
      ];

      const overallScore = modules.length > 0
        ? Math.round(modules.reduce((sum, m) => sum + m.score, 0) / modules.length)
        : 0;

      res.json({
        generatedAt: new Date().toISOString(),
        overallScore,
        modules,
      });
    } catch (err) {
      logger.error({ err }, "GET /executive/readiness failed");
      res.status(500).json({ error: "Gagal memuat data readiness" });
    }
  },
);

// ── GET /api/executive/financial-protection ──────────────────────────────────

router.get(
  "/executive/financial-protection",
  ...RBAC,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = getCompanyId(req) ?? "default";
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const buildQuery = (since?: Date) => {
        const sinceFilter = since
          ? sql`AND created_at >= ${since.toISOString()}`
          : sql``;
        return sql`
          SELECT
            COALESCE(ROUND(SUM(
              CASE
                WHEN status = 'approved'
                  AND ai_price_deviation_pct IS NOT NULL
                  AND ai_price_deviation_pct < 0
                THEN estimated_amount * (ABS(ai_price_deviation_pct) / 100.0)
                ELSE 0
              END
            ))::bigint, 0)                                                AS estimated_savings,
            COUNT(*) FILTER (WHERE ai_duplicate_flag = true AND status IN ('rejected','cancelled'))::int AS prevented_duplicates,
            COUNT(*) FILTER (
              WHERE ai_margin_impact_pct IS NOT NULL
                AND ai_margin_impact_pct < 0
                AND status IN ('rejected','cancelled')
            )::int                                                        AS prevented_low_margin
          FROM logistic_purchase_requests
          WHERE company_id = ${companyId}
          ${sinceFilter}
        `;
      };

      const [monthlyRow, allTimeRow, vendorOppRow, fleetSavingsRow] =
        await Promise.all([
          safeRow<{
            estimated_savings: number;
            prevented_duplicates: number;
            prevented_low_margin: number;
          }>(buildQuery(monthStart)),
          safeRow<{
            estimated_savings: number;
            prevented_duplicates: number;
            prevented_low_margin: number;
          }>(buildQuery()),
          safeRow<{ opportunities: number }>(sql`
            SELECT COUNT(DISTINCT vendor_id)::int AS opportunities
            FROM intel_vendors
            WHERE company_id = ${companyId}
              AND (risk_tier IN ('high','critical') OR readiness_score < 40)
              AND is_stale = false
          `),
          safeRow<{ fleet_cost_saving_units: number }>(sql`
            SELECT COUNT(*)::int AS fleet_cost_saving_units
            FROM fleet_units
            WHERE company_id = ${companyId}
              AND cost_per_km IS NOT NULL
              AND cost_per_km > (
                SELECT AVG(cost_per_km) * 1.2
                FROM fleet_units
                WHERE company_id = ${companyId} AND cost_per_km > 0
              )
          `),
        ]);

      res.json({
        generatedAt: new Date().toISOString(),
        monthly: {
          estimatedSavingsIdr: Number(monthlyRow?.estimated_savings ?? 0),
          preventedDuplicates: monthlyRow?.prevented_duplicates ?? 0,
          preventedLowMargin: monthlyRow?.prevented_low_margin ?? 0,
          vendorOptimizationOpportunities: vendorOppRow?.opportunities ?? 0,
          fleetCostSavingUnits: fleetSavingsRow?.fleet_cost_saving_units ?? 0,
        },
        all_time: {
          estimatedSavingsIdr: Number(allTimeRow?.estimated_savings ?? 0),
          preventedDuplicates: allTimeRow?.prevented_duplicates ?? 0,
          preventedLowMargin: allTimeRow?.prevented_low_margin ?? 0,
          vendorOptimizationOpportunities: vendorOppRow?.opportunities ?? 0,
          fleetCostSavingUnits: fleetSavingsRow?.fleet_cost_saving_units ?? 0,
        },
      });
    } catch (err) {
      logger.error({ err }, "GET /executive/financial-protection failed");
      res.status(500).json({ error: "Gagal memuat data perlindungan finansial" });
    }
  },
);

// ── GET /api/executive/refresh-health ────────────────────────────────────────

router.get(
  "/executive/refresh-health",
  ...RBAC,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = getCompanyId(req) ?? "default";

      const rows = await safeRows<{
        section_name: string;
        last_success: string | null;
        last_failure: string | null;
        avg_duration_ms: number | null;
        last_status: string | null;
        success_count: number;
        failure_count: number;
      }>(sql`
        SELECT
          section_name,
          MAX(created_at) FILTER (WHERE status = 'success')::text AS last_success,
          MAX(created_at) FILTER (WHERE status = 'error')::text   AS last_failure,
          ROUND(AVG(duration_ms))::int                            AS avg_duration_ms,
          (
            SELECT status FROM executive_refresh_logs l2
            WHERE l2.company_id = l.company_id
              AND l2.section_name = l.section_name
            ORDER BY created_at DESC LIMIT 1
          )                                                        AS last_status,
          COUNT(*) FILTER (WHERE status = 'success')::int         AS success_count,
          COUNT(*) FILTER (WHERE status = 'error')::int           AS failure_count
        FROM executive_refresh_logs l
        WHERE company_id = ${companyId}
          AND created_at >= NOW() - INTERVAL '30 days'
        GROUP BY section_name, company_id
        ORDER BY section_name
      `);

      // If no logs yet, return 8 placeholder sections
      const KNOWN_SECTIONS = [
        "customer_memory",
        "vendor_memory",
        "purchasing_intel",
        "fleet_units",
        "fleet_documents",
        "fleet_fuel",
        "driver_memory",
        "ai_tasks",
      ];

      const sectionMap = new Map(rows.map((r) => [r.section_name, r]));

      const sections = KNOWN_SECTIONS.map((name) => {
        const r = sectionMap.get(name);
        return {
          sectionName: name,
          lastSuccess: r?.last_success ?? null,
          lastFailure: r?.last_failure ?? null,
          durationMs: r?.avg_duration_ms ?? null,
          status: r?.last_status ?? "unknown",
          successCount: r?.success_count ?? 0,
          failureCount: r?.failure_count ?? 0,
        };
      });

      res.json({
        generatedAt: new Date().toISOString(),
        sections,
      });
    } catch (err) {
      logger.error({ err }, "GET /executive/refresh-health failed");
      res.status(500).json({ error: "Gagal memuat refresh health" });
    }
  },
);

export default router;
