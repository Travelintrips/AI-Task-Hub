import pg from "pg";

const DATABASE_URL = process.env.SUPABASE_DATABASE_URL_DEV ?? process.env.DATABASE_URL;
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  const client = await pool.connect();
  try {
    // Drop global unique, add composite unique per company
    await client.query(`
      DO $$
      BEGIN
        -- Drop old global unique if exists
        IF EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'sport_center_bookings_booking_number_key'
        ) THEN
          ALTER TABLE sport_center_bookings DROP CONSTRAINT sport_center_bookings_booking_number_key;
        END IF;
        -- Add composite unique per company
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'sc_bookings_company_number_uq'
        ) THEN
          ALTER TABLE sport_center_bookings ADD CONSTRAINT sc_bookings_company_number_uq UNIQUE (company_id, booking_number);
        END IF;
      END$$;
    `);
    console.log("✓ Constraint fixed: booking_number is now UNIQUE per company");

    // Also fix payment_proof_token - keep global unique (tokens should be globally unique)
    console.log("✓ payment_proof_token global unique retained (correct)");
    console.log("✅ Done!");
  } finally {
    client.release();
    await pool.end();
  }
}
run().catch(e => { console.error(e); process.exit(1); });
