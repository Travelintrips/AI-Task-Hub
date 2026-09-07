/**
 * Sprint 7D — Fleet Cost per KM API
 *
 * GET  /api/fleet/cost-per-km           — list cost per KM semua unit
 * GET  /api/fleet/cost-per-km/summary   — ringkasan agregat
 * POST /api/fleet/cost-per-km/recompute — hitung ulang cost per KM
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth";
import { logger } from "../lib/logger";
import { supabaseQuery } from "../lib/supabase-db";

const router: IRouter = Router();
function cid(req: Request): string { return req.user?.companyId ?? "default"; }

// ── GET /api/fleet/cost-per-km/summary (before /:unitId) ─────────────────────

router.get("/fleet/cost-per-km/summary", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);

    const summary = await supabaseQuery(`
      SELECT
        period_month,
        COUNT(DISTINCT fleet_unit_id) AS unit_count,
        SUM(total_km) AS total_km,
        SUM(total_cost) AS total_cost,
        AVG(cost_per_km) AS avg_cost_per_km,
        SUM(revenue_generated) AS total_revenue,
        SUM(gross_profit) AS total_profit,
        AVG(profit_margin_pct) AS avg_margin_pct
      FROM fleet_cost_per_km
      WHERE company_id = $1
      GROUP BY period_month
      ORDER BY period_month DESC
      LIMIT 12
    `, [companyId]);

    const bestUnit = await supabaseQuery(`
      SELECT unit_number, plate_number, cost_per_km
      FROM fleet_cost_per_km
      WHERE company_id = $1 AND period_month = TO_CHAR(NOW(), 'YYYY-MM') AND total_km > 0
      ORDER BY cost_per_km ASC LIMIT 1
    `, [companyId]);

    const worstUnit = await supabaseQuery(`
      SELECT unit_number, plate_number, cost_per_km
      FROM fleet_cost_per_km
      WHERE company_id = $1 AND period_month = TO_CHAR(NOW(), 'YYYY-MM') AND total_km > 0
      ORDER BY cost_per_km DESC LIMIT 1
    `, [companyId]);

    return res.json({
      data: summary,
      bestUnit: bestUnit[0] ?? null,
      worstUnit: worstUnit[0] ?? null,
    });
  } catch (err) {
    logger.error({ err }, "GET /fleet/cost-per-km/summary failed");
    return res.status(500).json({ error: "Gagal mengambil ringkasan cost" });
  }
});

// ── GET /api/fleet/cost-per-km ────────────────────────────────────────────────

router.get("/fleet/cost-per-km", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const period = (req.query.period as string) || "all";

    let periodFilter = "";
    const params: unknown[] = [companyId];

    if (period !== "all") {
      periodFilter = "AND period_month = $2";
      params.push(period);
    }

    const rows = await supabaseQuery(`
      SELECT * FROM fleet_cost_per_km
      WHERE company_id = $1 ${periodFilter}
      ORDER BY period_month DESC, cost_per_km ASC
    `, params);

    return res.json({ data: rows, total: rows.length });
  } catch (err) {
    logger.error({ err }, "GET /fleet/cost-per-km failed");
    return res.status(500).json({ error: "Gagal mengambil cost per KM" });
  }
});

// ── POST /api/fleet/cost-per-km/recompute ─────────────────────────────────────

router.post("/fleet/cost-per-km/recompute", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const t0 = Date.now();
    const period = (req.body as Record<string, string>).period || new Date().toISOString().slice(0, 7);

    // Parse period to get date range
    const [year, month] = period.split("-").map(Number);
    const startDate = `${period}-01`;
    const endDate = new Date(year, month, 1).toISOString().split("T")[0];

    const units = await supabaseQuery<{ id: number; unit_number: string; plate_number: string; year: number | null }>(`
      SELECT id, unit_number, plate_number, year
      FROM fleet_units WHERE company_id = $1 AND is_active = true
    `, [companyId]);

    const results = [];

    for (const unit of units) {
      try {
        // Total KM from utilization logs (actual_km column)
        const kmData = await supabaseQuery<{ total_km: number | null }>(`
          SELECT COALESCE(SUM(actual_km), 0) AS total_km
          FROM fleet_utilization_logs
          WHERE fleet_unit_id = $1 AND company_id = $2
            AND actual_departure >= $3 AND actual_departure < $4
        `, [unit.id, companyId, startDate, endDate]);
        const totalKm = Number(kmData[0]?.total_km ?? 0);

        // Fuel cost
        const fuelData = await supabaseQuery<{ fuel_cost: number | null }>(`
          SELECT COALESCE(SUM(total_cost), 0) AS fuel_cost
          FROM fleet_fuel_logs
          WHERE fleet_unit_id = $1 AND company_id = $2
            AND logged_at >= $3 AND logged_at < $4
        `, [unit.id, companyId, startDate, endDate]);
        const fuelCost = Number(fuelData[0]?.fuel_cost ?? 0);

        // Maintenance cost
        const maintData = await supabaseQuery<{ maint_cost: number | null }>(`
          SELECT COALESCE(SUM(actual_cost), 0) AS maint_cost
          FROM fleet_maintenance_records
          WHERE fleet_unit_id = $1 AND company_id = $2
            AND completed_date >= $3 AND completed_date < $4
        `, [unit.id, companyId, startDate, endDate]);
        const maintenanceCost = Number(maintData[0]?.maint_cost ?? 0);

        // Tire cost
        const tireData = await supabaseQuery<{ tire_cost: number | null }>(`
          SELECT COALESCE(SUM(purchase_cost), 0) AS tire_cost
          FROM fleet_tires
          WHERE fleet_unit_id = $1 AND company_id = $2
            AND installed_at >= $3 AND installed_at < $4
        `, [unit.id, companyId, startDate, endDate]);
        const tireCost = Number(tireData[0]?.tire_cost ?? 0);

        // Depreciation (simplified: purchase value / 10 years / 12 months)
        const depreciationCost = 0; // Default — can be extended

        // Revenue from purchasing signals
        const revData = await supabaseQuery<{ revenue: number | null }>(`
          SELECT COALESCE(SUM(estimated_value), 0) AS revenue
          FROM purchasing_signals
          WHERE company_id = $1 AND source_module = 'fleet'
            AND detected_at >= $3 AND detected_at < $4
        `, [companyId, unit.id, startDate, endDate]).catch(() => [{ revenue: 0 }]);
        const revenue = Number(revData[0]?.revenue ?? 0);

        const totalCost = fuelCost + maintenanceCost + tireCost + depreciationCost;
        const costPerKm = totalKm > 0 ? totalCost / totalKm : 0;
        const grossProfit = revenue - totalCost;
        const profitMarginPct = revenue > 0 ? (grossProfit / revenue) * 100 : 0;

        await supabaseQuery(`
          INSERT INTO fleet_cost_per_km
            (company_id, fleet_unit_id, unit_number, plate_number, period_month,
             total_km, fuel_cost, maintenance_cost, tire_cost, depreciation_cost,
             total_cost, cost_per_km, revenue_generated, gross_profit, profit_margin_pct,
             computed_at, updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW(),NOW())
          ON CONFLICT (company_id, fleet_unit_id, period_month)
          DO UPDATE SET
            total_km = EXCLUDED.total_km,
            fuel_cost = EXCLUDED.fuel_cost,
            maintenance_cost = EXCLUDED.maintenance_cost,
            tire_cost = EXCLUDED.tire_cost,
            depreciation_cost = EXCLUDED.depreciation_cost,
            total_cost = EXCLUDED.total_cost,
            cost_per_km = EXCLUDED.cost_per_km,
            revenue_generated = EXCLUDED.revenue_generated,
            gross_profit = EXCLUDED.gross_profit,
            profit_margin_pct = EXCLUDED.profit_margin_pct,
            computed_at = NOW(),
            updated_at = NOW()
        `, [
          companyId, unit.id, unit.unit_number, unit.plate_number, period,
          totalKm, fuelCost, maintenanceCost, tireCost, depreciationCost,
          totalCost, costPerKm, revenue, grossProfit, profitMarginPct,
        ]);

        results.push({ unitId: unit.id, unitNumber: unit.unit_number, period, costPerKm: Math.round(costPerKm) });
      } catch (e) {
        logger.warn({ e, unitId: unit.id }, "Cost compute failed for unit");
        results.push({ unitId: unit.id, unitNumber: unit.unit_number, error: String(e) });
      }
    }

    await supabaseQuery(`
      INSERT INTO fleet_scheduler_runs (company_id, job_name, trigger, status, records_processed, duration_ms, ran_at)
      VALUES ($1, 'fleet-cost-per-km-compute', 'manual', 'success', $2, $3, NOW())
    `, [companyId, results.length, Date.now() - t0]);

    return res.json({ success: true, period, processed: results.length, durationMs: Date.now() - t0, results });
  } catch (err) {
    logger.error({ err }, "POST /fleet/cost-per-km/recompute failed");
    return res.status(500).json({ error: "Gagal recompute cost per KM" });
  }
});

export default router;
