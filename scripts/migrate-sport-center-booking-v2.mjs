/**
 * Migration: Enhance sport_center_bookings table for full booking lifecycle.
 * Adds: booking_number, facility_name, price_per_hour, total_price,
 *       payment_status, payment_proof_url, payment_proof_token, payment_deadline, admin_notes
 *
 * Run: node scripts/migrate-sport-center-booking-v2.mjs
 */
import pg from "pg";
import crypto from "crypto";

const DATABASE_URL = process.env.SUPABASE_DATABASE_URL_DEV ?? process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: SUPABASE_DATABASE_URL_DEV or DATABASE_URL not set");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  const client = await pool.connect();
  try {
    console.log("Starting sport_center_bookings v2 migration...");

    await client.query(`
      ALTER TABLE sport_center_bookings
        ADD COLUMN IF NOT EXISTS booking_number      TEXT UNIQUE,
        ADD COLUMN IF NOT EXISTS facility_name       TEXT,
        ADD COLUMN IF NOT EXISTS price_per_hour      NUMERIC(10,2),
        ADD COLUMN IF NOT EXISTS total_price         NUMERIC(10,2),
        ADD COLUMN IF NOT EXISTS payment_status      TEXT NOT NULL DEFAULT 'unpaid',
        ADD COLUMN IF NOT EXISTS payment_proof_url   TEXT,
        ADD COLUMN IF NOT EXISTS payment_proof_token TEXT UNIQUE,
        ADD COLUMN IF NOT EXISTS payment_deadline    TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS admin_notes         TEXT
    `);
    console.log("✓ Columns added");

    await client.query(`
      CREATE INDEX IF NOT EXISTS sc_bookings_booking_number_idx ON sport_center_bookings(booking_number);
      CREATE INDEX IF NOT EXISTS sc_bookings_token_idx ON sport_center_bookings(payment_proof_token);
      CREATE INDEX IF NOT EXISTS sc_bookings_phone_idx ON sport_center_bookings(phone);
    `);
    console.log("✓ Indexes created");

    // Backfill booking_number for existing rows that don't have one
    const { rows: existing } = await client.query(
      `SELECT id FROM sport_center_bookings WHERE booking_number IS NULL ORDER BY id ASC`
    );
    for (const row of existing) {
      // Generate SC-XXXX style number
      const seq = String(row.id).padStart(4, "0");
      const bn = `SC-${seq}`;
      await client.query(
        `UPDATE sport_center_bookings SET booking_number = $1 WHERE id = $2`,
        [bn, row.id]
      );
    }
    console.log(`✓ Backfilled booking_number for ${existing.length} existing rows`);

    // Generate payment_proof_token for rows without one
    const { rows: noToken } = await client.query(
      `SELECT id FROM sport_center_bookings WHERE payment_proof_token IS NULL ORDER BY id ASC`
    );
    for (const row of noToken) {
      const token = crypto.randomBytes(8).toString("base64url");
      await client.query(
        `UPDATE sport_center_bookings SET payment_proof_token = $1 WHERE id = $2`,
        [token, row.id]
      );
    }
    console.log(`✓ Backfilled payment_proof_token for ${noToken.length} rows`);

    console.log("✅ Migration complete!");
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
