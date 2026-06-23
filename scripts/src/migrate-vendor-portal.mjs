/**
 * Sprint 10A-3 — Vendor Self-Service Migration
 * 1. ADD COLUMN IF NOT EXISTS ke suppliers
 * 2. CREATE TABLE IF NOT EXISTS vendor_portal_tokens
 *
 * Run: node scripts/src/migrate-vendor-portal.mjs
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

    console.log("=== 1. ALTER TABLE suppliers ===");
    const supplierCols = [
      `ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS registration_status TEXT NOT NULL DEFAULT 'unregistered'`,
      `ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS review_notes TEXT`,
      `ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS nib TEXT`,
      `ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS npwp TEXT`,
      `ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS coverage_area TEXT`,
      `ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS vehicle_type TEXT`,
      `ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS service_capacity TEXT`,
      `ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS portal_phone TEXT`,
    ];
    for (const q of supplierCols) {
      await client.query(q);
      console.log("  ✓ " + q.replace("ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS ", ""));
    }

    console.log("\n=== 2. CREATE TABLE vendor_portal_tokens ===");
    await client.query(`
      CREATE TABLE IF NOT EXISTS vendor_portal_tokens (
        id              SERIAL PRIMARY KEY,
        token           TEXT NOT NULL UNIQUE,
        vendor_id       INTEGER,
        phone           TEXT NOT NULL,
        token_purpose   TEXT NOT NULL,
        expires_at      TIMESTAMPTZ NOT NULL,
        used_at         TIMESTAMPTZ,
        is_revoked      BOOLEAN NOT NULL DEFAULT FALSE,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_vendor_portal_tokens_token ON vendor_portal_tokens (token)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_vendor_portal_tokens_phone ON vendor_portal_tokens (phone)`);
    console.log("  ✓ vendor_portal_tokens created");

    await client.query("COMMIT");
    console.log("\n✅ Migrasi selesai");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("ERROR:", err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => { console.error(err); process.exit(1); });
