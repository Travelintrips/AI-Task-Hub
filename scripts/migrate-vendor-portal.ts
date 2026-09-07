/**
 * Sprint 10A-3 — Vendor Self-Service Portal DB Migration
 * Creates vendor_portal_tokens table + adds columns to suppliers & vendor_document_registry
 * Uses SUPABASE_DATABASE_URL (same priority as Drizzle ORM)
 *
 * Run: tsx scripts/migrate-vendor-portal.ts
 */

import { Pool } from "pg";

const connectionString =
  process.env.SUPABASE_DATABASE_URL ||
  process.env.SUPABASE_DATABASE_URL_DEV ||
  process.env.DATABASE_URL ||
  "postgresql://postgres:password@helium/heliumdb?sslmode=disable";

console.log(`▶ Connecting to DB (${connectionString.includes("supabase") ? "Supabase" : "Replit"})`);

const pool = new Pool({
  connectionString,
  ssl: connectionString.includes("supabase.co") ? { rejectUnauthorized: false } : false,
});

async function main() {
  const client = await pool.connect();
  try {
    console.log("▶ Creating vendor_portal_tokens table...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS vendor_portal_tokens (
        id            SERIAL PRIMARY KEY,
        token         TEXT NOT NULL UNIQUE,
        vendor_id     INTEGER,
        phone         TEXT NOT NULL,
        token_purpose TEXT NOT NULL DEFAULT 'register',
        expires_at    TIMESTAMPTZ,
        used_at       TIMESTAMPTZ,
        is_revoked    BOOLEAN NOT NULL DEFAULT false,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_vendor_portal_tokens_token ON vendor_portal_tokens(token);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_vendor_portal_tokens_phone ON vendor_portal_tokens(phone);
    `);
    console.log("✓ vendor_portal_tokens table ready");

    console.log("▶ Adding columns to suppliers table...");
    await client.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS registration_status TEXT NOT NULL DEFAULT 'unregistered';`);
    await client.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS portal_phone TEXT;`);
    await client.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS review_notes TEXT;`);
    await client.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contact_person TEXT;`);
    await client.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contact_email TEXT;`);
    await client.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS coverage_area TEXT;`);
    await client.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS vehicle_type TEXT;`);
    await client.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS service_capacity TEXT;`);
    await client.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS nib TEXT;`);
    await client.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS npwp TEXT;`);
    console.log("✓ suppliers columns ready");

    console.log("▶ Adding status column to vendor_document_registry...");
    await client.query(`ALTER TABLE vendor_document_registry ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';`);
    await client.query(`ALTER TABLE vendor_document_registry ADD COLUMN IF NOT EXISTS file_name TEXT;`);
    await client.query(`ALTER TABLE vendor_document_registry ADD COLUMN IF NOT EXISTS file_url TEXT;`);
    await client.query(`ALTER TABLE vendor_document_registry ADD COLUMN IF NOT EXISTS is_current BOOLEAN NOT NULL DEFAULT true;`);
    await client.query(`ALTER TABLE vendor_document_registry ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT false;`);
    await client.query(`ALTER TABLE vendor_document_registry ADD COLUMN IF NOT EXISTS expiry_date DATE;`);
    await client.query(`ALTER TABLE vendor_document_registry ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
    console.log("✓ vendor_document_registry columns ready");

    console.log("✅ Sprint 10A-3 DB migration complete");
  } catch (err) {
    console.error("❌ Migration failed:", (err as Error).message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(() => process.exit(1));
