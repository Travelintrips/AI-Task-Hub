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
import { sql, eq, and, desc, ilike } from "drizzle-orm";
import { createHash } from "crypto";
import { db } from "@workspace/db";
import {
  auditLogsTable,
  logisticPurchaseRequestsTable,
  purchasingSignalsTable,
  teamMembersTable,
} from "@workspace/db/schema";
import { requireAuth, requireRole, getCompanyId, getCompanyIdForWrite } from "../middleware/auth";
import { logger } from "../lib/logger";
import { supabaseQuery } from "../lib/supabase-db";
import { sendFonnte } from "../lib/fonnte";
import { openai } from "../lib/openai";

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

// ── GET /api/executive/action-center ─────────────────────────────────────────

router.get(
  "/executive/action-center",
  ...RBAC,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = getCompanyId(req) ?? "default";

      // Pending approvals from Supabase
      let pendingApprovals: Array<{
        approvalId: number;
        requestNumber: string;
        requestedBy: string;
        riskTier: string | null;
        estimatedAmount: number | null;
        vendorName: string | null;
        serviceCategory: string | null;
        requestId: number | null;
        submittedAt: string | null;
      }> = [];
      try {
        const arRows = await supabaseQuery<{
          id: number;
          doc_id: number;
          requested_by: string;
          doc_number: string;
          requested_at: string;
          status: string;
        }>(
          `SELECT id, doc_id, requested_by, doc_number, requested_at
           FROM approval_requests
           WHERE module = 'purchasing_logistics' AND status = 'pending'
           ORDER BY requested_at DESC
           LIMIT 20`,
          [],
        );
        const enriched = await Promise.all(
          arRows.map(async (ar) => {
            let lpr: typeof logisticPurchaseRequestsTable.$inferSelect | null = null;
            if (ar.doc_id) {
              const [row] = await db
                .select()
                .from(logisticPurchaseRequestsTable)
                .where(eq(logisticPurchaseRequestsTable.id, ar.doc_id))
                .limit(1);
              lpr = row ?? null;
            }
            return {
              approvalId: ar.id,
              requestNumber: ar.doc_number ?? lpr?.requestNumber ?? "-",
              requestedBy: ar.requested_by ?? "-",
              riskTier: lpr?.aiRiskTier ?? null,
              estimatedAmount: lpr?.estimatedAmount ? Number(lpr.estimatedAmount) : null,
              vendorName: lpr?.vendorName ?? null,
              serviceCategory: lpr?.serviceCategory ?? null,
              requestId: ar.doc_id ?? null,
              submittedAt: ar.requested_at ?? null,
            };
          }),
        );
        pendingApprovals = enriched;
      } catch (arErr) {
        logger.warn({ arErr }, "action-center: approval requests fetch failed (non-fatal)");
      }

      // High-risk quick links counts
      const [
        highRiskTasks,
        highRiskFleet,
        highRiskVendors,
        highRiskCustomers,
      ] = await Promise.all([
        safeCount(sql`
          SELECT COUNT(*)::int AS cnt FROM ai_tasks
          WHERE company_id = ${companyId}
            AND priority IN ('critical','high')
            AND status NOT IN ('completed','cancelled','closed')
        `),
        safeCount(sql`
          SELECT COUNT(*)::int AS cnt FROM fleet_risk_scores frs
          JOIN fleet_units fu ON fu.id = frs.fleet_unit_id
          WHERE fu.company_id = ${companyId}
            AND frs.risk_level IN ('critical','high')
        `),
        safeCount(sql`
          SELECT COUNT(*)::int AS cnt FROM intel_vendors
          WHERE company_id = ${companyId}
            AND risk_tier IN ('critical','high')
            AND is_stale = false
        `),
        safeCount(sql`
          SELECT COUNT(*)::int AS cnt FROM customers
          WHERE risk_tier IN ('critical','high')
        `),
      ]);

      res.json({
        generatedAt: new Date().toISOString(),
        pendingApprovals,
        quickLinks: [
          { label: "Tugas Prioritas Tinggi", count: highRiskTasks, href: "/ai-tasks", type: "task" },
          { label: "Armada Risiko Tinggi", count: highRiskFleet, href: "/fleet/risk", type: "fleet" },
          { label: "Vendor Risiko Tinggi", count: highRiskVendors, href: "/vendors", type: "vendor" },
          { label: "Customer Risiko Tinggi", count: highRiskCustomers, href: "/customers", type: "customer" },
        ],
      });
    } catch (err) {
      logger.error({ err }, "GET /executive/action-center failed");
      res.status(500).json({ error: "Gagal memuat action center" });
    }
  },
);

// ── POST /api/executive/actions/approve/:approvalId ───────────────────────────

