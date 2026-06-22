import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.SUPABASE_DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1 });
const tables = ["data_templates","data_template_fields","document_templates","document_template_fields","service_catalog","keyword_rules","intent_master"];
for (const t of tables) {
  const r = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`, [t]);
  if (r.rows.length === 0) { console.log(`── ${t}: NOT FOUND`); continue; }
  console.log(`── ${t}: ${r.rows.map(c=>c.column_name).join(", ")}`);
}
await pool.end();
