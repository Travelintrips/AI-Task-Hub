/**
 * Fix hybrid intake_mode for trucking_inquiry and sport_center_booking
 * Run: cd scripts && node fix-hybrid-templates.mjs
 */
import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.SUPABASE_DATABASE_URL || process.env.SUPABASE_DATABASE_URL_DEV,
  ssl: { rejectUnauthorized: false },
});

const companyResult = await pool.query("SELECT id FROM companies LIMIT 1");
const companyId = companyResult.rows[0]?.id;
if (!companyId) {
  console.error("No company found");
  process.exit(1);
}
console.log("Using company_id:", companyId);

// Upsert trucking_inquiry: update if exists, insert if not
const existing = await pool.query(
  "SELECT id FROM data_templates WHERE company_id = $1 AND intent_code = 'trucking_inquiry'",
  [companyId],
);
if (existing.rows.length > 0) {
  await pool.query(
    `UPDATE data_templates SET intake_mode='hybrid', mini_form_type='trucking', use_mini_form=true, updated_at=NOW()
     WHERE company_id=$1 AND intent_code='trucking_inquiry'`,
    [companyId],
  );
  console.log("trucking_inquiry: updated intake_mode=hybrid, mini_form_type=trucking");
} else {
  await pool.query(
    `INSERT INTO data_templates (company_id, intent_code, name, category, description, is_active, use_mini_form, mini_form_type, intake_mode, created_at, updated_at)
     VALUES ($1, 'trucking_inquiry', 'Permintaan Trucking', 'Logistik', 'Pengiriman barang via trucking domestik', true, true, 'trucking', 'hybrid', NOW(), NOW())`,
    [companyId],
  );
  console.log("trucking_inquiry: inserted with intake_mode=hybrid, mini_form_type=trucking");
}

// Fix sport_center_booking: ensure intake_mode=hybrid, mini_form_type=field-booking
await pool.query(
  `UPDATE data_templates SET intake_mode='hybrid', mini_form_type='field-booking', updated_at=NOW()
   WHERE company_id=$1 AND intent_code='sport_center_booking'`,
  [companyId],
);
console.log("sport_center_booking: ensured intake_mode=hybrid, mini_form_type=field-booking");

// Verify
const r = await pool.query(
  `SELECT intent_code, intake_mode, mini_form_type FROM data_templates
   WHERE intent_code IN ('trucking_inquiry','sport_center_booking','import_inquiry','customs_clearance')
   ORDER BY intent_code`,
);
console.log("\nFinal state:");
console.table(r.rows);

await pool.end();