router.post(
  "/executive/actions/approve/:approvalId",
  ...RBAC,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = getCompanyId(req) ?? "default";
      const approvalId = parseInt(req.params.approvalId as string);
      const { notes } = req.body as { notes?: string };

      if (isNaN(approvalId)) {
        res.status(400).json({ error: "approvalId tidak valid" });
        return;
      }

      const [approval] = await supabaseQuery<{
        id: number;
        doc_id: number;
        status: string;
        requested_by: string;
      }>(
        `SELECT id, doc_id, status, requested_by FROM approval_requests
         WHERE id = $1 AND module = 'purchasing_logistics' LIMIT 1`,
        [approvalId],
      );
      if (!approval) {
        res.status(404).json({ error: "Approval request tidak ditemukan" });
        return;
      }
      if (approval.status !== "pending") {
        res.status(400).json({ error: `Approval sudah ${approval.status}` });
        return;
      }

      const approverName = req.user?.name ?? req.user?.email ?? "executive";
      const now = new Date().toISOString();

      await supabaseQuery(
        `UPDATE approval_requests SET status = 'approved', approved_by = $1, approved_at = $2, note = $3 WHERE id = $4`,
        [approverName, now, notes ?? null, approvalId],
      );

      const [lpr] = await db
        .select()
        .from(logisticPurchaseRequestsTable)
        .where(eq(logisticPurchaseRequestsTable.id, approval.doc_id))
        .limit(1);

      await db
        .update(logisticPurchaseRequestsTable)
        .set({ status: "approved", approvedBy: approverName, approvedAt: new Date() })
        .where(eq(logisticPurchaseRequestsTable.id, approval.doc_id));

      // Feedback loop signal
      if (lpr) {
        try {
          await db.insert(purchasingSignalsTable).values({
            companyId,
            signalType: "approval_granted",
            vendorId: lpr.vendorId ?? undefined,
            vendorName: lpr.vendorName ?? undefined,
            serviceCategory: lpr.serviceCategory ?? undefined,
            origin: lpr.origin ?? undefined,
            destination: lpr.destination ?? undefined,
            quotedAmount: lpr.estimatedAmount ?? undefined,
            actualAmount: lpr.estimatedAmount ?? 0,
            currency: lpr.currency ?? "IDR",
            sourceTable: "logistic_purchase_requests",
            sourceId: lpr.id,
            purchaseRequestId: lpr.id,
            logisticOrderId: lpr.logisticOrderId ?? undefined,
            recordedAt: new Date(),
          });
        } catch (sigErr) {
          logger.warn({ sigErr }, "approve action: purchasing_signals write failed (non-fatal)");
        }

        // WA notification
        try {
          const requesterName = approval.requested_by ?? lpr.requestedBy ?? "";
          if (requesterName) {
            const members = await db
              .select({ phone: teamMembersTable.phone })
              .from(teamMembersTable)
              .where(ilike(teamMembersTable.name, `%${requesterName.split(" ")[0]}%`))
              .limit(1);
            const phone = members[0]?.phone;
            if (phone) {
              const amount = lpr.estimatedAmount?.toLocaleString("id-ID") ?? "0";
              const msg = `✅ *Purchasing Request Disetujui*\n\nRequest: ${lpr.requestNumber ?? "-"}\nVendor: ${lpr.vendorName ?? "-"}\nJumlah: Rp ${amount}\nDisetujui oleh: ${approverName}\n${notes ? `Catatan: ${notes}` : ""}`;
              await sendFonnte(phone, msg);
            }
          }
        } catch (waErr) {
          logger.warn({ waErr }, "approve action: WA notification failed (non-fatal)");
        }
      }

      // Audit: approval decision
      await db.insert(auditLogsTable).values({
        companyId,
        userId: req.user?.id,
        userName: req.user?.name,
        action: "approval_approved",
        module: "purchasing_intelligence",
        entityId: approval.doc_id,
        entityType: "logistic_purchase_request",
        after: JSON.stringify({ approvalId, approvedBy: approverName, notes }),
      });

      // Audit: executive.action_triggered
      await db.insert(auditLogsTable).values({
        companyId,
        userId: req.user?.id,
        userName: req.user?.name,
        action: "executive.action_triggered",
        module: "executive_command",
        entityId: approvalId,
        entityType: "approval_request",
        after: JSON.stringify({ actionType: "approve", approvalId, entityId: approval.doc_id, notes }),
      });

      res.json({
        success: true,
        message: "Request berhasil disetujui",
      });
    } catch (err) {
      logger.error({ err }, "POST /executive/actions/approve failed");
      res.status(500).json({ error: "Gagal menyetujui request" });
    }
  },
);

// ── POST /api/executive/actions/reject/:approvalId ────────────────────────────

