/**
 * Sprint 7D — Fleet Route Profitability API
 *
 * GET  /api/fleet/route-profitability           — list rute + margin
 * POST /api/fleet/route-profitability/recompute — hitung ulang dari utilization logs
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth";
import { logger } from "../lib/logger";
import { supabaseQuery } from "../lib/supabase-db";

const router: IRouter = Router();
function cid(req: Request): string { return req.user?.companyId ?? "default"; }

// ── GET /api/fleet/route-profitability ───────────────────────────────────────

router.get("/fleet/route-profitability", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const period = req.query.period as string;

    let whereExtra = "";
    const params: unknown[] = [companyId];

    if (period) {
      whereExtra = "AND period_month = $2";
      params.push(period);
    }

    const rows = await supabaseQuery(`
      SELECT * FROM fleet_route_profitability
      WHERE company_id = $1 ${whereExtra}
      ORDER BY margin_pct DESC
    `, params);

    const best = rows[0] ?? null;
    const worst = rows.length > 0 ? rows[rows.length - 1] : null;

    return res.json({ data: rows, total: rows.length, mostProfitable: best, leastProfitable: worst });
  } catch (err) {
    logger.error({ err }, "GET /fleet/route-profitability failed");
    return res.status(500).json({ error: "Gagal mengambil route profitability" });
  }
});

// ── POST /api/fleet/route-profitability/recompute ────────────────────────────

router.post("/fleet/route-profitability/recompute", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const t0 = Date.now();
    const period = (req.body as Record<string, string>).period || new Date().toISOString().slice(0, 7);
    const [year, month] = period.split("-").map(Number);
    const startDate = `${period}-01`;
    const endDate = new Date(year, month, 1).toISOString().split("T")[0];

    // Aggregate routes from fleet_utilization_logs
    const routeRows = await supabaseQuery<{
      route: string;
      total_trips: string;
      total_km: number;
      top_unit_id: number | null;
      top_unit_number: string | null;
    }>(`
      SELECT
        COALESCE(NULLIF(trip_purpose,''), origin || ' → ' || destination, 'Unknown') AS route,
        COUNT(*) AS total_trips,
        COALESCE(SUM(actual_km), 0) AS total_km,
        NULL::integer AS top_unit_id,
        NULL::text AS top_unit_number
      FROM fleet_utilization_logs
      WHERE company_id = $1
        AND actual_departure >= $2 AND actual_departure < $3
        AND (trip_purpose IS NOT NULL OR (origin IS NOT NULL AND destination IS NOT NULL))
      GROUP BY 1
      ORDER BY total_trips DESC
    `, [companyId, startDate, endDate]);

    // Get intel_routes for revenue signals
    const intelRoutes = await supabaseQuery<{ route: string; total_revenue: number; avg_margin_pct: number }>(`
      SELECT route, total_revenue, avg_margin_pct
      FROM intel_routes WHERE company_id = $1
    `, [companyId]).catch(() => []);

    const routeRevenueMap = new Map(intelRoutes.map(r => [r.route, r]));

    const results = [];

    for (const row of routeRows) {
      const trips = parseInt(String(row.total_trips)) || 0;
      const km = Number(row.total_km) || 0;

      // Estimate vehicle cost: avg cost_per_km × km
      const costData = await supabaseQuery<{ avg_cpk: number | null }>(`
        SELECT AVG(cost_per_km) AS avg_cpk FROM fleet_cost_per_km
        WHERE company_id = $1 AND period_month = $2
      `, [companyId, period]);
      const avgCpk = Number(costData[0]?.avg_cpk ?? 2500);
      const vehicleCost = km * avgCpk;

      // Revenue from intel_routes
      const intel = routeRevenueMap.get(row.route);
      const revenue = intel ? Number(intel.total_revenue) * (trips / Math.max(trips, 1)) : vehicleCost * 1.3;
      const margin = revenue - vehicleCost;
      const marginPct = revenue > 0 ? (margin / revenue) * 100 : 0;

      await supabaseQuery(`
        INSERT INTO fleet_route_profitability
          (company_id, route, period_month, total_trips, total_km, vehicle_cost,
           revenue, margin, margin_pct, top_unit_id, top_unit_number, computed_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())
        ON CONFLICT (company_id, route, period_month)
        DO UPDATE SET
          total_trips = EXCLUDED.total_trips,
          total_km = EXCLUDED.total_km,
          vehicle_cost = EXCLUDED.vehicle_cost,
          revenue = EXCLUDED.revenue,
          margin = EXCLUDED.margin,
          margin_pct = EXCLUDED.margin_pct,
          top_unit_id = EXCLUDED.top_unit_id,
          top_unit_number = EXCLUDED.top_unit_number,
          computed_at = NOW(),
          updated_at = NOW()
      `, [
        companyId, row.route, period, trips, km, vehicleCost,
        revenue, margin, marginPct, row.top_unit_id, row.top_unit_number,
      ]);

      results.push({ route: row.route, trips, km, margin: Math.round(margin), marginPct: Math.round(marginPct) });
    }

    await supabaseQuery(`
      INSERT INTO fleet_scheduler_runs (company_id, job_name, trigger, status, records_processed, duration_ms, ran_at)
      VALUES ($1, 'fleet-route-profitability-compute', 'manual', 'success', $2, $3, NOW())
    `, [companyId, results.length, Date.now() - t0]);

    return res.json({ success: true, period, processed: results.length, durationMs: Date.now() - t0, results });
  } catch (err) {
    logger.error({ err }, "POST /fleet/route-profitability/recompute failed");
    return res.status(500).json({ error: "Gagal recompute route profitability" });
  }
});

export default router;
