/**
 * Sprint 6D/6E — Executive Intelligence Validation
 *
 * Single endpoint that aggregates all 5 intelligence modules into
 * one executive dashboard payload with readiness scores, data quality
 * scores, and a GO/NO-GO decision for Fleet Intelligence.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, getCompanyId } from "../middleware/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── Thresholds ────────────────────────────────────────────────────────────────
const MARGIN_FLOOR = 0.15;
const VENDOR_READINESS_MIN = 60;
const DOC_COMPLIANCE_MIN = 0.8;
const PRICE_DEVIATION_ALERT_PCT = 10;
const GO_THRESHOLD = 65;

// ── Helpers ───────────────────────────────────────────────────────────────────
function pct(num: number, den: number): number {
  if (!den || den === 0) return 0;
  return Math.round((num / den) * 100);
}

function avg(arr: (number | null)[]): number {
  const valid = arr.filter((v): v is number => v !== null && !isNaN(v));
  if (valid.length === 0) return 0;
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
}

// Helper: run a raw SQL query and return the first row (or undefined)
async function row0<T extends Record<string, unknown>>(query: ReturnType<typeof sql>): Promise<T | undefined> {
  const result = await db.execute(query);
  return result.rows[0] as T | undefined;
}

// Helper: run a raw SQL query and return all rows
async function rows<T extends Record<string, unknown>>(query: ReturnType<typeof sql>): Promise<T[]> {
  const result = await db.execute(query);
  return result.rows as T[];
}

// ── GET /api/executive/intelligence ──────────────────────────────────────────
router.get(
  "/executive/intelligence",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = getCompanyId(req) ?? "default";

      // ── A. Customer Intelligence ──────────────────────────────────────────
      // customers.company_id is INTEGER — avoid filtering by TEXT companyId.
      // Derive memory coverage from customer_memory_snapshots (TEXT company_id).
      const custRow = await row0<{
        total: number;
        with_memory: number;
        avg_hours_since_snapshot: number | null;
      }>(sql`
        SELECT
          c.total,
          COALESCE(m.with_memory, 0)              AS with_memory,
          m.avg_hours_since_snapshot
        FROM (SELECT COUNT(*)::int AS total FROM customers) c
        CROSS JOIN (
          SELECT
            COUNT(DISTINCT customer_id)::int AS with_memory,
            ROUND(
              AVG(EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600)
              FILTER (WHERE is_stale = false)
            )::int AS avg_hours_since_snapshot
          FROM customer_memory_snapshots
          WHERE company_id = ${companyId}
        ) m
      `);

      const custStaleRow = await row0<{
        total_with_snapshot: number;
        stale_count: number;
      }>(sql`
        SELECT
          COUNT(*)::int                                AS total_with_snapshot,
          COUNT(*) FILTER (WHERE is_stale = true)::int AS stale_count
        FROM customer_memory_snapshots
        WHERE company_id = ${companyId}
      `);

      const customerIntelligence = {
        memoryCoveragePct: pct(custRow?.with_memory ?? 0, custRow?.total ?? 0),
        staleMemoryPct: pct(
          custStaleRow?.stale_count ?? 0,
          custStaleRow?.total_with_snapshot ?? 0,
        ),
        snapshotFreshnessHours: custRow?.avg_hours_since_snapshot ?? null,
        totalCustomers: custRow?.total ?? 0,
        customersWithMemory: custRow?.with_memory ?? 0,
      };

      // ── B. Vendor Intelligence ────────────────────────────────────────────
      const vRow = await row0<{
        total_vendors: number;
        ready_vendors: number;
        compliant_vendors: number;
        risk_low: number;
        risk_medium: number;
        risk_high: number;
        risk_critical: number;
      }>(sql`
        SELECT
          COUNT(DISTINCT vendor_id)::int AS total_vendors,
          COUNT(DISTINCT vendor_id) FILTER (WHERE readiness_score >= ${VENDOR_READINESS_MIN})::int AS ready_vendors,
          COUNT(DISTINCT vendor_id) FILTER (
            WHERE document_completeness >= ${DOC_COMPLIANCE_MIN}
            AND (critical_docs_missing = false OR critical_docs_missing IS NULL)
          )::int AS compliant_vendors,
          COUNT(DISTINCT vendor_id) FILTER (WHERE risk_tier = 'low')::int      AS risk_low,
          COUNT(DISTINCT vendor_id) FILTER (WHERE risk_tier = 'medium')::int   AS risk_medium,
          COUNT(DISTINCT vendor_id) FILTER (WHERE risk_tier = 'high')::int     AS risk_high,
          COUNT(DISTINCT vendor_id) FILTER (WHERE risk_tier = 'critical')::int AS risk_critical
        FROM intel_vendors
        WHERE company_id = ${companyId}
          AND is_stale = false
      `);

      const vendorIntelligence = {
        vendorReadinessPct: pct(vRow?.ready_vendors ?? 0, vRow?.total_vendors ?? 0),
        documentCompliancePct: pct(vRow?.compliant_vendors ?? 0, vRow?.total_vendors ?? 0),
        riskDistribution: {
          low:      vRow?.risk_low ?? 0,
          medium:   vRow?.risk_medium ?? 0,
          high:     vRow?.risk_high ?? 0,
          critical: vRow?.risk_critical ?? 0,
        },
        totalVendors: vRow?.total_vendors ?? 0,
      };

      // ── C. Recommendation Quality ─────────────────────────────────────────
      const recRow = await row0<{
        avg_acceptance_pct: number | null;
        avg_win_pct: number | null;
        vendors_with_rec_data: number;
      }>(sql`
        SELECT
          ROUND(AVG(recommendation_acceptance_rate) * 100)::int AS avg_acceptance_pct,
          ROUND(AVG(recommendation_win_rate) * 100)::int         AS avg_win_pct,
          COUNT(*) FILTER (WHERE recommendation_acceptance_rate IS NOT NULL)::int AS vendors_with_rec_data
        FROM intel_vendors
        WHERE company_id = ${companyId}
          AND is_stale = false
      `);

      const overRow = await row0<{
        total_evaluated: number;
        overridden: number;
        blocked: number;
      }>(sql`
        SELECT
          COUNT(*)::int AS total_evaluated,
          COUNT(*) FILTER (WHERE ai_risk_tier IN ('high','critical') AND status = 'approved')::int AS overridden,
          COUNT(*) FILTER (WHERE ai_risk_tier IN ('high','critical') AND status = 'rejected')::int AS blocked
        FROM logistic_purchase_requests
        WHERE company_id = ${companyId}
          AND ai_evaluated_at IS NOT NULL
      `);

      const confRow = await row0<{
        total_with_score: number;
        high_conf_completed: number;
        high_conf_total: number;
      }>(sql`
        SELECT
          COUNT(*)::int AS total_with_score,
          COUNT(*) FILTER (WHERE ai_confidence_score = 'high' AND status = 'completed')::int AS high_conf_completed,
          COUNT(*) FILTER (WHERE ai_confidence_score = 'high')::int AS high_conf_total
        FROM ai_tasks
        WHERE company_id = ${companyId}
          AND ai_confidence_score IS NOT NULL
      `);

      const recommendationQuality = {
        acceptancePct: recRow?.avg_acceptance_pct ?? 0,
        winPct: recRow?.avg_win_pct ?? 0,
        overridePct: pct(overRow?.overridden ?? 0, overRow?.total_evaluated ?? 0),
        vendorsWithRecData: recRow?.vendors_with_rec_data ?? 0,
        highConfidenceAccuracyPct: pct(
          confRow?.high_conf_completed ?? 0,
          confRow?.high_conf_total ?? 0,
        ),
        totalEvaluated: overRow?.total_evaluated ?? 0,
        overrideCount: overRow?.overridden ?? 0,
        blockedCount: overRow?.blocked ?? 0,
      };

      // ── D. Purchasing Intelligence ────────────────────────────────────────
      const pRow = await row0<{
        total_requests: number;
        duplicate_flags: number;
        benchmark_alerts: number;
        margin_alerts: number;
        escalation_count: number;
        prevented_duplicates: number;
        prevented_negative_margin: number;
        estimated_savings_idr: number | null;
      }>(sql`
        SELECT
          COUNT(*)::int AS total_requests,
          COUNT(*) FILTER (WHERE ai_duplicate_flag = true)::int AS duplicate_flags,
          COUNT(*) FILTER (
            WHERE ai_price_deviation_pct IS NOT NULL
              AND ai_price_deviation_pct > ${PRICE_DEVIATION_ALERT_PCT}
          )::int AS benchmark_alerts,
          COUNT(*) FILTER (
            WHERE ai_margin_impact_pct IS NOT NULL
              AND ai_margin_impact_pct < ${MARGIN_FLOOR}
          )::int AS margin_alerts,
          COUNT(*) FILTER (WHERE ai_risk_tier IN ('high','critical'))::int AS escalation_count,
          COUNT(*) FILTER (WHERE ai_duplicate_flag = true AND status IN ('rejected','cancelled'))::int AS prevented_duplicates,
          COUNT(*) FILTER (
            WHERE ai_margin_impact_pct IS NOT NULL
              AND ai_margin_impact_pct < 0
              AND status IN ('rejected','cancelled')
          )::int AS prevented_negative_margin,
          ROUND(SUM(
            CASE
              WHEN status = 'approved'
                AND ai_price_deviation_pct IS NOT NULL
                AND ai_price_deviation_pct < 0
              THEN estimated_amount * (ABS(ai_price_deviation_pct) / 100.0)
              ELSE 0
            END
          ))::bigint AS estimated_savings_idr
        FROM logistic_purchase_requests
        WHERE company_id = ${companyId}
      `);

      const purchasingIntelligence = {
        totalRequests: pRow?.total_requests ?? 0,
        duplicatePreventionCount: pRow?.duplicate_flags ?? 0,
        benchmarkDeviationAlerts: pRow?.benchmark_alerts ?? 0,
        marginProtectionAlerts: pRow?.margin_alerts ?? 0,
        approvalEscalationCount: pRow?.escalation_count ?? 0,
      };

      // ── E. Executive ROI ──────────────────────────────────────────────────
      const vOppRow = await row0<{ optimization_opportunities: number }>(sql`
        SELECT COUNT(DISTINCT vendor_id)::int AS optimization_opportunities
        FROM intel_vendors
        WHERE company_id = ${companyId}
          AND (risk_tier IN ('high','critical') OR readiness_score < 40)
          AND is_stale = false
      `);

      const executiveRoi = {
        estimatedSavingsIdr: pRow?.estimated_savings_idr ?? 0,
        preventedDuplicatePurchases: pRow?.prevented_duplicates ?? 0,
        preventedLowMarginPurchases: pRow?.prevented_negative_margin ?? 0,
        vendorOptimizationOpportunities: vOppRow?.optimization_opportunities ?? 0,
      };

      // ── Readiness Score ───────────────────────────────────────────────────
      // intel_readiness_scores columns: dataset_name, overall_readiness_score
      const readinessDatasets = await rows<{
        dataset_name: string;
        avg_score: number;
        row_count: number;
      }>(sql`
        SELECT
          dataset_name,
          ROUND(AVG(overall_readiness_score))::int AS avg_score,
          COUNT(*)::int AS row_count
        FROM intel_readiness_scores
        WHERE company_id = ${companyId}
        GROUP BY dataset_name
      `);

      const datasetScores: Record<string, number> = {};
      for (const r of readinessDatasets) {
        datasetScores[r.dataset_name] = r.avg_score;
      }

      const readinessScore = Math.round(
        (datasetScores["customers"] ?? customerIntelligence.memoryCoveragePct) * 0.25 +
        (datasetScores["vendors"]   ?? vendorIntelligence.vendorReadinessPct) * 0.25 +
        (datasetScores["routes"]    ?? 0) * 0.20 +
        (datasetScores["profit"]    ?? 0) * 0.15 +
        (datasetScores["quotations"]?? 0) * 0.15,
      );

      // ── Data Quality Score ────────────────────────────────────────────────
      const qualityComponents = [
        customerIntelligence.memoryCoveragePct,
        100 - customerIntelligence.staleMemoryPct,
        vendorIntelligence.vendorReadinessPct,
        vendorIntelligence.documentCompliancePct,
        recommendationQuality.vendorsWithRecData > 0 ? 70 : 20,
        purchasingIntelligence.totalRequests > 0 ? 80 : 20,
      ];
      const dataQualityScore = avg(qualityComponents);

      // ── GO/NO-GO ──────────────────────────────────────────────────────────
      const goNoGo: "GO" | "NO-GO" | "CONDITIONAL" = (() => {
        if (readinessScore >= GO_THRESHOLD && dataQualityScore >= 60) return "GO";
        if (readinessScore >= 50 && dataQualityScore >= 50) return "CONDITIONAL";
        return "NO-GO";
      })();

      const goConditions: string[] = [];
      if (customerIntelligence.memoryCoveragePct < 60)
        goConditions.push(`Customer memory coverage at ${customerIntelligence.memoryCoveragePct}% — target ≥60%`);
      if (vendorIntelligence.vendorReadinessPct < 60)
        goConditions.push(`Vendor readiness at ${vendorIntelligence.vendorReadinessPct}% — target ≥60%`);
      if (customerIntelligence.staleMemoryPct > 30)
        goConditions.push(`Stale customer memory at ${customerIntelligence.staleMemoryPct}% — target ≤30%`);
      if (recommendationQuality.vendorsWithRecData === 0)
        goConditions.push("No recommendation outcome data yet — run at least one CMM cycle");
      if (purchasingIntelligence.totalRequests === 0)
        goConditions.push("No purchasing intelligence data — process at least one purchase request");

      res.json({
        generatedAt: new Date().toISOString(),
        readinessScore,
        dataQualityScore,
        goNoGo,
        goConditions,
        datasets: datasetScores,
        customerIntelligence,
        vendorIntelligence,
        recommendationQuality,
        purchasingIntelligence,
        executiveRoi,
      });
    } catch (err) {
      logger.error({ err }, "GET /executive/intelligence failed");
      res.status(500).json({ error: "Failed to load executive intelligence" });
    }
  },
);

export default router;
