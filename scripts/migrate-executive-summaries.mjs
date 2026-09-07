/**
 * Sprint 8D — Executive Summaries schema migration
 * Runs against SUPABASE_DATABASE_URL (same DB as API server)
 * Usage: node scripts/migrate-executive-summaries.mjs
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
  await run("executive_summaries table", `
    CREATE TABLE IF NOT EXISTS executive_summaries (
      id              SERIAL PRIMARY KEY,
      company_id      VARCHAR(255) NOT NULL DEFAULT 'default',
      summary         TEXT NOT NULL,
      risks           JSONB NOT NULL DEFAULT '[]',
      actions         JSONB NOT NULL DEFAULT '[]',
      context_hash    TEXT,
      generated_by    VARCHAR(255) NOT NULL DEFAULT 'system',
      generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await run("idx executive_summaries company_id", `
    CREATE INDEX IF NOT EXISTS idx_exec_summaries_company_id
    ON executive_summaries (company_id)
  `);

  await run("idx executive_summaries generated_at desc", `
    CREATE INDEX IF NOT EXISTS idx_exec_summaries_generated_at
    ON executive_summaries (generated_at DESC)
  `);

  console.log("\n✅ Sprint 8D migration complete.");
} catch (e) {
  console.error("\n❌ Migration failed:", e.message);
  process.exit(1);
} finally {
  await pool.end();
}
