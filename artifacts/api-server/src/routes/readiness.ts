/**
 * Phase 6 — Memory Readiness Endpoint
 * Sprint 8D — Pre-Sprint 9 Hardening
 *
 * GET /api/readiness/memory
 *
 * Returns:
 *   customerCoverage   — % customers with active snapshots
 *   vendorCoverage     — % vendors/suppliers with active snapshots
 *   customerSnapshots  — total snapshot count
 *   vendorSnapshots    — total vendor snapshot count
 *   customerEvents     — total customer memory events
 *   vendorEvents       — total vendor memory events
 *   readinessScore     — weighted 0-100
 */

import { Router, type IRouter } from "express";
import { requireAuth } from "../middleware/auth";
import { supabaseQuery } from "../lib/supabase-db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/readiness/memory", requireAuth, async (req, res) => {
  try {
    const companyId = (req as any).user?.companyId ?? "default";

    // Customer memory coverage
    const [custTotal, custSnaps, custEvents, custPrefs] = await Promise.all([
      supabaseQuery<{ cnt: string }>(
        `SELECT COUNT(*) as cnt FROM customers`,
        []
      ),
      supabaseQuery<{ cnt: string; stale_cnt: string }>(
        `SELECT COUNT(*) as cnt, COUNT(*) FILTER (WHERE is_stale = true) as stale_cnt
         FROM customer_memory_snapshots WHERE company_id = $1`,
        [companyId]
      ),
      supabaseQuery<{ cnt: string }>(
        `SELECT COUNT(*) as cnt FROM customer_memory_events WHERE company_id = $1`,
        [companyId]
      ),
      supabaseQuery<{ cnt: string }>(
        `SELECT COUNT(*) as cnt FROM customer_preferences WHERE company_id = $1`,
        [companyId]
      ),
    ]);

    // Vendor memory coverage
    const [vendTotal, vendSnaps, vendPerfSnaps, vendEvents, vendPrefs] = await Promise.all([
      supabaseQuery<{ cnt: string }>(
        `SELECT COUNT(*) as cnt FROM suppliers`,
        []
      ),
      supabaseQuery<{ cnt: string; stale_cnt: string }>(
        `SELECT COUNT(*) as cnt, COUNT(*) FILTER (WHERE is_stale = true) as stale_cnt
         FROM vendor_memory_snapshots WHERE company_id = $1`,
        [companyId]
      ),
      supabaseQuery<{ cnt: string }>(
        `SELECT COUNT(*) as cnt FROM vendor_performance_snapshots WHERE company_id = $1`,
        [companyId]
      ),
      supabaseQuery<{ cnt: string }>(
        `SELECT COUNT(*) as cnt FROM vendor_memory_events WHERE company_id = $1`,
        [companyId]
      ),
      supabaseQuery<{ cnt: string }>(
        `SELECT COUNT(*) as cnt FROM vendor_preferences WHERE company_id = $1`,
        [companyId]
      ),
    ]);

    const totalCustomers = parseInt(custTotal[0]?.cnt ?? "0");
    const customerSnapshots = parseInt(custSnaps[0]?.cnt ?? "0");
    const customerStaleSnapshots = parseInt(custSnaps[0]?.stale_cnt ?? "0");
    const customerEvents = parseInt(custEvents[0]?.cnt ?? "0");
    const customerPreferences = parseInt(custPrefs[0]?.cnt ?? "0");

    const totalVendors = parseInt(vendTotal[0]?.cnt ?? "0");
    const vendorSnapshots = parseInt(vendSnaps[0]?.cnt ?? "0");
    const vendorStaleSnapshots = parseInt(vendSnaps[0]?.stale_cnt ?? "0");
    const vendorPerfSnapshots = parseInt(vendPerfSnaps[0]?.cnt ?? "0");
    const vendorEvents = parseInt(vendEvents[0]?.cnt ?? "0");
    const vendorPreferences = parseInt(vendPrefs[0]?.cnt ?? "0");

    // Coverage percentages
    const customerCoverage = totalCustomers > 0
      ? Math.round((customerSnapshots / totalCustomers) * 100)
      : 0;
    const vendorCoverage = totalVendors > 0
      ? Math.round((vendorSnapshots / totalVendors) * 100)
      : 0;

    // Weighted readiness score
    // Customer: 40% — Vendor: 40% — Events quality: 20%
    const customerScore = Math.min(100,
      customerCoverage * 0.6 +
      (customerEvents > 0 ? 20 : 0) +
      (customerPreferences > 0 ? 10 : 0) +
      (customerStaleSnapshots === 0 && customerSnapshots > 0 ? 10 : 0)
    );
    const vendorScore = Math.min(100,
      vendorCoverage * 0.6 +
      (vendorPerfSnapshots > 0 ? 20 : 0) +
      (vendorEvents > 0 ? 10 : 0) +
      (vendorPreferences > 0 ? 10 : 0)
    );
    const readinessScore = Math.round(customerScore * 0.4 + vendorScore * 0.4 +
      (customerEvents + vendorEvents > 0 ? 20 : 0) * 0.2
    );

    // Readiness verdict
    let verdict: "GO" | "CONDITIONAL" | "NO-GO";
    if (readinessScore >= 70 && customerCoverage >= 80 && vendorCoverage >= 80) verdict = "GO";
    else if (readinessScore >= 40 && customerCoverage >= 50) verdict = "CONDITIONAL";
    else verdict = "NO-GO";

    const gaps: string[] = [];
    if (customerCoverage < 90) gaps.push(`Customer coverage hanya ${customerCoverage}% (target: 90%)`);
    if (vendorCoverage < 90) gaps.push(`Vendor coverage hanya ${vendorCoverage}% (target: 90%)`);
    if (customerEvents === 0) gaps.push("Tidak ada customer memory events — perlu jalankan backfill");
    if (vendorEvents === 0) gaps.push("Tidak ada vendor memory events — perlu jalankan backfill");
    if (customerPreferences === 0) gaps.push("Customer preferences kosong — belum ada preferensi yang dipelajari");
    if (vendorPerfSnapshots === 0) gaps.push("Vendor performance snapshots kosong");

    res.json({
      // Core metrics
      customerCoverage,
      vendorCoverage,
      customerSnapshots,
      vendorSnapshots,
      customerEvents,
      vendorEvents,

      // Extended metrics
      totalCustomers,
      totalVendors,
      customerStaleSnapshots,
      vendorStaleSnapshots,
      vendorPerfSnapshots,
      customerPreferences,
      vendorPreferences,

      // Score & verdict
      readinessScore,
      verdict,
      gaps,

      // Targets
      targets: {
        customerCoverage: 90,
        vendorCoverage: 90,
        readinessScore: 70,
      },

      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "readiness/memory: failed");
    res.status(500).json({ error: "Failed to compute memory readiness" });
  }
});

export default router;