router.post(
  "/executive/actions/reject/:approvalId",
  ...RBAC,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = getCompanyId(req) ?? "default";
      const approvalId = parseInt(req.params.approvalId as string);
      const { notes } = req.body as { notes: string };

      if (isNaN(approvalId)) {
        res.status(400).json({ error: "approvalId tidak valid" });
        return;
      }
      if (!notes || notes.trim().length === 0) {
        res.status(400).json({ error: "notes wajib diisi untuk penolakan" });
        return;
      }

      const [approval] = await supabaseQuery<{
        id: number;
        doc_id: number;
        status: string;
        requested_by: string;
      }>(
        `SELECT id, doc_id, status, requested_by FROM approval_requests
         WHERE id = $1 AND module = 'purchasing_logistics' LIMIT 1`,
        [approvalId],
      );
      if (!approval) {
        res.status(404).json({ error: "Approval request tidak ditemukan" });
        return;
      }
      if (approval.status !== "pending") {
        res.status(400).json({ error: `Approval sudah ${approval.status}` });
        return;
      }

      const rejectorName = req.user?.name ?? req.user?.email ?? "executive";
      const now = new Date().toISOString();

      await supabaseQuery(
        `UPDATE approval_requests SET status = 'rejected', rejected_by = $1, rejected_at = $2, note = $3 WHERE id = $4`,
        [rejectorName, now, notes, approvalId],
      );

      const [lpr] = await db
        .select()
        .from(logisticPurchaseRequestsTable)
        .where(eq(logisticPurchaseRequestsTable.id, approval.doc_id))
        .limit(1);

      await db
        .update(logisticPurchaseRequestsTable)
        .set({ status: "rejected", rejectedBy: rejectorName, rejectedAt: new Date(), rejectedReason: notes })
        .where(eq(logisticPurchaseRequestsTable.id, approval.doc_id));

      // Feedback loop signal
      if (lpr) {
        try {
          await db.insert(purchasingSignalsTable).values({
            companyId,
            signalType: "approval_rejected",
            vendorId: lpr.vendorId ?? undefined,
            vendorName: lpr.vendorName ?? undefined,
            serviceCategory: lpr.serviceCategory ?? undefined,
            origin: lpr.origin ?? undefined,
            destination: lpr.destination ?? undefined,
            quotedAmount: lpr.estimatedAmount ?? undefined,
            actualAmount: lpr.estimatedAmount ?? 0,
            currency: lpr.currency ?? "IDR",
            sourceTable: "logistic_purchase_requests",
            sourceId: lpr.id,
            purchaseRequestId: lpr.id,
            logisticOrderId: lpr.logisticOrderId ?? undefined,
            recordedAt: new Date(),
          });
        } catch (sigErr) {
          logger.warn({ sigErr }, "reject action: purchasing_signals write failed (non-fatal)");
        }

        // WA notification
        try {
          const requesterName = approval.requested_by ?? lpr.requestedBy ?? "";
          if (requesterName) {
            const members = await db
              .select({ phone: teamMembersTable.phone })
              .from(teamMembersTable)
              .where(ilike(teamMembersTable.name, `%${requesterName.split(" ")[0]}%`))
              .limit(1);
            const phone = members[0]?.phone;
            if (phone) {
              const amount = lpr.estimatedAmount?.toLocaleString("id-ID") ?? "0";
              const msg = `❌ *Purchasing Request Ditolak*\n\nRequest: ${lpr.requestNumber ?? "-"}\nVendor: ${lpr.vendorName ?? "-"}\nJumlah: Rp ${amount}\nDitolak oleh: ${rejectorName}\nAlasan: ${notes}`;
              await sendFonnte(phone, msg);
            }
          }
        } catch (waErr) {
          logger.warn({ waErr }, "reject action: WA notification failed (non-fatal)");
        }
      }

      // Audit: rejection
      await db.insert(auditLogsTable).values({
        companyId,
        userId: req.user?.id,
        userName: req.user?.name,
        action: "approval_rejected",
        module: "purchasing_intelligence",
        entityId: approval.doc_id,
        entityType: "logistic_purchase_request",
        after: JSON.stringify({ approvalId, rejectedBy: rejectorName, notes }),
      });

      // Audit: executive.action_triggered
      await db.insert(auditLogsTable).values({
        companyId,
        userId: req.user?.id,
        userName: req.user?.name,
        action: "executive.action_triggered",
        module: "executive_command",
        entityId: approvalId,
        entityType: "approval_request",
        after: JSON.stringify({ actionType: "reject", approvalId, entityId: approval.doc_id, notes }),
      });

      res.json({
        success: true,
        message: "Request berhasil ditolak",
      });
    } catch (err) {
      logger.error({ err }, "POST /executive/actions/reject failed");
      res.status(500).json({ error: "Gagal menolak request" });
    }
  },
);

// ── GET /api/executive/timeline ───────────────────────────────────────────────

