/**
 * Migration: create conversation_intake_sessions table
 * Run: node scripts/migrate-intake-sessions.mjs
 */
import pg from "pg";
const { Pool } = pg;

const url = process.env.SUPABASE_DATABASE_URL;
if (!url) throw new Error("SUPABASE_DATABASE_URL not set");

const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const sql = `
CREATE TABLE IF NOT EXISTS conversation_intake_sessions (
  id                 SERIAL PRIMARY KEY,
  company_id         TEXT NOT NULL DEFAULT 'default',
  phone              TEXT NOT NULL,
  customer_id        TEXT,

  intent_code        TEXT NOT NULL,
  intent_name        TEXT,
  category           TEXT,

  status             TEXT NOT NULL DEFAULT 'collecting',

  collected_fields   JSONB NOT NULL DEFAULT '{}',
  missing_fields     JSONB NOT NULL DEFAULT '[]',
  required_documents JSONB NOT NULL DEFAULT '[]',
  uploaded_documents JSONB NOT NULL DEFAULT '[]',

  last_question      TEXT,
  last_message       TEXT,
  task_id            TEXT,

  expires_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS intake_sessions_phone_idx        ON conversation_intake_sessions(phone);
CREATE INDEX IF NOT EXISTS intake_sessions_company_idx      ON conversation_intake_sessions(company_id);
CREATE INDEX IF NOT EXISTS intake_sessions_status_idx       ON conversation_intake_sessions(status);
CREATE INDEX IF NOT EXISTS intake_sessions_phone_status_idx ON conversation_intake_sessions(phone, status);
CREATE INDEX IF NOT EXISTS intake_sessions_intent_idx       ON conversation_intake_sessions(intent_code);
`;

try {
  await pool.query(sql);
  console.log("✅ conversation_intake_sessions table created (or already exists)");
} catch (err) {
  console.error("❌ Migration failed:", err.message);
  process.exit(1);
} finally {
  await pool.end();
}
