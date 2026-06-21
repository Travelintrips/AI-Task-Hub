/**
 * Sprint 6D — Executive Intelligence Validation
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
const GO_THRESHOLD = 65; // readiness score ≥ 65 → GO

// ── Helper ────────────────────────────────────────────────────────────────────
function pct(num: number, den: number): number {
  if (!den || den === 0) return 0;
  return Math.round((num / den) * 100);
}

function avg(arr: (number | null)[]): number {
  const valid = arr.filter((v): v is number => v !== null && !isNaN(v));
  if (valid.length === 0) return 0;
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
}

// ── GET /api/executive/intelligence ──────────────────────────────────────────

router.get(
  "/executive/intelligence",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = getCompanyId(req) ?? "default";

      // ── A. Customer Intelligence ─────────────────────────────────────────
      const [custTotal] = await db.execute(sql`
        SELECT
          COUNT(*)::int                                         AS total,
          COUNT(*) FILTER (WHERE memory_updated_at IS NOT NULL)::int AS with_memory,
          ROUND(
            AVG(EXTRACT(EPOCH FROM (NOW() - memory_updated_at)) / 3600)
            FILTER (WHERE memory_updated_at IS NOT NULL)
          )::int                                                AS avg_hours_since_snapshot
        FROM customers
        WHERE company_id = ${companyId}
      `);

      const [custStale] = await db.execute(sql`
        SELECT
          COUNT(*)::int                            AS total_with_snapshot,
          COUNT(*) FILTER (WHERE is_stale = true)::int AS stale_count
        FROM customer_memory_snapshots
        WHERE company_id = ${companyId}
      `);

      const custRow = custTotal.rows[0] as {
        total: number; with_memory: number; avg_hours_since_snapshot: number | null;
      } | undefined;
      const custStaleRow = custStale.rows[0] as {
        total_with_snapshot: number; stale_count: number;
      } | undefined;

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
      const [vendorStats] = await db.execute(sql`
        SELECT
          COUNT(DISTINCT vendor_id)::int                                              AS total_vendors,
          COUNT(DISTINCT vendor_id) FILTER (WHERE readiness_score >= ${VENDOR_READINESS_MIN})::int
                                                                                      AS ready_vendors,
          COUNT(DISTINCT vendor_id) FILTER (
            WHERE document_completeness >= ${DOC_COMPLIANCE_MIN}
            AND (critical_docs_missing = false OR critical_docs_missing IS NULL)
          )::int                                                                       AS compliant_vendors,
          COUNT(DISTINCT vendor_id) FILTER (WHERE risk_tier = 'low')::int            AS risk_low,
          COUNT(DISTINCT vendor_id) FILTER (WHERE risk_tier = 'medium')::int         AS risk_medium,
          COUNT(DISTINCT vendor_id) FILTER (WHERE risk_tier = 'high')::int           AS risk_high,
          COUNT(DISTINCT vendor_id) FILTER (WHERE risk_tier = 'critical')::int       AS risk_critical
        FROM intel_vendors
        WHERE company_id = ${companyId}
          AND is_stale = false
      `);

      const vRow = vendorStats.rows[0] as {
        total_vendors: number; ready_vendors: number; compliant_vendors: number;
        risk_low: number; risk_medium: number; risk_high: number; risk_critical: number;
      } | undefined;

      const vendorIntelligence = {
        vendorReadinessPct: pct(vRow?.ready_vendors ?? 0, vRow?.total_vendors ?? 0),
        documentCompliancePct: pct(vRow?.compliant_vendors ?? 0, vRow?.total_vendors ?? 0),
        riskDistribution: {
          low: vRow?.risk_low ?? 0,
          medium: vRow?.risk_medium ?? 0,
          high: vRow?.risk_high ?? 0,
          critical: vRow?.risk_critical ?? 0,
        },
        totalVendors: vRow?.total_vendors ?? 0,
      };

      // ── C. Recommendation Quality ─────────────────────────────────────────
      const [recStats] = await db.execute(sql`
        SELECT
          ROUND(AVG(recommendation_acceptance_rate) * 100)::int AS avg_acceptance_pct,
          ROUND(AVG(recommendation_win_rate) * 100)::int         AS avg_win_pct,
          COUNT(*) FILTER (WHERE recommendation_acceptance_rate IS NOT NULL)::int AS vendors_with_rec_data
        FROM intel_vendors
        WHERE company_id = ${companyId}
          AND is_stale = false
      `);

      const [overrideStats] = await db.execute(sql`
        SELECT
          COUNT(*)::int                                                                         AS total_evaluated,
          COUNT(*) FILTER (WHERE ai_risk_tier IN ('high','critical') AND status = 'approved')::int AS overridden,
          COUNT(*) FILTER (WHERE ai_risk_tier IN ('high','critical') AND status = 'rejected')::int AS blocked
        FROM logistic_purchase_requests
        WHERE company_id = ${companyId}
          AND ai_evaluated_at IS NOT NULL
      `);

      const [confAcc] = await db.execute(sql`
        SELECT
          COUNT(*)::int                                              AS total_with_score,
          COUNT(*) FILTER (
            WHERE ai_confidence_score = 'high' AND status = 'completed'
          )::int                                                      AS high_conf_completed,
          COUNT(*) FILTER (WHERE ai_confidence_score = 'high')::int  AS high_conf_total
        FROM ai_tasks
        WHERE company_id = ${companyId}
          AND ai_confidence_score IS NOT NULL
      `);

      const recRow = recStats.rows[0] as {
        avg_acceptance_pct: number | null; avg_win_pct: number | null;
        vendors_with_rec_data: number;
      } | undefined;
      const overRow = overrideStats.rows[0] as {
        total_evaluated: number; overridden: number; blocked: number;
      } | undefined;
      const confRow = confAcc.rows[0] as {
        total_with_score: number; high_conf_completed: number; high_conf_total: number;
      } | undefined;

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
      const [purchStats] = await db.execute(sql`
        SELECT
          COUNT(*)::int                                                                AS total_requests,
          COUNT(*) FILTER (WHERE ai_duplicate_flag = true)::int                       AS duplicate_flags,
          COUNT(*) FILTER (
            WHERE ai_price_deviation_pct IS NOT NULL
              AND ai_price_deviation_pct > ${PRICE_DEVIATION_ALERT_PCT}
          )::int                                                                       AS benchmark_alerts,
          COUNT(*) FILTER (
            WHERE ai_margin_impact_pct IS NOT NULL
              AND ai_margin_impact_pct < ${MARGIN_FLOOR}
          )::int                                                                       AS margin_alerts,
          COUNT(*) FILTER (WHERE ai_risk_tier IN ('high','critical'))::int            AS escalation_count,
          COUNT(*) FILTER (WHERE ai_duplicate_flag = true AND status IN ('rejected','cancelled'))::int
                                                                                       AS prevented_duplicates,
          COUNT(*) FILTER (
            WHERE ai_margin_impact_pct IS NOT NULL
              AND ai_margin_impact_pct < 0
              AND status IN ('rejected','cancelled')
          )::int                                                                       AS prevented_negative_margin,
          ROUND(
            SUM(
              CASE
                WHEN status = 'approved'
                  AND ai_price_deviation_pct IS NOT NULL
                  AND ai_price_deviation_pct < 0
                THEN estimated_amount * (ABS(ai_price_deviation_pct) / 100.0)
                ELSE 0
              END
            )
          )::bigint                                                                    AS estimated_savings_idr
        FROM logistic_purchase_requests
        WHERE company_id = ${companyId}
      `);

      const pRow = purchStats.rows[0] as {
        total_requests: number; duplicate_flags: number; benchmark_alerts: number;
        margin_alerts: number; escalation_count: number; prevented_duplicates: number;
        prevented_negative_margin: number; estimated_savings_idr: number | null;
      } | undefined;

      const purchasingIntelligence = {
        totalRequests: pRow?.total_requests ?? 0,
        duplicatePreventionCount: pRow?.duplicate_flags ?? 0,
        benchmarkDeviationAlerts: pRow?.benchmark_alerts ?? 0,
        marginProtectionAlerts: pRow?.margin_alerts ?? 0,
        approvalEscalationCount: pRow?.escalation_count ?? 0,
      };

      // ── E. Executive ROI ──────────────────────────────────────────────────
      const [vendorOpps] = await db.execute(sql`
        SELECT COUNT(DISTINCT vendor_id)::int AS optimization_opportunities
        FROM intel_vendors
        WHERE company_id = ${companyId}
          AND (risk_tier IN ('high','critical') OR readiness_score < 40)
          AND is_stale = false
      `);

      const vOppRow = vendorOpps.rows[0] as { optimization_opportunities: number } | undefined;

      const executiveRoi = {
        estimatedSavingsIdr: pRow?.estimated_savings_idr ?? 0,
        preventedDuplicatePurchases: pRow?.prevented_duplicates ?? 0,
        preventedLowMarginPurchases: pRow?.prevented_negative_margin ?? 0,
        vendorOptimizationOpportunities: vOppRow?.optimization_opportunities ?? 0,
      };

      // ── Readiness Score ───────────────────────────────────────────────────
      // Pull from intel_readiness_scores table (populated by intel-refresh scheduler)
      const [readinessRows] = await db.execute(sql`
        SELECT
          dataset,
          ROUND(AVG(readiness_score))::int AS avg_score,
          COUNT(*) AS row_count
        FROM intel_readiness_scores
        WHERE company_id = ${companyId}
        GROUP BY dataset
      `);

      const readinessDatasets = (readinessRows?.rows ?? []) as Array<{
        dataset: string; avg_score: number; row_count: number;
      }>;

      const datasetScores: Record<string, number> = {};
      for (const r of readinessDatasets) {
        datasetScores[r.dataset] = r.avg_score;
      }

      // Weighted readiness:
      // customers 25%, vendors 25%, routes 20%, profit 15%, quotations 15%
      const readinessScore = Math.round(
        (datasetScores["customers"] ?? customerIntelligence.memoryCoveragePct) * 0.25 +
        (datasetScores["vendors"] ?? vendorIntelligence.vendorReadinessPct) * 0.25 +
        (datasetScores["routes"] ?? 0) * 0.20 +
        (datasetScores["profit"] ?? 0) * 0.15 +
        (datasetScores["quotations"] ?? 0) * 0.15,
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

      const generatedAt = new Date().toISOString();

      res.json({
        generatedAt,
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