router.get(
  "/executive/timeline",
  ...RBAC,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = getCompanyId(req) ?? "default";
      const limit = Math.min(parseInt(String(req.query.limit ?? "50")), 100);

      type TimelineEvent = {
        id: string;
        source: string;
        severity: "critical" | "high" | "medium" | "low" | "info";
        title: string;
        detail: string;
        entityType: string;
        entityId: string | null;
        createdAt: string;
        actionUrl: string | null;
      };

      const events: TimelineEvent[] = [];

      // 1. Audit logs (Replit DB)
      const auditRows = await safeRows<{
        id: number;
        action: string;
        module: string;
        entity_id: number | null;
        entity_type: string | null;
        user_name: string | null;
        after: string | null;
        created_at: string;
      }>(sql`
        SELECT id, action, module, entity_id, entity_type, user_name, after, created_at::text
        FROM audit_logs
        WHERE company_id = ${companyId}
        ORDER BY created_at DESC
        LIMIT 30
      `);
      for (const r of auditRows) {
        const isExec = r.action === "executive.action_triggered";
        events.push({
          id: `audit-${r.id}`,
          source: "audit_logs",
          severity: isExec ? "high" : "info",
          title: isExec
            ? `Aksi Eksekutif: ${r.action}`
            : `${r.module} — ${r.action}`,
          detail: r.user_name ? `oleh ${r.user_name}` : r.action,
          entityType: r.entity_type ?? r.module,
          entityId: r.entity_id ? String(r.entity_id) : null,
          createdAt: r.created_at,
          actionUrl: null,
        });
      }

      // 2. AI Tasks recently created (Replit DB)
      const taskRows = await safeRows<{
        id: number;
        title: string;
        priority: string | null;
        ai_intent: string | null;
        created_at: string;
      }>(sql`
        SELECT id, title, priority, ai_intent, created_at::text
        FROM ai_tasks
        WHERE company_id = ${companyId}
        ORDER BY created_at DESC
        LIMIT 20
      `);
      for (const r of taskRows) {
        const sev: TimelineEvent["severity"] =
          r.priority === "critical" ? "critical"
          : r.priority === "high" ? "high"
          : r.priority === "medium" ? "medium"
          : "low";
        events.push({
          id: `task-${r.id}`,
          source: "ai_tasks",
          severity: sev,
          title: `Tugas Baru: ${r.title}`,
          detail: r.ai_intent ?? "Tugas AI dibuat",
          entityType: "ai_task",
          entityId: String(r.id),
          createdAt: r.created_at,
          actionUrl: `/ai-tasks`,
        });
      }

      // 3. Purchasing intel signals (Replit DB)
      const signalRows = await safeRows<{
        id: number;
        signal_type: string;
        severity: string | null;
        headline: string | null;
        explanation: string | null;
        purchase_request_id: number | null;
        created_at: string;
      }>(sql`
        SELECT pis.id, pis.signal_type, pis.severity, pis.headline, pis.explanation,
               pis.purchase_request_id, pis.created_at::text
        FROM purchasing_intel_signals pis
        JOIN logistic_purchase_requests lpr ON lpr.id = pis.purchase_request_id
        WHERE lpr.company_id = ${companyId}
        ORDER BY pis.created_at DESC
        LIMIT 20
      `);
      for (const r of signalRows) {
        const sev: TimelineEvent["severity"] =
          r.severity === "critical" ? "critical"
          : r.severity === "high" ? "high"
          : r.severity === "medium" ? "medium"
          : "info";
        events.push({
          id: `signal-${r.id}`,
          source: "purchasing_intel_signals",
          severity: sev,
          title: `Intel Pembelian: ${r.headline ?? r.signal_type}`,
          detail: r.explanation ?? r.signal_type,
          entityType: "purchase_request",
          entityId: r.purchase_request_id ? String(r.purchase_request_id) : null,
          createdAt: r.created_at,
          actionUrl: `/purchasing-intelligence`,
        });
      }

      // 4. Fleet report logs (Supabase)
      try {
        const fleetRepRows = await supabaseQuery<{
          id: number;
          report_type: string;
          recipient_name: string | null;
          status: string | null;
          created_at: string;
        }>(
          `SELECT id, report_type, recipient_name, status, created_at::text
           FROM fleet_report_logs
           ORDER BY created_at DESC
           LIMIT 15`,
          [],
        );
        for (const r of fleetRepRows) {
          events.push({
            id: `fleet-rep-${r.id}`,
            source: "fleet_report_logs",
            severity: r.status === "failed" ? "high" : "info",
            title: `Laporan Armada: ${r.report_type}`,
            detail: r.recipient_name ? `Ke: ${r.recipient_name}` : r.status ?? "dikirim",
            entityType: "fleet_report",
            entityId: String(r.id),
            createdAt: r.created_at,
            actionUrl: `/fleet/reports`,
          });
        }
      } catch {
        // fleet_report_logs may not exist yet
      }

      // 5. Vendor recommendation outcomes (Supabase)
      try {
        const vendorOutRows = await supabaseQuery<{
          id: number;
          outcome: string | null;
          actual_cost: number | null;
          created_at: string;
        }>(
          `SELECT id, outcome, actual_cost, created_at::text
           FROM vendor_recommendation_outcomes
           ORDER BY created_at DESC
           LIMIT 15`,
          [],
        );
        for (const r of vendorOutRows) {
          events.push({
            id: `vendor-out-${r.id}`,
            source: "vendor_recommendation_outcomes",
            severity: r.outcome === "rejected" ? "high" : "info",
            title: `Rekomendasi Vendor: ${r.outcome ?? "diproses"}`,
            detail: r.actual_cost ? `Biaya aktual: Rp ${Number(r.actual_cost).toLocaleString("id-ID")}` : "Outcome tercatat",
            entityType: "vendor_recommendation",
            entityId: String(r.id),
            createdAt: r.created_at,
            actionUrl: `/vendors`,
          });
        }
      } catch {
        // table may not exist yet
      }

      // 6. Fleet scheduler runs (Supabase)
      try {
        const schedulerRows = await supabaseQuery<{
          id: number;
          job_name: string;
          status: string | null;
          records_processed: number | null;
          duration_ms: number | null;
          ran_at: string;
        }>(
          `SELECT id, job_name, status, records_processed, duration_ms, ran_at::text
           FROM fleet_scheduler_runs
           ORDER BY ran_at DESC
           LIMIT 15`,
          [],
        );
        for (const r of schedulerRows) {
          events.push({
            id: `scheduler-${r.id}`,
            source: "fleet_scheduler_runs",
            severity: r.status === "error" ? "high" : "info",
            title: `Scheduler: ${r.job_name}`,
            detail: r.status === "error"
              ? "Job gagal"
              : `${r.records_processed ?? 0} records dalam ${r.duration_ms ?? 0}ms`,
            entityType: "scheduler_run",
            entityId: String(r.id),
            createdAt: r.ran_at,
            actionUrl: null,
          });
        }
      } catch {
        // table may not exist yet
      }

      // Sort all events newest-first and slice
      events.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

      res.json({
        generatedAt: new Date().toISOString(),
        total: events.length,
        events: events.slice(0, limit),
      });
    } catch (err) {
      logger.error({ err }, "GET /executive/timeline failed");
      res.status(500).json({ error: "Gagal memuat executive timeline" });
    }
  },
);

