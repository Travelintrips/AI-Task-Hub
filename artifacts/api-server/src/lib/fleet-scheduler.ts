/**
 * Sprint 7D — Fleet Background Scheduler
 *
 * Jobs:
 *   1. fleet-doc-expiry-check       — daily 07:00
 *   2. fleet-maintenance-due-check  — daily 07:30
 *   3. fleet-risk-score-refresh     — daily 08:00
 *   4. fleet-cost-per-km-compute    — monthly (1st of month 06:00)
 *   5. fleet-driver-performance-compute — weekly Monday 06:00
 *   6. fleet-fuel-anomaly-scan      — every 6 hours
 *
 * Each job writes to fleet_scheduler_runs.
 */

import { logger } from "./logger";
import { supabaseQuery } from "./supabase-db";
import { sendFonnte } from "./fonnte";

const DEFAULT_COMPANY_ID = process.env["COMPANY_ID"] ?? "default";

// ── Time helpers ──────────────────────────────────────────────────────────────

function msUntilNextTime(hour: number, minute = 0): number {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target.getTime() - now.getTime();
}

function msUntilNextMonday(hour = 6, minute = 0): number {
  const now = new Date();
  const target = new Date(now);
  const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon
  const daysUntilMonday = dayOfWeek === 1 ? 7 : (8 - dayOfWeek) % 7;
  target.setDate(now.getDate() + daysUntilMonday);
  target.setHours(hour, minute, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 7);
  return target.getTime() - now.getTime();
}

function msUntilNextMonthStart(hour = 6, minute = 0): number {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() + 1, 1, hour, minute, 0, 0);
  return Math.max(target.getTime() - now.getTime(), 60000);
}

async function logRun(
  jobName: string, status: "success" | "failed",
  processed = 0, alerts = 0, durationMs = 0, errorMsg?: string,
): Promise<void> {
  await supabaseQuery(`
    INSERT INTO fleet_scheduler_runs
      (company_id, job_name, trigger, status, records_processed, alerts_generated, duration_ms, error_message, ran_at)
    VALUES ($1,$2,'scheduled',$3,$4,$5,$6,$7,NOW())
  `, [DEFAULT_COMPANY_ID, jobName, status, processed, alerts, durationMs, errorMsg ?? null]).catch(() => {});
}

// ── Job 1: Document Expiry Check (daily 07:00) ────────────────────────────────

async function runDocExpiryCheck(): Promise<void> {
  const t0 = Date.now();
  logger.info("fleet-doc-expiry-check: starting");
  try {
    // Update status based on expiry date
    await supabaseQuery(`
      UPDATE fleet_documents
      SET status = CASE
        WHEN expiry_date < NOW() THEN 'expired'
        WHEN expiry_date < NOW() + INTERVAL '30 days' THEN 'expiring_soon'
        ELSE 'active'
      END,
      updated_at = NOW()
      WHERE is_active = true
    `, []);

    const expiring = await supabaseQuery<{ count: string }>(`
      SELECT COUNT(*) AS count FROM fleet_documents
      WHERE status IN ('expired', 'expiring_soon') AND is_active = true
    `, []);
    const count = parseInt(expiring[0]?.count ?? "0");

    // Send alert if critical docs expired
    if (count > 0) {
      const teamManagers = await supabaseQuery<{ phone: string; name: string }>(`
        SELECT phone, name FROM team_members
        WHERE company_id = $1 AND is_active = true AND phone IS NOT NULL
          AND role IN ('manager', 'supervisor', 'fleet_manager', 'company_admin')
        LIMIT 5
      `, [DEFAULT_COMPANY_ID]).catch(() => []);

      for (const m of teamManagers) {
        await sendFonnte(m.phone, `⚠️ *Fleet Alert* — ${count} dokumen kendaraan expired/hampir expired. Segera cek di Fleet Management System.`).catch(() => {});
      }
    }

    await logRun("fleet-doc-expiry-check", "success", count, count > 0 ? 1 : 0, Date.now() - t0);
    logger.info({ count, durationMs: Date.now() - t0 }, "fleet-doc-expiry-check: done");
  } catch (err) {
    logger.error({ err }, "fleet-doc-expiry-check: failed");
    await logRun("fleet-doc-expiry-check", "failed", 0, 0, Date.now() - t0, String(err));
  }
}

// ── Job 2: Maintenance Due Check (daily 07:30) ────────────────────────────────

