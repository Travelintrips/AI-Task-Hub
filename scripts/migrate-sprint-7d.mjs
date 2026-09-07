/**
 * Sprint 7D Migration — Fleet Risk, Cost, Dashboard, WhatsApp Reporting
 * Run: node scripts/migrate-sprint-7d.mjs
 * Connects to SUPABASE_DATABASE_URL (session mode port 5432)
 */

import pg from "pg";

const raw = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
if (!raw) {
  console.error("ERROR: SUPABASE_DATABASE_URL tidak ditemukan");
  process.exit(1);
}

// Use session mode (5432) for DDL
const url = raw.replace(/:6543\b/, ":5432");
const pool = new pg.Pool({ connectionString: url, max: 2, ssl: { rejectUnauthorized: false } });

async function run(sql, label) {
  try {
    await pool.query(sql);
    console.log(`  ✓ ${label}`);
  } catch (e) {
    if (e.message.includes("already exists")) {
      console.log(`  ℹ ${label} (sudah ada)`);
    } else {
      console.error(`  ✗ ${label}: ${e.message}`);
      throw e;
    }
  }
}

async function main() {
  console.log("Sprint 7D Migration — mulai...\n");

  // ── 1. fleet_risk_scores ───────────────────────────────────────────────────
  await run(`
    CREATE TABLE IF NOT EXISTS fleet_risk_scores (
      id              SERIAL PRIMARY KEY,
      company_id      TEXT NOT NULL DEFAULT 'default',
      fleet_unit_id   INTEGER NOT NULL,
      unit_number     TEXT,
      plate_number    TEXT,

      doc_score       REAL NOT NULL DEFAULT 0,
      maintenance_score REAL NOT NULL DEFAULT 0,
      fuel_score      REAL NOT NULL DEFAULT 0,
      driver_score    REAL NOT NULL DEFAULT 0,
      age_score       REAL NOT NULL DEFAULT 0,
      utilization_score REAL NOT NULL DEFAULT 0,
      overall_score   REAL NOT NULL DEFAULT 0,

      risk_level      TEXT NOT NULL DEFAULT 'MEDIUM',
      risk_factors    JSONB,
      ai_task_id      INTEGER,
      refreshed_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `, "fleet_risk_scores table");

  await run(`CREATE INDEX IF NOT EXISTS frs_company_idx ON fleet_risk_scores(company_id)`, "idx fleet_risk_scores.company_id");
  await run(`CREATE INDEX IF NOT EXISTS frs_unit_idx ON fleet_risk_scores(fleet_unit_id)`, "idx fleet_risk_scores.fleet_unit_id");
  await run(`CREATE INDEX IF NOT EXISTS frs_risk_level_idx ON fleet_risk_scores(risk_level)`, "idx fleet_risk_scores.risk_level");
  await run(`CREATE UNIQUE INDEX IF NOT EXISTS frs_unit_uniq ON fleet_risk_scores(fleet_unit_id)`, "unique fleet_risk_scores.fleet_unit_id");

  // ── 2. fleet_cost_per_km ──────────────────────────────────────────────────
  await run(`
    CREATE TABLE IF NOT EXISTS fleet_cost_per_km (
      id              SERIAL PRIMARY KEY,
      company_id      TEXT NOT NULL DEFAULT 'default',
      fleet_unit_id   INTEGER NOT NULL,
      unit_number     TEXT,
      plate_number    TEXT,
      period_month    TEXT NOT NULL,

      total_km        REAL NOT NULL DEFAULT 0,
      fuel_cost       REAL NOT NULL DEFAULT 0,
      maintenance_cost REAL NOT NULL DEFAULT 0,
      tire_cost       REAL NOT NULL DEFAULT 0,
      insurance_cost  REAL NOT NULL DEFAULT 0,
      tax_cost        REAL NOT NULL DEFAULT 0,
      depreciation_cost REAL NOT NULL DEFAULT 0,
      total_cost      REAL NOT NULL DEFAULT 0,
      cost_per_km     REAL NOT NULL DEFAULT 0,

      revenue_generated REAL NOT NULL DEFAULT 0,
      gross_profit    REAL NOT NULL DEFAULT 0,
      profit_margin_pct REAL NOT NULL DEFAULT 0,

      computed_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `, "fleet_cost_per_km table");

  await run(`CREATE INDEX IF NOT EXISTS fcpk_company_idx ON fleet_cost_per_km(company_id)`, "idx fleet_cost_per_km.company_id");
  await run(`CREATE INDEX IF NOT EXISTS fcpk_unit_idx ON fleet_cost_per_km(fleet_unit_id)`, "idx fleet_cost_per_km.fleet_unit_id");
  await run(`CREATE INDEX IF NOT EXISTS fcpk_period_idx ON fleet_cost_per_km(period_month)`, "idx fleet_cost_per_km.period_month");
  await run(`CREATE UNIQUE INDEX IF NOT EXISTS fcpk_unit_period_uniq ON fleet_cost_per_km(company_id, fleet_unit_id, period_month)`, "unique fleet_cost_per_km(company_id, unit, period)");

  // ── 3. fleet_route_profitability ──────────────────────────────────────────
  await run(`
    CREATE TABLE IF NOT EXISTS fleet_route_profitability (
      id              SERIAL PRIMARY KEY,
      company_id      TEXT NOT NULL DEFAULT 'default',
      route           TEXT NOT NULL,
      period_month    TEXT NOT NULL,

      total_trips     INTEGER NOT NULL DEFAULT 0,
      total_km        REAL NOT NULL DEFAULT 0,
      vehicle_cost    REAL NOT NULL DEFAULT 0,
      revenue         REAL NOT NULL DEFAULT 0,
      margin          REAL NOT NULL DEFAULT 0,
      margin_pct      REAL NOT NULL DEFAULT 0,

      top_unit_id     INTEGER,
      top_unit_number TEXT,
      computed_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `, "fleet_route_profitability table");

  await run(`CREATE INDEX IF NOT EXISTS frp_company_idx ON fleet_route_profitability(company_id)`, "idx fleet_route_profitability.company_id");
  await run(`CREATE INDEX IF NOT EXISTS frp_route_idx ON fleet_route_profitability(route)`, "idx fleet_route_profitability.route");
  await run(`CREATE UNIQUE INDEX IF NOT EXISTS frp_route_period_uniq ON fleet_route_profitability(company_id, route, period_month)`, "unique fleet_route_profitability(company, route, period)");

  // ── 4. driver_memory_snapshots ────────────────────────────────────────────
  await run(`
    CREATE TABLE IF NOT EXISTS driver_memory_snapshots (
      id              SERIAL PRIMARY KEY,
      company_id      TEXT NOT NULL DEFAULT 'default',
      driver_id       INTEGER NOT NULL,
      driver_name     TEXT,

      strengths       JSONB,
      weaknesses      JSONB,
      preferred_routes JSONB,
      fuel_efficiency_trend TEXT,
      safety_trend    TEXT,
      performance_summary TEXT,
      ai_context_block TEXT,

      avg_score       REAL,
      total_trips     INTEGER DEFAULT 0,
      total_incidents INTEGER DEFAULT 0,
      freshness_score REAL NOT NULL DEFAULT 100,
      valid_until     TIMESTAMP WITH TIME ZONE,

      refreshed_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `, "driver_memory_snapshots table");

  await run(`CREATE INDEX IF NOT EXISTS dms_company_idx ON driver_memory_snapshots(company_id)`, "idx driver_memory_snapshots.company_id");
  await run(`CREATE INDEX IF NOT EXISTS dms_driver_idx ON driver_memory_snapshots(driver_id)`, "idx driver_memory_snapshots.driver_id");
  await run(`CREATE UNIQUE INDEX IF NOT EXISTS dms_driver_uniq ON driver_memory_snapshots(driver_id)`, "unique driver_memory_snapshots.driver_id");

  // ── 5. fleet_report_logs ─────────────────────────────────────────────────
  await run(`
    CREATE TABLE IF NOT EXISTS fleet_report_logs (
      id              SERIAL PRIMARY KEY,
      company_id      TEXT NOT NULL DEFAULT 'default',
      report_type     TEXT NOT NULL,
      recipient_name  TEXT,
      recipient_phone TEXT,
      message_preview TEXT,
      status          TEXT NOT NULL DEFAULT 'sent',
      error_reason    TEXT,
      fonnte_message_id TEXT,
      triggered_by    TEXT,
      created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `, "fleet_report_logs table");

  await run(`CREATE INDEX IF NOT EXISTS frl_company_idx ON fleet_report_logs(company_id)`, "idx fleet_report_logs.company_id");
  await run(`CREATE INDEX IF NOT EXISTS frl_type_idx ON fleet_report_logs(report_type)`, "idx fleet_report_logs.report_type");
  await run(`CREATE INDEX IF NOT EXISTS frl_status_idx ON fleet_report_logs(status)`, "idx fleet_report_logs.status");

  // ── 6. fleet_scheduler_runs ───────────────────────────────────────────────
  await run(`
    CREATE TABLE IF NOT EXISTS fleet_scheduler_runs (
      id              SERIAL PRIMARY KEY,
      company_id      TEXT NOT NULL DEFAULT 'default',
      job_name        TEXT NOT NULL,
      trigger         TEXT NOT NULL DEFAULT 'scheduled',
      status          TEXT NOT NULL DEFAULT 'success',
      records_processed INTEGER DEFAULT 0,
      alerts_generated  INTEGER DEFAULT 0,
      duration_ms     INTEGER,
      error_message   TEXT,
      ran_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `, "fleet_scheduler_runs table");

  await run(`CREATE INDEX IF NOT EXISTS fsr_company_idx ON fleet_scheduler_runs(company_id)`, "idx fleet_scheduler_runs.company_id");
  await run(`CREATE INDEX IF NOT EXISTS fsr_job_idx ON fleet_scheduler_runs(job_name)`, "idx fleet_scheduler_runs.job_name");
  await run(`CREATE INDEX IF NOT EXISTS fsr_ran_at_idx ON fleet_scheduler_runs(ran_at DESC)`, "idx fleet_scheduler_runs.ran_at");

  await pool.end();
  console.log("\n✅ Sprint 7D migration selesai — 6 tabel berhasil dibuat.");
}

main().catch(e => {
  console.error("Migration gagal:", e.message);
  process.exit(1);
});