// ── GET /api/executive/risk-heatmap ──────────────────────────────────────────

router.get(
  "/executive/risk-heatmap",
  ...RBAC,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = getCompanyId(req) ?? "default";

      type RiskLevel = "critical" | "high" | "medium" | "low";
      type HeatmapCell = {
        count: number;
        score: number;
        topEntities: Array<{ id: string; label: string }>;
        actionUrl: string;
      };
      type HeatmapRow = Record<RiskLevel, HeatmapCell>;

      const LEVELS: RiskLevel[] = ["critical", "high", "medium", "low"];

      function emptyCell(url: string): HeatmapCell {
        return { count: 0, score: 0, topEntities: [], actionUrl: url };
      }

      // ── Customer ──────────────────────────────────────────────────────────────
      const customerHeat: HeatmapRow = {
        critical: emptyCell("/customers"),
        high: emptyCell("/customers"),
        medium: emptyCell("/customers"),
        low: emptyCell("/customers"),
      };
      const custRows = await safeRows<{ risk_tier: string; cnt: number; names: string }>(sql`
        SELECT risk_tier, COUNT(*)::int AS cnt,
               STRING_AGG(name, ', ' ORDER BY name LIMIT 3) AS names
        FROM customers
        WHERE risk_tier IS NOT NULL
        GROUP BY risk_tier
      `);
      for (const r of custRows) {
        const lvl = r.risk_tier as RiskLevel;
        if (LEVELS.includes(lvl)) {
          customerHeat[lvl].count = r.cnt;
          customerHeat[lvl].score = r.cnt * 10;
          customerHeat[lvl].topEntities = (r.names ?? "")
            .split(", ")
            .filter(Boolean)
            .slice(0, 3)
            .map((n, i) => ({ id: String(i), label: n }));
        }
      }

      // ── Vendor ────────────────────────────────────────────────────────────────
      const vendorHeat: HeatmapRow = {
        critical: emptyCell("/vendors"),
        high: emptyCell("/vendors"),
        medium: emptyCell("/vendors"),
        low: emptyCell("/vendors"),
      };
      const vendorRows = await safeRows<{ risk_tier: string; cnt: number; names: string }>(sql`
        SELECT risk_tier, COUNT(*)::int AS cnt,
               STRING_AGG(vendor_name, ', ' ORDER BY vendor_name LIMIT 3) AS names
        FROM intel_vendors
        WHERE company_id = ${companyId}
          AND risk_tier IS NOT NULL
          AND is_stale = false
        GROUP BY risk_tier
      `);
      for (const r of vendorRows) {
        const lvl = r.risk_tier as RiskLevel;
        if (LEVELS.includes(lvl)) {
          vendorHeat[lvl].count = r.cnt;
          vendorHeat[lvl].score = r.cnt * 10;
          vendorHeat[lvl].topEntities = (r.names ?? "")
            .split(", ")
            .filter(Boolean)
            .slice(0, 3)
            .map((n, i) => ({ id: String(i), label: n }));
        }
      }

      // ── Purchasing ────────────────────────────────────────────────────────────
      const purchHeat: HeatmapRow = {
        critical: emptyCell("/purchasing-intelligence"),
        high: emptyCell("/purchasing-intelligence"),
        medium: emptyCell("/purchasing-intelligence"),
        low: emptyCell("/purchasing-intelligence"),
      };
      const purchRows = await safeRows<{ ai_risk_tier: string; cnt: number; numbers: string }>(sql`
        SELECT ai_risk_tier, COUNT(*)::int AS cnt,
               STRING_AGG(request_number, ', ' ORDER BY request_number LIMIT 3) AS numbers
        FROM logistic_purchase_requests
        WHERE company_id = ${companyId}
          AND ai_risk_tier IS NOT NULL
          AND status NOT IN ('completed','cancelled')
        GROUP BY ai_risk_tier
      `);
      for (const r of purchRows) {
        const lvl = r.ai_risk_tier as RiskLevel;
        if (LEVELS.includes(lvl)) {
          purchHeat[lvl].count = r.cnt;
          purchHeat[lvl].score = r.cnt * 10;
          purchHeat[lvl].topEntities = (r.numbers ?? "")
            .split(", ")
            .filter(Boolean)
            .slice(0, 3)
            .map((n, i) => ({ id: String(i), label: n }));
        }
      }

      // ── Fleet ─────────────────────────────────────────────────────────────────
      const fleetHeat: HeatmapRow = {
        critical: emptyCell("/fleet/risk"),
        high: emptyCell("/fleet/risk"),
        medium: emptyCell("/fleet/risk"),
        low: emptyCell("/fleet/risk"),
      };
      const fleetRows = await safeRows<{ risk_level: string; cnt: number; plates: string }>(sql`
        SELECT frs.risk_level, COUNT(*)::int AS cnt,
               STRING_AGG(fu.plate_number, ', ' ORDER BY fu.plate_number LIMIT 3) AS plates
        FROM fleet_risk_scores frs
        JOIN fleet_units fu ON fu.id = frs.fleet_unit_id
        WHERE fu.company_id = ${companyId}
          AND frs.risk_level IS NOT NULL
        GROUP BY frs.risk_level
      `);
      for (const r of fleetRows) {
        const lvl = r.risk_level as RiskLevel;
        if (LEVELS.includes(lvl)) {
          fleetHeat[lvl].count = r.cnt;
          fleetHeat[lvl].score = r.cnt * 10;
          fleetHeat[lvl].topEntities = (r.plates ?? "")
            .split(", ")
            .filter(Boolean)
            .slice(0, 3)
            .map((n, i) => ({ id: String(i), label: n }));
        }
      }

      // ── AI Tasks ──────────────────────────────────────────────────────────────
      const taskHeat: HeatmapRow = {
        critical: emptyCell("/ai-tasks"),
        high: emptyCell("/ai-tasks"),
        medium: emptyCell("/ai-tasks"),
        low: emptyCell("/ai-tasks"),
      };
      const taskRows = await safeRows<{ priority: string; cnt: number; titles: string }>(sql`
        SELECT priority, COUNT(*)::int AS cnt,
               STRING_AGG(title, ', ' ORDER BY title LIMIT 3) AS titles
        FROM ai_tasks
        WHERE company_id = ${companyId}
          AND priority IS NOT NULL
          AND status NOT IN ('completed','cancelled','closed')
        GROUP BY priority
      `);
      for (const r of taskRows) {
        const map: Record<string, RiskLevel> = {
          critical: "critical", high: "high", medium: "medium", low: "low", normal: "low",
        };
        const lvl = map[r.priority];
        if (lvl) {
          taskHeat[lvl].count += r.cnt;
          taskHeat[lvl].score = taskHeat[lvl].count * 10;
          taskHeat[lvl].topEntities = (r.titles ?? "")
            .split(", ")
            .filter(Boolean)
            .slice(0, 3)
            .map((n, i) => ({ id: String(i), label: n }));
        }
      }

      // ── Finance ───────────────────────────────────────────────────────────────
      const financeHeat: HeatmapRow = {
        critical: emptyCell("/purchasing-intelligence"),
        high: emptyCell("/purchasing-intelligence"),
        medium: emptyCell("/purchasing-intelligence"),
        low: emptyCell("/purchasing-intelligence"),
      };
      const [marginCritical, marginHigh, duplicateMed, otherLow] = await Promise.all([
        safeCount(sql`
          SELECT COUNT(*)::int AS cnt FROM logistic_purchase_requests
          WHERE company_id = ${companyId}
            AND ai_margin_impact_pct IS NOT NULL AND ai_margin_impact_pct < 0
            AND status NOT IN ('rejected','cancelled','completed')
        `),
        safeCount(sql`
          SELECT COUNT(*)::int AS cnt FROM logistic_purchase_requests
          WHERE company_id = ${companyId}
            AND ai_margin_impact_pct IS NOT NULL AND ai_margin_impact_pct >= 0 AND ai_margin_impact_pct < 0.10
            AND status NOT IN ('rejected','cancelled','completed')
        `),
        safeCount(sql`
          SELECT COUNT(*)::int AS cnt FROM logistic_purchase_requests
          WHERE company_id = ${companyId}
            AND ai_duplicate_flag = true
            AND status NOT IN ('rejected','cancelled','completed')
        `),
        safeCount(sql`
          SELECT COUNT(*)::int AS cnt FROM logistic_purchase_requests
          WHERE company_id = ${companyId}
            AND status IN ('pending','pending_approval')
        `),
      ]);
      financeHeat.critical.count = marginCritical;
      financeHeat.critical.score = marginCritical * 15;
      financeHeat.high.count = marginHigh;
      financeHeat.high.score = marginHigh * 10;
      financeHeat.medium.count = duplicateMed;
      financeHeat.medium.score = duplicateMed * 8;
      financeHeat.low.count = otherLow;
      financeHeat.low.score = otherLow * 5;

      res.json({
        generatedAt: new Date().toISOString(),
        rows: [
          { module: "Customer", key: "customer", data: customerHeat },
          { module: "Vendor", key: "vendor", data: vendorHeat },
          { module: "Purchasing", key: "purchasing", data: purchHeat },
          { module: "Fleet", key: "fleet", data: fleetHeat },
          { module: "AI Tasks", key: "ai_tasks", data: taskHeat },
          { module: "Finance", key: "finance", data: financeHeat },
        ],
        columns: LEVELS,
      });
    } catch (err) {
      logger.error({ err }, "GET /executive/risk-heatmap failed");
      res.status(500).json({ error: "Gagal memuat risk heatmap" });
    }
  },
);

