/**
 * Sprint 9C — Migration: document_intake_audits + document_validation_rules
 * Run: node scripts/src/migrate-document-validation.mjs
 */
import pg from "pg";

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL || "",
});

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ── document_intake_audits ────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS document_intake_audits (
        id                  SERIAL PRIMARY KEY,
        company_id          TEXT NOT NULL DEFAULT 'default',
        task_id             INTEGER,
        intake_session_id   INTEGER,
        customer_id         INTEGER,
        vendor_id           INTEGER,
        fleet_unit_id       INTEGER,
        document_type       TEXT NOT NULL,
        file_name           TEXT NOT NULL,
        file_url            TEXT NOT NULL,
        object_path         TEXT,
        extracted_fields    JSONB DEFAULT '{}',
        required_fields     JSONB DEFAULT '[]',
        missing_fields      TEXT[] NOT NULL DEFAULT '{}',
        validation_status   TEXT NOT NULL DEFAULT 'needs_review',
        confidence_score    NUMERIC(5,4) NOT NULL DEFAULT 0,
        issue_summary       TEXT,
        ai_notes            TEXT,
        reviewed_by         TEXT,
        reviewed_at         TIMESTAMPTZ,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log("✅ document_intake_audits table created/verified");

    // Indexes for document_intake_audits
    await client.query(`CREATE INDEX IF NOT EXISTS doc_intake_audits_company_idx ON document_intake_audits(company_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS doc_intake_audits_task_idx ON document_intake_audits(task_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS doc_intake_audits_session_idx ON document_intake_audits(intake_session_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS doc_intake_audits_status_idx ON document_intake_audits(validation_status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS doc_intake_audits_type_idx ON document_intake_audits(document_type)`);
    console.log("✅ document_intake_audits indexes created");

    // ── document_validation_rules ─────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS document_validation_rules (
        id                  SERIAL PRIMARY KEY,
        company_id          TEXT NOT NULL DEFAULT 'default',
        document_type       TEXT NOT NULL,
        intent_code         TEXT,
        required_fields     TEXT[] NOT NULL DEFAULT '{}',
        optional_fields     TEXT[] NOT NULL DEFAULT '{}',
        validation_prompt   TEXT,
        is_active           BOOLEAN NOT NULL DEFAULT TRUE,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log("✅ document_validation_rules table created/verified");

    await client.query(`CREATE INDEX IF NOT EXISTS doc_validation_rules_company_idx ON document_validation_rules(company_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS doc_validation_rules_type_idx ON document_validation_rules(document_type)`);
    console.log("✅ document_validation_rules indexes created");

    await client.query("COMMIT");
    console.log("🎉 Migration selesai!");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Migration gagal:", err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => { console.error(err); process.exit(1); });
