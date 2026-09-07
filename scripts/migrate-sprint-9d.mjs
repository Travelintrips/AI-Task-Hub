/**
 * Sprint 9D — Quality Gate & Certification schema migration
 * Creates: quality_gate_suites, quality_gate_runs, quality_gate_results
 * Run: node scripts/migrate-sprint-9d.mjs
 */
import pg from "pg";

const { Pool } = pg;

const connectionString =
  process.env.SUPABASE_DATABASE_URL ||
  process.env.DATABASE_URL;

if (!connectionString) {
  console.error("❌ SUPABASE_DATABASE_URL not set");
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  max: 1,
});

async function run(label, sql) {
  try {
    await pool.query(sql);
    console.log(`✅ ${label}`);
  } catch (e) {
    console.error(`❌ ${label}: ${e.message}`);
    throw e;
  }
}

try {
  await run("quality_gate_suites", `
    CREATE TABLE IF NOT EXISTS quality_gate_suites (
      id          SERIAL PRIMARY KEY,
      suite_name  TEXT NOT NULL UNIQUE,
      description TEXT,
      version     TEXT NOT NULL DEFAULT '1.0',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS quality_gate_suites_name_idx ON quality_gate_suites(suite_name);
  `);

  await run("quality_gate_runs", `
    CREATE TABLE IF NOT EXISTS quality_gate_runs (
      id               SERIAL PRIMARY KEY,
      run_name         TEXT NOT NULL,
      suite_name       TEXT NOT NULL DEFAULT 'sprint-9d-certification',
      triggered_by     TEXT NOT NULL DEFAULT 'system',
      status           TEXT NOT NULL DEFAULT 'running',
      total_scenarios  INTEGER NOT NULL DEFAULT 0,
      passed           INTEGER NOT NULL DEFAULT 0,
      failed           INTEGER NOT NULL DEFAULT 0,
      skipped          INTEGER NOT NULL DEFAULT 0,
      success_rate     REAL,
      duration_ms      INTEGER,
      critical_failures INTEGER NOT NULL DEFAULT 0,
      rbac_failures    INTEGER NOT NULL DEFAULT 0,
      certified        BOOLEAN NOT NULL DEFAULT FALSE,
      go_decision      TEXT,
      started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at     TIMESTAMPTZ,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS quality_gate_runs_status_idx   ON quality_gate_runs(status);
    CREATE INDEX IF NOT EXISTS quality_gate_runs_created_idx  ON quality_gate_runs(created_at DESC);
    CREATE INDEX IF NOT EXISTS quality_gate_runs_suite_idx    ON quality_gate_runs(suite_name);
  `);

  await run("quality_gate_results", `
    CREATE TABLE IF NOT EXISTS quality_gate_results (
      id             SERIAL PRIMARY KEY,
      run_id         INTEGER NOT NULL REFERENCES quality_gate_runs(id) ON DELETE CASCADE,
      suite_name     TEXT NOT NULL,
      scenario_name  TEXT NOT NULL,
      phase          TEXT NOT NULL DEFAULT 'business',
      service_type   TEXT NOT NULL DEFAULT 'general',
      status         TEXT NOT NULL DEFAULT 'skipped',
      duration_ms    INTEGER NOT NULL DEFAULT 0,
      error_message  TEXT,
      checks         JSONB,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS quality_gate_results_run_idx     ON quality_gate_results(run_id);
    CREATE INDEX IF NOT EXISTS quality_gate_results_status_idx  ON quality_gate_results(status);
    CREATE INDEX IF NOT EXISTS quality_gate_results_phase_idx   ON quality_gate_results(phase);
    CREATE INDEX IF NOT EXISTS quality_gate_results_service_idx ON quality_gate_results(service_type);
  `);

  await run("seed: sprint-9d-certification suite", `
    INSERT INTO quality_gate_suites (suite_name, description, version)
    VALUES (
      'sprint-9d-certification',
      'End-to-end certification suite covering 16 business scenarios, RBAC, conversation, mini form, document validation, and regression detection',
      '9.4'
    )
    ON CONFLICT (suite_name) DO UPDATE
      SET description = EXCLUDED.description,
          version     = EXCLUDED.version,
          updated_at  = NOW();
  `);

  console.log("✅ Sprint 9D migration complete");
} catch (e) {
  console.error("Migration failed:", e.message);
  process.exit(1);
} finally {
  await pool.end();
}