// ── AI Executive Summary helpers ──────────────────────────────────────────────

const SUMMARY_CACHE_MINUTES = 30;

interface ExecSummaryRow {
  id: number;
  company_id: string;
  summary: string;
  risks: Array<{ severity: string; text: string; entityType: string; entityId: string }>;
  actions: Array<{ priority: string; text: string; actionUrl: string }>;
  context_hash: string | null;
  generated_by: string;
  generated_at: string;
}

async function buildExecContext(companyId: string): Promise<Record<string, unknown>> {
  const [kpiRows, alertRows, riskRows, taskRows, purchRows] = await Promise.all([
    safeRows<Record<string, unknown>>(sql`
      SELECT
        COUNT(*) FILTER (WHERE status NOT IN ('completed','cancelled','closed'))::int AS active_tasks,
        COUNT(*) FILTER (WHERE priority = 'critical' AND status NOT IN ('completed','cancelled','closed'))::int AS critical_tasks,
        COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_tasks
      FROM ai_tasks WHERE company_id = ${companyId}
    `),
    safeRows<Record<string, unknown>>(sql`
      SELECT COUNT(*)::int AS high_risk_customers
      FROM customers WHERE company_id = ${companyId} AND risk_tier IN ('high','critical')
    `),
    safeRows<Record<string, unknown>>(sql`
      SELECT risk_tier, COUNT(*)::int AS cnt
      FROM customers WHERE company_id = ${companyId} AND risk_tier IS NOT NULL
      GROUP BY risk_tier
    `),
    safeRows<Record<string, unknown>>(sql`
      SELECT priority, COUNT(*)::int AS cnt
      FROM ai_tasks
      WHERE company_id = ${companyId} AND status NOT IN ('completed','cancelled','closed')
      GROUP BY priority
    `),
    safeRows<Record<string, unknown>>(sql`
      SELECT
        COUNT(*)::int AS pending_approvals,
        COUNT(*) FILTER (WHERE ai_margin_impact_pct < 0)::int AS negative_margin,
        COUNT(*) FILTER (WHERE ai_duplicate_flag = true)::int AS duplicates,
        COALESCE(SUM(estimated_amount),0)::bigint AS total_pending_value
      FROM logistic_purchase_requests
      WHERE company_id = ${companyId}
        AND status NOT IN ('rejected','cancelled','completed')
    `),
  ]);

  return {
    companyId,
    generatedAt: new Date().toISOString(),
    tasks: kpiRows[0] ?? {},
    tasksByPriority: taskRows,
    customers: { highRisk: alertRows[0] ?? {}, byTier: riskRows },
    purchasing: purchRows[0] ?? {},
  };
}

