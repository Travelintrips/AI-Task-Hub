/**
 * Sprint 8B — Executive Command Center schema migration
 * Runs against SUPABASE_DATABASE_URL (same DB as API server)
 * Usage: node scripts/migrate-sprint-8b.mjs
 */
import pg from "pg";

const { Pool } = pg;

const connectionString =
  process.env.SUPABASE_DATABASE_URL ||
  process.env.SUPABASE_DATABASE_URL_DEV;

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
  await run("executive_refresh_logs", `
    CREATE TABLE IF NOT EXISTS executive_refresh_logs (
      id              SERIAL PRIMARY KEY,
      company_id      TEXT NOT NULL DEFAULT 'default',
      section_name    TEXT NOT NULL,
      status          TEXT NOT NULL,
      duration_ms     INTEGER,
      rows_processed  INTEGER DEFAULT 0,
      error_message   TEXT,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await run("index: executive_refresh_logs (company_id, section_name)", `
    CREATE INDEX IF NOT EXISTS exec_refresh_company_idx
      ON executive_refresh_logs (company_id, section_name, created_at DESC)
  `);

  console.log("\n✅ Sprint 8B migration complete.");
} catch (err) {
  console.error("\n❌ Migration failed:", err.message);
  process.exit(1);
} finally {
  await pool.end();
}
