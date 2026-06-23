/**
 * Sprint 10B-2 — Company Onboarding Factory
 * Creates: company_modules, company_onboarding_sessions tables in Supabase
 * Usage: node scripts/migrate-company-onboarding.mjs
 */
import pg from "pg";

const connectionString = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) { console.error("No DB URL found"); process.exit(1); }

const pool = new pg.Pool({ connectionString, ssl: { rejectUnauthorized: false } });

const DDL = `
-- ── company_modules ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS company_modules (
  id             SERIAL PRIMARY KEY,
  company_id     TEXT NOT NULL,
  module_key     TEXT NOT NULL,
  is_enabled     BOOLEAN NOT NULL DEFAULT true,
  enabled_at     TIMESTAMPTZ DEFAULT NOW(),
  disabled_at    TIMESTAMPTZ,
  config         JSONB DEFAULT '{}',
  UNIQUE(company_id, module_key)
);
CREATE INDEX IF NOT EXISTS idx_company_modules_company ON company_modules(company_id);

-- ── company_onboarding_sessions ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS company_onboarding_sessions (
  id               SERIAL PRIMARY KEY,
  company_id       TEXT NOT NULL UNIQUE,
  template_used    TEXT,
  current_step     INTEGER NOT NULL DEFAULT 1,
  profile_done     BOOLEAN NOT NULL DEFAULT false,
  admin_done       BOOLEAN NOT NULL DEFAULT false,
  wa_done          BOOLEAN NOT NULL DEFAULT false,
  modules_done     BOOLEAN NOT NULL DEFAULT false,
  seed_done        BOOLEAN NOT NULL DEFAULT false,
  readiness_pct    INTEGER NOT NULL DEFAULT 0,
  went_live_at     TIMESTAMPTZ,
  activation_audit JSONB DEFAULT '{}',
  welcome_checklist JSONB DEFAULT '[]',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cos_company ON company_onboarding_sessions(company_id);

-- ── ensure updated_at is always fresh ───────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_cos_updated_at ON company_onboarding_sessions;
CREATE TRIGGER update_cos_updated_at
  BEFORE UPDATE ON company_onboarding_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
`;

async function run() {
  const client = await pool.connect();
  try {
    console.log("Running Sprint 10B-2 migrations...");
    await client.query(DDL);
    console.log("✅  company_modules created");
    console.log("✅  company_onboarding_sessions created");
    console.log("✅  Sprint 10B-2 migration complete");
  } catch (err) {
    console.error("Migration failed:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