async function generateAiSummary(context: Record<string, unknown>): Promise<{
  summary: string;
  risks: Array<{ severity: string; text: string; entityType: string; entityId: string }>;
  actions: Array<{ priority: string; text: string; actionUrl: string }>;
}> {
  const prompt = `Kamu adalah analis eksekutif senior. Berdasarkan data operasional berikut, buat ringkasan eksekutif singkat dalam Bahasa Indonesia.

Data konteks:
${JSON.stringify(context, null, 2)}

Balas HANYA dengan JSON valid (tanpa markdown) dengan format:
{
  "summary": "paragraf ringkasan eksekutif 2-3 kalimat dalam Bahasa Indonesia",
  "risks": [
    { "severity": "HIGH", "text": "deskripsi risiko", "entityType": "customers|tasks|purchasing|fleet", "entityId": "" }
  ],
  "actions": [
    { "priority": "HIGH", "text": "rekomendasi tindakan", "actionUrl": "/halaman-terkait" }
  ]
}

Severity harus salah satu: CRITICAL, HIGH, MEDIUM, LOW.
Priority harus salah satu: HIGH, MEDIUM, LOW.
Maksimal 5 risks dan 5 actions.`;

  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Kamu adalah analis eksekutif senior yang memberikan ringkasan singkat dan rekomendasi tindakan berbasis data. Balas hanya dengan JSON valid." },
        { role: "user", content: prompt },
      ],
      max_tokens: 800,
      temperature: 0.3,
    });
    const raw = resp.choices[0]?.message?.content?.trim() ?? "{}";
    const parsed = JSON.parse(raw);
    return {
      summary: typeof parsed.summary === "string" ? parsed.summary : "Ringkasan tidak tersedia.",
      risks: Array.isArray(parsed.risks) ? parsed.risks.slice(0, 5) : [],
      actions: Array.isArray(parsed.actions) ? parsed.actions.slice(0, 5) : [],
    };
  } catch (err) {
    logger.error({ err }, "generateAiSummary OpenAI call failed");
    return {
      summary: "Ringkasan AI tidak dapat dibuat saat ini. Periksa koneksi OpenAI.",
      risks: [],
      actions: [],
    };
  }
}

// ── POST /api/executive/ai-summary ───────────────────────────────────────────

