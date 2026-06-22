/**
 * Sprint 7D — Driver Memory API
 *
 * GET  /api/fleet/drivers/:id/memory        — ambil snapshot memory pengemudi
 * POST /api/fleet/drivers/:id/memory/refresh — hitung ulang memory pengemudi
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth";
import { logger } from "../lib/logger";
import { supabaseQuery } from "../lib/supabase-db";

const router: IRouter = Router();
function cid(req: Request): string { return req.user?.companyId ?? "default"; }

// ── GET /api/fleet/drivers/:id/memory ────────────────────────────────────────

router.get("/fleet/drivers/:id/memory", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const driverId = parseInt(req.params.id as string);
    if (isNaN(driverId)) return res.status(400).json({ error: "Driver ID tidak valid" });

    const rows = await supabaseQuery(`
      SELECT * FROM driver_memory_snapshots
      WHERE driver_id = $1
      ORDER BY refreshed_at DESC LIMIT 1
    `, [driverId]);

    if (!rows.length) {
      return res.status(404).json({ error: "Memory snapshot belum tersedia untuk driver ini. Jalankan /refresh terlebih dahulu." });
    }

    return res.json({ data: rows[0] });
  } catch (err) {
    logger.error({ err }, "GET /fleet/drivers/:id/memory failed");
    return res.status(500).json({ error: "Gagal mengambil driver memory" });
  }
});

// ── POST /api/fleet/drivers/:id/memory/refresh ───────────────────────────────

router.post("/fleet/drivers/:id/memory/refresh", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const driverId = parseInt(req.params.id as string);
    if (isNaN(driverId)) return res.status(400).json({ error: "Driver ID tidak valid" });
    const t0 = Date.now();

    // Get driver info
    const driverRows = await supabaseQuery<{ full_name: string; assigned_vehicle_id: number | null }>(`
      SELECT full_name, assigned_vehicle_id
      FROM fleet_drivers WHERE id = $1 AND company_id = $2
    `, [driverId, companyId]);

    if (!driverRows.length) return res.status(404).json({ error: "Driver tidak ditemukan" });
    const driver = driverRows[0];

    // Performance data (last 3 months)
    const period3Months = new Date();
    period3Months.setMonth(period3Months.getMonth() - 3);
    const period3 = period3Months.toISOString().slice(0, 7);

    const perf = await supabaseQuery<{ avg_score: number | null; total_trips: number | null; avg_fuel_efficiency: number | null }>(`
      SELECT
        AVG(overall_score) AS avg_score,
        SUM(total_trips) AS total_trips,
        AVG(avg_km_per_liter) AS avg_fuel_efficiency
      FROM fleet_driver_performance
      WHERE driver_id = $1 AND period_month >= $2
    `, [driverId, period3]);

    const p = perf[0];
    const avgScore = p?.avg_score != null ? Number(p.avg_score) : null;
    const totalTrips = Number(p?.total_trips ?? 0);
    const avgFuelEff = p?.avg_fuel_efficiency != null ? Number(p.avg_fuel_efficiency) : null;

    // Incidents (last 6 months)
    const incidents = await supabaseQuery<{ count: string; incident_types: string }>(`
      SELECT
        COUNT(*) AS count,
        STRING_AGG(DISTINCT incident_type, ', ') AS incident_types
      FROM fleet_driver_incidents
      WHERE driver_id = $1 AND incident_date >= NOW() - INTERVAL '6 months'
    `, [driverId]);
    const totalIncidents = parseInt(incidents[0]?.count ?? "0");
    const incidentTypes = incidents[0]?.incident_types ?? "";

    // Preferred routes from utilization logs
    const routes = await supabaseQuery<{ route: string; count: string }>(`
      SELECT
        COALESCE(NULLIF(trip_purpose,''), origin || ' → ' || destination, 'Unknown') AS route,
        COUNT(*) AS count
      FROM fleet_utilization_logs
      WHERE driver_id = $1 AND actual_departure >= NOW() - INTERVAL '90 days'
        AND (trip_purpose IS NOT NULL OR (origin IS NOT NULL AND destination IS NOT NULL))
      GROUP BY 1 ORDER BY count DESC LIMIT 5
    `, [driverId]).catch(() => []);

    // Fuel trends
    const fuelTrend = await supabaseQuery<{ period_month: string; avg_kpl: number }>(`
      SELECT period_month, AVG(avg_km_per_liter) AS avg_kpl
      FROM fleet_driver_performance
      WHERE driver_id = $1 AND period_month >= $2
      GROUP BY period_month ORDER BY period_month
    `, [driverId, period3]);

    // Compute trends
    let fuelEfficiencyTrend = "stable";
    if (fuelTrend.length >= 2) {
      const first = Number(fuelTrend[0]?.avg_kpl ?? 0);
      const last = Number(fuelTrend[fuelTrend.length - 1]?.avg_kpl ?? 0);
      if (last > first * 1.05) fuelEfficiencyTrend = "improving";
      else if (last < first * 0.95) fuelEfficiencyTrend = "declining";
    }

    let safetyTrend = "stable";
    if (totalIncidents === 0) safetyTrend = "excellent";
    else if (totalIncidents > 3) safetyTrend = "needs_attention";

    // Build strengths/weaknesses
    const strengths: string[] = [];
    const weaknesses: string[] = [];

    if (avgScore !== null && avgScore >= 80) strengths.push("Performa tinggi konsisten");
    if (avgScore !== null && avgScore < 60) weaknesses.push("Performa di bawah standar");
    if (totalIncidents === 0) strengths.push("Catatan keamanan bersih");
    if (totalIncidents > 2) weaknesses.push(`${totalIncidents} insiden dalam 6 bulan (${incidentTypes})`);
    if (fuelEfficiencyTrend === "improving") strengths.push("Efisiensi BBM membaik");
    if (fuelEfficiencyTrend === "declining") weaknesses.push("Efisiensi BBM menurun");
    if (totalTrips >= 50) strengths.push(`Pengalaman tinggi (${totalTrips} trips)`);

    const performanceSummary = [
      avgScore != null ? `Skor rata-rata: ${Math.round(avgScore)}/100` : null,
      `Total trips (3 bulan): ${totalTrips}`,
      avgFuelEff != null ? `Efisiensi BBM: ${avgFuelEff.toFixed(1)} km/L` : null,
      `Insiden (6 bulan): ${totalIncidents}`,
    ].filter(Boolean).join(". ");

    const preferredRoutes = routes.map(r => r.route);

    const aiContextBlock = [
      `Driver: ${driver.full_name} (ID: ${driverId}).`,
      performanceSummary,
      strengths.length > 0 ? `Kekuatan: ${strengths.join(", ")}.` : null,
      weaknesses.length > 0 ? `Area perbaikan: ${weaknesses.join(", ")}.` : null,
      routes.length > 0 ? `Rute favorit: ${preferredRoutes.slice(0, 3).join(", ")}.` : null,
      `Safety trend: ${safetyTrend}. Fuel trend: ${fuelEfficiencyTrend}.`,
    ].filter(Boolean).join(" ");

    const validUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    await supabaseQuery(`
      INSERT INTO driver_memory_snapshots
        (company_id, driver_id, driver_name, strengths, weaknesses, preferred_routes,
         fuel_efficiency_trend, safety_trend, performance_summary, ai_context_block,
         avg_score, total_trips, total_incidents, freshness_score, valid_until, refreshed_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,100,$14,NOW(),NOW())
      ON CONFLICT (driver_id) DO UPDATE SET
        driver_name=$3, strengths=$4, weaknesses=$5, preferred_routes=$6,
        fuel_efficiency_trend=$7, safety_trend=$8, performance_summary=$9, ai_context_block=$10,
        avg_score=$11, total_trips=$12, total_incidents=$13, freshness_score=100, valid_until=$14,
        refreshed_at=NOW(), updated_at=NOW()
    `, [
      companyId, driverId, driver.full_name,
      JSON.stringify(strengths), JSON.stringify(weaknesses), JSON.stringify(preferredRoutes),
      fuelEfficiencyTrend, safetyTrend, performanceSummary, aiContextBlock,
      avgScore, totalTrips, totalIncidents, validUntil,
    ]);

    const snapshot = await supabaseQuery(`
      SELECT * FROM driver_memory_snapshots WHERE driver_id = $1 ORDER BY refreshed_at DESC LIMIT 1
    `, [driverId]);

    return res.json({
      success: true,
      durationMs: Date.now() - t0,
      data: snapshot[0],
    });
  } catch (err) {
    logger.error({ err }, "POST /fleet/drivers/:id/memory/refresh failed");
    return res.status(500).json({ error: "Gagal refresh driver memory" });
  }
});

export default router;