async function runMaintenanceDueCheck(): Promise<void> {
  const t0 = Date.now();
  logger.info("fleet-maintenance-due-check: starting");
  try {
    const overdue = await supabaseQuery<{ count: string }>(`
      SELECT COUNT(*) AS count FROM fleet_maintenance_records
      WHERE status = 'pending' AND scheduled_date < NOW()
    `, []);
    const count = parseInt(overdue[0]?.count ?? "0");

    const upcomingIn3Days = await supabaseQuery<{ count: string }>(`
      SELECT COUNT(*) AS count FROM fleet_maintenance_records
      WHERE status = 'pending' AND scheduled_date BETWEEN NOW() AND NOW() + INTERVAL '3 days'
    `, []);
    const upcoming = parseInt(upcomingIn3Days[0]?.count ?? "0");

    if (count > 0 || upcoming > 0) {
      const teamManagers = await supabaseQuery<{ phone: string; name: string }>(`
        SELECT phone, name FROM team_members
        WHERE company_id = $1 AND is_active = true AND phone IS NOT NULL
          AND role IN ('manager', 'supervisor', 'fleet_manager', 'company_admin')
        LIMIT 5
      `, [DEFAULT_COMPANY_ID]).catch(() => []);

      const msg = `🔧 *Fleet Maintenance Alert*\n• Servis tertunggak: ${count}\n• Servis 3 hari ke depan: ${upcoming}\n\nCek di Fleet Management System.`;
      for (const m of teamManagers) {
        await sendFonnte(m.phone, msg).catch(() => {});
      }
    }

    await logRun("fleet-maintenance-due-check", "success", count + upcoming, count > 0 ? 1 : 0, Date.now() - t0);
    logger.info({ overdue: count, upcoming, durationMs: Date.now() - t0 }, "fleet-maintenance-due-check: done");
  } catch (err) {
    logger.error({ err }, "fleet-maintenance-due-check: failed");
    await logRun("fleet-maintenance-due-check", "failed", 0, 0, Date.now() - t0, String(err));
  }
}

// ── Job 3: Risk Score Refresh (daily 08:00) ───────────────────────────────────