router.post(
  "/executive/ai-summary",
  ...RBAC,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = getCompanyIdForWrite(req);
      const force = req.body?.force === true && req.user?.role === "super_admin";

      // Check cache (30 minutes)
      if (!force) {
        const cached = await supabaseQuery<ExecSummaryRow>(
          `SELECT id, company_id, summary, risks, actions, context_hash, generated_by, generated_at::text
           FROM executive_summaries
           WHERE company_id = $1
             AND generated_at > NOW() - INTERVAL '${SUMMARY_CACHE_MINUTES} minutes'
           ORDER BY generated_at DESC
           LIMIT 1`,
          [companyId],
        );
        if (cached.length > 0) {
          const hit = cached[0];
          // Audit: cache returned
          try {
            await db.insert(auditLogsTable).values({
              companyId,
              action: "executive.ai_summary_cache_returned",
              module: "executive",
              entityType: "executive_summary",
              entityId: hit.id,
              userId: req.user?.id ?? null,
              userEmail: req.user?.email ?? null,
              after: JSON.stringify({ summaryId: hit.id }),
            });
          } catch { /* audit optional */ }

          res.json({
            cached: true,
            cacheExpiresAt: new Date(
              new Date(hit.generated_at).getTime() + SUMMARY_CACHE_MINUTES * 60 * 1000,
            ).toISOString(),
            data: hit,
          });
          return;
        }
      }

      // Build context and generate
      const context = await buildExecContext(companyId);
      const contextHash = createHash("sha256")
        .update(JSON.stringify(context))
        .digest("hex")
        .slice(0, 16);

      const generated = await generateAiSummary(context);
      const generatedBy = req.user?.email ?? "system";

      // Save to Supabase
      const saved = await supabaseQuery<{ id: number }>(
        `INSERT INTO executive_summaries (company_id, summary, risks, actions, context_hash, generated_by)
         VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6)
         RETURNING id`,
        [
          companyId,
          generated.summary,
          JSON.stringify(generated.risks),
          JSON.stringify(generated.actions),
          contextHash,
          generatedBy,
        ],
      );
      const newId = saved[0]?.id ?? 0;

      // Audit log
      const auditAction = force
        ? "executive.ai_summary_force_generated"
        : "executive.ai_summary_generated";
      try {
        await db.insert(auditLogsTable).values({
          companyId,
          action: auditAction,
          module: "executive",
          entityType: "executive_summary",
          entityId: newId,
          userId: req.user?.id ?? null,
          userEmail: req.user?.email ?? null,
          after: JSON.stringify({ contextHash, force }),
        });
      } catch { /* audit optional */ }

      logger.info({ companyId, summaryId: newId, force, auditAction }, "AI executive summary generated");

      res.json({
        cached: false,
        cacheExpiresAt: new Date(Date.now() + SUMMARY_CACHE_MINUTES * 60 * 1000).toISOString(),
        data: {
          id: newId,
          company_id: companyId,
          ...generated,
          context_hash: contextHash,
          generated_by: generatedBy,
          generated_at: new Date().toISOString(),
        },
      });
    } catch (err) {
      logger.error({ err }, "POST /executive/ai-summary failed");
      res.status(500).json({ error: "Gagal membuat ringkasan AI" });
    }
  },
);

// ── GET /api/executive/ai-summary/latest ─────────────────────────────────────

router.get(
  "/executive/ai-summary/latest",
  ...RBAC,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = getCompanyId(req) ?? "default";
      const rows = await supabaseQuery<ExecSummaryRow>(
        `SELECT id, company_id, summary, risks, actions, context_hash, generated_by, generated_at::text
         FROM executive_summaries
         WHERE company_id = $1
         ORDER BY generated_at DESC
         LIMIT 1`,
        [companyId],
      );
      if (rows.length === 0) {
        res.json({ data: null, cached: false, cacheExpiresAt: null });
        return;
      }
      const row = rows[0];
      const expiresAt = new Date(
        new Date(row.generated_at).getTime() + SUMMARY_CACHE_MINUTES * 60 * 1000,
      );
      const isCached = expiresAt > new Date();
      res.json({
        cached: isCached,
        cacheExpiresAt: expiresAt.toISOString(),
        data: row,
      });
    } catch (err) {
      logger.error({ err }, "GET /executive/ai-summary/latest failed");
      res.status(500).json({ error: "Gagal memuat ringkasan terbaru" });
    }
  },
);

// ── GET /api/executive/ai-summary/history ────────────────────────────────────

router.get(
  "/executive/ai-summary/history",
  ...RBAC,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = getCompanyId(req) ?? "default";
      const limit = Math.min(Number(req.query.limit ?? 20), 50);
      const rows = await supabaseQuery<ExecSummaryRow>(
        `SELECT id, company_id, summary, risks, actions, context_hash, generated_by, generated_at::text
         FROM executive_summaries
         WHERE company_id = $1
         ORDER BY generated_at DESC
         LIMIT $2`,
        [companyId, limit],
      );
      res.json({
        total: rows.length,
        history: rows,
      });
    } catch (err) {
      logger.error({ err }, "GET /executive/ai-summary/history failed");
      res.status(500).json({ error: "Gagal memuat riwayat ringkasan" });
    }
  },
);

export default router;
