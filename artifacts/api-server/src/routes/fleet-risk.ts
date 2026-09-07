/**
 * Sprint 7D — Fleet Risk Score API
 *
 * GET  /api/fleet/risk-scores          — list semua risk score per unit
 * GET  /api/fleet/risk-scores/:unitId  — detail risk score 1 unit
 * POST /api/fleet/risk-scores/refresh  — hitung ulang risk score semua unit
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth";
import { logger } from "../lib/logger";
import { supabaseQuery } from "../lib/supabase-db";

const router: IRouter = Router();
function cid(req: Request): string { return req.user?.companyId ?? "default"; }

// ── Scoring helpers ───────────────────────────────────────────────────────────

interface RiskComponents {
  docScore: number;
  maintenanceScore: number;
  fuelScore: number;
  driverScore: number;
  ageScore: number;
  utilizationScore: number;
}

function computeOverall(c: RiskComponents): number {
  return (
    c.docScore * 0.25 +
    c.maintenanceScore * 0.25 +
    c.fuelScore * 0.15 +
    c.driverScore * 0.15 +
    c.ageScore * 0.10 +
    c.utilizationScore * 0.10
  );
}

function riskLevel(score: number): string {
  if (score >= 80) return "LOW";
  if (score >= 60) return "MEDIUM";
  if (score >= 40) return "HIGH";
  return "CRITICAL";
}

interface FleetUnit {
  id: number;
  unit_number: string;
  plate_number: string;
  year: number | null;
  status: string;
  company_id: string;
}

interface DocRow { total: string; expired: string; expiring: string; }
interface MaintRow { overdue: string; last_days: string; }
interface FuelRow { avg_efficiency: number | null; benchmark: number | null; anomalies: string; }
interface DriverPerfRow { avg_score: number | null; }
interface UtilRow { util_pct: number | null; }

async function computeRiskForUnit(unit: FleetUnit, companyId: string): Promise<{
  components: RiskComponents;
  overall: number;
  level: string;
  factors: string[];
}> {
  const factors: string[] = [];

  // 1. Document score (25%)
  const docs = await supabaseQuery<DocRow>(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE status = 'expired') AS expired,
      COUNT(*) FILTER (WHERE status = 'expiring_soon') AS expiring
    FROM fleet_documents
    WHERE fleet_unit_id = $1 AND company_id = $2 AND is_active = true
  `, [unit.id, companyId]);

  const d = docs[0] ?? { total: "0", expired: "0", expiring: "0" };
  const totalDocs = parseInt(d.total) || 0;
  const expiredDocs = parseInt(d.expired) || 0;
  const expiringDocs = parseInt(d.expiring) || 0;

  let docScore = 100;
  if (totalDocs === 0) { docScore = 50; factors.push("Tidak ada dokumen terdaftar"); }
  else {
    docScore = Math.max(0, 100 - (expiredDocs * 30) - (expiringDocs * 10));
    if (expiredDocs > 0) factors.push(`${expiredDocs} dokumen kadaluarsa`);
    if (expiringDocs > 0) factors.push(`${expiringDocs} dokumen hampir expired`);
  }

  // 2. Maintenance score (25%)
  const maint = await supabaseQuery<MaintRow>(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'pending' AND scheduled_date < NOW()) AS overdue,
      EXTRACT(DAY FROM NOW() - MAX(completed_date)) AS last_days
    FROM fleet_maintenance_records
    WHERE fleet_unit_id = $1 AND company_id = $2
  `, [unit.id, companyId]);

  const m = maint[0] ?? { overdue: "0", last_days: "0" };
  const overdue = parseInt(m.overdue) || 0;
  const lastDays = parseFloat(m.last_days) || 0;

  let maintenanceScore = 100;
  if (overdue > 0) { maintenanceScore -= overdue * 25; factors.push(`${overdue} servis tertunggak`); }
  if (lastDays > 180) { maintenanceScore -= 20; factors.push("Servis terakhir >6 bulan lalu"); }
  maintenanceScore = Math.max(0, maintenanceScore);

  // 3. Fuel efficiency score (15%)
  const fuel = await supabaseQuery<FuelRow>(`
    SELECT
      AVG(km_per_liter) AS avg_efficiency,
      (SELECT benchmark_km_per_liter FROM fleet_fuel_benchmarks
       WHERE vehicle_type = (SELECT vehicle_type FROM fleet_units WHERE id = $1) AND company_id = $2
       LIMIT 1) AS benchmark,
      COUNT(*) FILTER (WHERE is_anomaly = true AND logged_at > NOW() - INTERVAL '30 days') AS anomalies
    FROM fleet_fuel_logs
    WHERE fleet_unit_id = $1 AND company_id = $2 AND logged_at > NOW() - INTERVAL '90 days'
  `, [unit.id, companyId]);

  const f = fuel[0] ?? { avg_efficiency: null, benchmark: null, anomalies: "0" };
  let fuelScore = 80;
  if (f.avg_efficiency && f.benchmark) {
    const ratio = f.avg_efficiency / f.benchmark;
    fuelScore = Math.min(100, ratio * 100);
    if (ratio < 0.7) factors.push("Efisiensi BBM sangat rendah");
  }
  const anomalyCount = parseInt(String(f.anomalies)) || 0;
  fuelScore = Math.max(0, fuelScore - anomalyCount * 10);
  if (anomalyCount > 0) factors.push(`${anomalyCount} anomali BBM (30 hari)`);

  // 4. Driver score (15%)
  const driverPerf = await supabaseQuery<DriverPerfRow>(`
    SELECT AVG(p.overall_score) AS avg_score
    FROM fleet_driver_performance p
    JOIN fleet_drivers d ON d.id = p.driver_id
    WHERE d.assigned_vehicle_id = $1 AND d.company_id = $2
      AND p.period_month >= TO_CHAR(NOW() - INTERVAL '3 months', 'YYYY-MM')
  `, [unit.id, companyId]);

  const dp = driverPerf[0];
  let driverScore = dp?.avg_score != null ? Math.min(100, Math.max(0, Number(dp.avg_score))) : 70;
  if (driverScore < 60) factors.push("Performa pengemudi di bawah standar");

  // 5. Age/condition score (10%)
  const currentYear = new Date().getFullYear();
  const vehicleAge = unit.year ? currentYear - unit.year : 5;
  let ageScore = Math.max(0, 100 - vehicleAge * 8);
  if (vehicleAge > 10) factors.push(`Kendaraan tua (${vehicleAge} tahun)`);

  // 6. Utilization score (10%)
  const util = await supabaseQuery<UtilRow>(`
    SELECT AVG(utilization_pct) AS util_pct
    FROM fleet_utilization_logs
    WHERE fleet_unit_id = $1 AND company_id = $2
      AND log_date >= NOW() - INTERVAL '30 days'
  `, [unit.id, companyId]);

  const u = util[0];
  const utilPct = u?.util_pct != null ? Number(u.util_pct) : 50;
  let utilizationScore = 100;
  if (utilPct > 95) { utilizationScore = 40; factors.push("Over-utilized (>95%)"); }
  else if (utilPct > 85) { utilizationScore = 70; factors.push("Utilisasi tinggi (>85%)"); }
  else if (utilPct < 20) { utilizationScore = 60; factors.push("Utilisasi sangat rendah (<20%)"); }

  const components: RiskComponents = {
    docScore, maintenanceScore, fuelScore, driverScore, ageScore, utilizationScore,
  };
  const overall = Math.round(computeOverall(components));
  const level = riskLevel(overall);

  return { components, overall, level, factors };
}

// ── GET /api/fleet/risk-scores ────────────────────────────────────────────────

router.get("/fleet/risk-scores", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const rows = await supabaseQuery(`
      SELECT * FROM fleet_risk_scores WHERE company_id = $1 ORDER BY overall_score ASC
    `, [companyId]);
    return res.json({ data: rows, total: rows.length });
  } catch (err) {
    logger.error({ err }, "GET /fleet/risk-scores failed");
    return res.status(500).json({ error: "Gagal mengambil risk scores" });
  }
});

// ── GET /api/fleet/risk-scores/refresh ───────────────────────────────────────
// Must be before /:unitId

router.post("/fleet/risk-scores/refresh", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const t0 = Date.now();

    const units = await supabaseQuery<FleetUnit>(`
      SELECT id, unit_number, plate_number, year, status, company_id
      FROM fleet_units WHERE company_id = $1 AND is_active = true
    `, [companyId]);

    const results = [];

    for (const unit of units) {
      try {
        const { components, overall, level, factors } = await computeRiskForUnit(unit, companyId);

        await supabaseQuery(`
          INSERT INTO fleet_risk_scores
            (company_id, fleet_unit_id, unit_number, plate_number,
             doc_score, maintenance_score, fuel_score, driver_score, age_score, utilization_score,
             overall_score, risk_level, risk_factors, refreshed_at, updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),NOW())
          ON CONFLICT (fleet_unit_id)
          DO UPDATE SET
            doc_score = EXCLUDED.doc_score,
            maintenance_score = EXCLUDED.maintenance_score,
            fuel_score = EXCLUDED.fuel_score,
            driver_score = EXCLUDED.driver_score,
            age_score = EXCLUDED.age_score,
            utilization_score = EXCLUDED.utilization_score,
            overall_score = EXCLUDED.overall_score,
            risk_level = EXCLUDED.risk_level,
            risk_factors = EXCLUDED.risk_factors,
            refreshed_at = NOW(),
            updated_at = NOW()
        `, [
          companyId, unit.id, unit.unit_number, unit.plate_number,
          components.docScore, components.maintenanceScore, components.fuelScore,
          components.driverScore, components.ageScore, components.utilizationScore,
          overall, level, JSON.stringify(factors),
        ]);

        // Create AI task if HIGH or CRITICAL
        if (level === "HIGH" || level === "CRITICAL") {
          await supabaseQuery(`
            INSERT INTO ai_tasks (company_id, task_number, title, description, status, priority, source, category, created_at, updated_at)
            VALUES ($1,$2,$3,$4,'new_inquiry',$5,'system','fleet_risk',NOW(),NOW())
          `, [
            companyId,
            `FLEET-RISK-${unit.unit_number}-${Date.now()}`,
            `[${level}] Fleet Risk Alert — ${unit.unit_number} (${unit.plate_number})`,
            `Risk score: ${overall}/100. Faktor: ${factors.join(", ")}. Perlu tindakan segera.`,
            level === "CRITICAL" ? "urgent" : "high",
          ]).catch(e => logger.warn({ e }, "AI task fleet risk gagal"));
        }

        results.push({ unitId: unit.id, unitNumber: unit.unit_number, overall, level });
      } catch (e) {
        logger.warn({ e, unitId: unit.id }, "Risk compute failed for unit");
        results.push({ unitId: unit.id, unitNumber: unit.unit_number, error: String(e) });
      }
    }

    // Write scheduler run
    await supabaseQuery(`
      INSERT INTO fleet_scheduler_runs (company_id, job_name, trigger, status, records_processed, duration_ms, ran_at)
      VALUES ($1, 'fleet-risk-score-refresh', 'manual', 'success', $2, $3, NOW())
    `, [companyId, results.length, Date.now() - t0]);

    return res.json({ success: true, processed: results.length, durationMs: Date.now() - t0, results });
  } catch (err) {
    logger.error({ err }, "POST /fleet/risk-scores/refresh failed");
    return res.status(500).json({ error: "Gagal refresh risk scores" });
  }
});

// ── GET /api/fleet/risk-scores/:unitId ────────────────────────────────────────

router.get("/fleet/risk-scores/:unitId", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const unitId = parseInt(req.params.unitId as string);
    if (isNaN(unitId)) return res.status(400).json({ error: "unitId tidak valid" });

    const rows = await supabaseQuery(`
      SELECT * FROM fleet_risk_scores WHERE company_id = $1 AND fleet_unit_id = $2 LIMIT 1
    `, [companyId, unitId]);

    if (!rows.length) return res.status(404).json({ error: "Risk score belum dihitung untuk unit ini" });
    return res.json({ data: rows[0] });
  } catch (err) {
    logger.error({ err }, "GET /fleet/risk-scores/:unitId failed");
    return res.status(500).json({ error: "Gagal mengambil risk score" });
  }
});

export default router;