async function runRiskScoreRefresh(): Promise<void> {
  const t0 = Date.now();
  logger.info("fleet-risk-score-refresh: starting");
  try {
    const units = await supabaseQuery<{ id: number; unit_number: string; plate_number: string; year: number | null }>(`
      SELECT id, unit_number, plate_number, year
      FROM fleet_units WHERE company_id = $1 AND is_active = true
    `, [DEFAULT_COMPANY_ID]);

    let processed = 0;
    let alerts = 0;

    for (const unit of units) {
      // Simple score refresh — document compliance primarily
      const docs = await supabaseQuery<{ expired: string; expiring: string }>(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'expired') AS expired,
          COUNT(*) FILTER (WHERE status = 'expiring_soon') AS expiring
        FROM fleet_documents WHERE fleet_unit_id = $1 AND is_active = true
      `, [unit.id]).catch(() => [{ expired: "0", expiring: "0" }]);

      const expiredCount = parseInt(docs[0]?.expired ?? "0");
      const expiringCount = parseInt(docs[0]?.expiring ?? "0");
      const docScore = Math.max(0, 100 - expiredCount * 30 - expiringCount * 10);

      const overallEstimate = Math.round(docScore * 0.25 + 70 * 0.75);
      const level = overallEstimate >= 80 ? "LOW" : overallEstimate >= 60 ? "MEDIUM" : overallEstimate >= 40 ? "HIGH" : "CRITICAL";

      await supabaseQuery(`
        INSERT INTO fleet_risk_scores
          (company_id, fleet_unit_id, unit_number, plate_number, doc_score,
           maintenance_score, fuel_score, driver_score, age_score, utilization_score,
           overall_score, risk_level, risk_factors, refreshed_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,70,70,70,70,70,$6,$7,$8,NOW(),NOW())
        ON CONFLICT (fleet_unit_id)
        DO UPDATE SET doc_score=$5, overall_score=$6, risk_level=$7, risk_factors=$8, refreshed_at=NOW(), updated_at=NOW()
      `, [
        DEFAULT_COMPANY_ID, unit.id, unit.unit_number, unit.plate_number, docScore,
        overallEstimate, level, JSON.stringify(expiredCount > 0 ? [`${expiredCount} dokumen expired`] : []),
      ]).catch(() => {});

      if (level === "HIGH" || level === "CRITICAL") alerts++;
      processed++;
    }

    await logRun("fleet-risk-score-refresh", "success", processed, alerts, Date.now() - t0);
    logger.info({ processed, alerts, durationMs: Date.now() - t0 }, "fleet-risk-score-refresh: done");
  } catch (err) {
    logger.error({ err }, "fleet-risk-score-refresh: failed");
    await logRun("fleet-risk-score-refresh", "failed", 0, 0, Date.now() - t0, String(err));
  }
}

// ── Job 4: Cost per KM Compute (monthly, 1st of month 06:00) ─────────────────

async function runCostPerKmCompute(): Promise<void> {
  const t0 = Date.now();
  const period = new Date().toISOString().slice(0, 7);
  logger.info({ period }, "fleet-cost-per-km-compute: starting");
  try {
    const units = await supabaseQuery<{ id: number; unit_number: string; plate_number: string }>(`
      SELECT id, unit_number, plate_number FROM fleet_units
      WHERE company_id = $1 AND is_active = true
    `, [DEFAULT_COMPANY_ID]);

    for (const unit of units) {
      const fuelData = await supabaseQuery<{ fuel_cost: number }>(`
        SELECT COALESCE(SUM(total_cost), 0) AS fuel_cost FROM fleet_fuel_logs
        WHERE fleet_unit_id = $1 AND logged_at >= DATE_TRUNC('month', NOW())
      `, [unit.id]).catch(() => [{ fuel_cost: 0 }]);

      const kmData = await supabaseQuery<{ total_km: number }>(`
        SELECT COALESCE(SUM(actual_km), 0) AS total_km FROM fleet_utilization_logs
        WHERE fleet_unit_id = $1 AND actual_departure >= DATE_TRUNC('month', NOW())
      `, [unit.id]).catch(() => [{ total_km: 0 }]);

      const totalKm = Number(kmData[0]?.total_km ?? 0);
      const totalCost = Number(fuelData[0]?.fuel_cost ?? 0);
      const costPerKm = totalKm > 0 ? totalCost / totalKm : 0;

      await supabaseQuery(`
        INSERT INTO fleet_cost_per_km
          (company_id, fleet_unit_id, unit_number, plate_number, period_month,
           total_km, fuel_cost, total_cost, cost_per_km, computed_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())
        ON CONFLICT (company_id, fleet_unit_id, period_month)
        DO UPDATE SET total_km=$6, fuel_cost=$7, total_cost=$8, cost_per_km=$9, computed_at=NOW(), updated_at=NOW()
      `, [DEFAULT_COMPANY_ID, unit.id, unit.unit_number, unit.plate_number, period, totalKm, totalCost, totalCost, costPerKm])
        .catch(() => {});
    }

    await logRun("fleet-cost-per-km-compute", "success", units.length, 0, Date.now() - t0);
    logger.info({ units: units.length, period, durationMs: Date.now() - t0 }, "fleet-cost-per-km-compute: done");
  } catch (err) {
    logger.error({ err }, "fleet-cost-per-km-compute: failed");
    await logRun("fleet-cost-per-km-compute", "failed", 0, 0, Date.now() - t0, String(err));
  }
}

// ── Job 5: Driver Performance Compute (weekly Monday 06:00) ──────────────────

async function runDriverPerformanceCompute(): Promise<void> {
  const t0 = Date.now();
  const period = new Date().toISOString().slice(0, 7);
  logger.info({ period }, "fleet-driver-performance-compute: starting");
  try {
    const drivers = await supabaseQuery<{ id: number; full_name: string }>(`
      SELECT id, full_name FROM fleet_drivers
      WHERE company_id = $1 AND status = 'active'
    `, [DEFAULT_COMPANY_ID]);

    let processed = 0;
    for (const driver of drivers) {
      // Check if snapshot exists and is recent enough (< 7 days)
      const existing = await supabaseQuery<{ refreshed_at: string }>(`
        SELECT refreshed_at FROM driver_memory_snapshots
        WHERE driver_id = $1 ORDER BY refreshed_at DESC LIMIT 1
      `, [driver.id]).catch(() => []);

      const lastRefresh = existing[0]?.refreshed_at ? new Date(existing[0].refreshed_at) : null;
      if (lastRefresh && (Date.now() - lastRefresh.getTime()) < 7 * 24 * 3600 * 1000) continue;

      // Get performance data
      const perf = await supabaseQuery<{ avg_score: number | null; total_trips: number; period_month: string }>(`
        SELECT AVG(overall_score) AS avg_score, SUM(total_trips) AS total_trips, MAX(period_month) AS period_month
        FROM fleet_driver_performance WHERE driver_id = $1 AND period_month >= $2
      `, [driver.id, period]).catch(() => []);

      const incidents = await supabaseQuery<{ count: string }>(`
        SELECT COUNT(*) AS count FROM fleet_driver_incidents
        WHERE driver_id = $1 AND incident_date >= NOW() - INTERVAL '6 months'
      `, [driver.id]).catch(() => [{ count: "0" }]);

      const p = perf[0];
      const avgScore = p?.avg_score != null ? Number(p.avg_score) : null;
      const totalTrips = Number(p?.total_trips ?? 0);
      const totalIncidents = parseInt(incidents[0]?.count ?? "0");

      const strengths: string[] = [];
      const weaknesses: string[] = [];

      if (avgScore !== null) {
        if (avgScore >= 80) strengths.push("Performa tinggi konsisten");
        if (avgScore < 60) weaknesses.push("Performa di bawah standar");
      }
      if (totalIncidents > 2) weaknesses.push(`${totalIncidents} insiden dalam 6 bulan`);
      if (totalIncidents === 0) strengths.push("Catatan keamanan bersih");

      const performanceSummary = avgScore !== null
        ? `Skor rata-rata: ${Math.round(avgScore)}/100. Total trips: ${totalTrips}. Insiden 6 bulan: ${totalIncidents}.`
        : "Data performa belum tersedia.";

      const aiContextBlock = `Driver: ${driver.full_name}. ${performanceSummary} Kekuatan: ${strengths.join(", ") || "N/A"}. Area perbaikan: ${weaknesses.join(", ") || "N/A"}.`;

      await supabaseQuery(`
        INSERT INTO driver_memory_snapshots
          (company_id, driver_id, driver_name, strengths, weaknesses, performance_summary,
           ai_context_block, avg_score, total_trips, total_incidents,
           freshness_score, valid_until, refreshed_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,100, NOW() + INTERVAL '7 days', NOW(), NOW())
        ON CONFLICT (driver_id) DO UPDATE SET
          driver_name=$3, strengths=$4, weaknesses=$5, performance_summary=$6,
          ai_context_block=$7, avg_score=$8, total_trips=$9, total_incidents=$10,
          freshness_score=100, valid_until=NOW() + INTERVAL '7 days', refreshed_at=NOW(), updated_at=NOW()
      `, [
        DEFAULT_COMPANY_ID, driver.id, driver.full_name,
        JSON.stringify(strengths), JSON.stringify(weaknesses),
        performanceSummary, aiContextBlock,
        avgScore, totalTrips, totalIncidents,
      ]).catch(() => {});

      processed++;
    }

    await logRun("fleet-driver-performance-compute", "success", processed, 0, Date.now() - t0);
    logger.info({ processed, durationMs: Date.now() - t0 }, "fleet-driver-performance-compute: done");
  } catch (err) {
    logger.error({ err }, "fleet-driver-performance-compute: failed");
    await logRun("fleet-driver-performance-compute", "failed", 0, 0, Date.now() - t0, String(err));
  }
}

// ── Job 6: Fuel Anomaly Scan (every 6 hours) ─────────────────────────────────

async function runFuelAnomalyScan(): Promise<void> {
  const t0 = Date.now();
  logger.info("fleet-fuel-anomaly-scan: starting");
  try {
    // Find logs with no anomaly flag checked in last 6 hours
    const newLogs = await supabaseQuery<{ id: number; fleet_unit_id: number; km_per_liter: number; liters_filled: number }>(`
      SELECT id, fleet_unit_id, km_per_liter, liters_filled
      FROM fleet_fuel_logs
      WHERE company_id = $1 AND logged_at >= NOW() - INTERVAL '6 hours'
        AND is_anomaly IS NULL
    `, [DEFAULT_COMPANY_ID]);

    let anomalies = 0;

    for (const log of newLogs) {
      const bench = await supabaseQuery<{ benchmark_km_per_liter: number }>(`
        SELECT fb.benchmark_km_per_liter
        FROM fleet_fuel_benchmarks fb
        JOIN fleet_units fu ON fu.vehicle_type = fb.vehicle_type
        WHERE fu.id = $1 AND fu.company_id = $2 LIMIT 1
      `, [log.fleet_unit_id, DEFAULT_COMPANY_ID]).catch(() => []);

      const benchmark = bench[0]?.benchmark_km_per_liter;
      let isAnomaly = false;

      if (benchmark && log.km_per_liter < benchmark * 0.6) {
        isAnomaly = true; // More than 40% below benchmark
      }
      if (log.liters_filled > 200) {
        isAnomaly = true; // Unusually large fill
      }

      await supabaseQuery(`
        UPDATE fleet_fuel_logs SET is_anomaly = $1, updated_at = NOW() WHERE id = $2
      `, [isAnomaly, log.id]).catch(() => {});

      if (isAnomaly) anomalies++;
    }

    await logRun("fleet-fuel-anomaly-scan", "success", newLogs.length, anomalies, Date.now() - t0);
    logger.info({ scanned: newLogs.length, anomalies, durationMs: Date.now() - t0 }, "fleet-fuel-anomaly-scan: done");
  } catch (err) {
    logger.error({ err }, "fleet-fuel-anomaly-scan: failed");
    await logRun("fleet-fuel-anomaly-scan", "failed", 0, 0, Date.now() - t0, String(err));
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function startFleetScheduler(): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  const intervals: ReturnType<typeof setInterval>[] = [];

  // Job 1: Doc Expiry Check — daily 07:00
  function scheduleDocExpiry(): void {
    const delay = msUntilNextTime(7, 0);
    logger.info({ nextRun: new Date(Date.now() + delay).toISOString() }, "fleet-doc-expiry-check scheduled");
    const t = setTimeout(() => {
      runDocExpiryCheck();
      scheduleDocExpiry();
    }, delay);
    timers.push(t);
  }

  // Job 2: Maintenance Due Check — daily 07:30
  function scheduleMaintCheck(): void {
    const delay = msUntilNextTime(7, 30);
    logger.info({ nextRun: new Date(Date.now() + delay).toISOString() }, "fleet-maintenance-due-check scheduled");
    const t = setTimeout(() => {
      runMaintenanceDueCheck();
      scheduleMaintCheck();
    }, delay);
    timers.push(t);
  }

  // Job 3: Risk Score Refresh — daily 08:00
  function scheduleRiskRefresh(): void {
    const delay = msUntilNextTime(8, 0);
    logger.info({ nextRun: new Date(Date.now() + delay).toISOString() }, "fleet-risk-score-refresh scheduled");
    const t = setTimeout(() => {
      runRiskScoreRefresh();
      scheduleRiskRefresh();
    }, delay);
    timers.push(t);
  }

  // Job 4: Cost per KM Compute — monthly
  function scheduleCostCompute(): void {
    const delay = msUntilNextMonthStart(6, 0);
    logger.info({ nextRun: new Date(Date.now() + delay).toISOString() }, "fleet-cost-per-km-compute scheduled");
    const t = setTimeout(() => {
      runCostPerKmCompute();
      scheduleCostCompute();
    }, delay);
    timers.push(t);
  }

  // Job 5: Driver Performance Compute — weekly Monday 06:00
  function scheduleDriverPerf(): void {
    const delay = msUntilNextMonday(6, 0);
    logger.info({ nextRun: new Date(Date.now() + delay).toISOString() }, "fleet-driver-performance-compute scheduled");
    const t = setTimeout(() => {
      runDriverPerformanceCompute();
      scheduleDriverPerf();
    }, delay);
    timers.push(t);
  }

  // Job 6: Fuel Anomaly Scan — every 6 hours
  const anomalyInterval = setInterval(() => {
    runFuelAnomalyScan();
  }, 6 * 60 * 60 * 1000);
  intervals.push(anomalyInterval);

  // Run initial scans immediately (non-blocking)
  setTimeout(() => runFuelAnomalyScan(), 5000);
  setTimeout(() => runDocExpiryCheck(), 10000);

  // Start all scheduled jobs
  scheduleDocExpiry();
  scheduleMaintCheck();
  scheduleRiskRefresh();
  scheduleCostCompute();
  scheduleDriverPerf();

  logger.info("Fleet scheduler started — 6 jobs registered");

  return () => {
    timers.forEach(t => clearTimeout(t));
    intervals.forEach(i => clearInterval(i));
    logger.info("Fleet scheduler stopped");
  };
}
