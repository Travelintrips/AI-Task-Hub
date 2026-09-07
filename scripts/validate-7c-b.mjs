import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.SUPABASE_DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function cols(c, table) {
  const r = await c.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name=$1 AND table_schema='public' ORDER BY ordinal_position`,[table]);
  return r.rows.map(x=>`${x.column_name}(${x.data_type})`).join(', ');
}

async function main() {
  const c = await pool.connect();
  try {
    // Actual column structures
    for (const t of ['fleet_drivers','fleet_units','fleet_maintenance_records','fleet_documents','fleet_fuel_logs','fleet_tires','fleet_utilization_logs']) {
      console.log(`\n[${t}]:`, await cols(c, t));
    }
    // ai_tasks columns
    console.log('\n[ai_tasks]:', await cols(c, 'ai_tasks'));
    
    // test fleet_units API endpoint
    console.log('\n===== API ENDPOINT TEST =====');
    // Check fleet_units row detail
    const u = await c.query(`SELECT * FROM fleet_units LIMIT 1`);
    console.log('fleet_units sample:', JSON.stringify(u.rows[0]));
    
    // check driver cols
    const d = await c.query(`SELECT * FROM fleet_drivers LIMIT 1`);
    console.log('fleet_drivers sample:', JSON.stringify(d.rows[0]));
    
    // Check maintenance
    const m = await c.query(`SELECT * FROM fleet_maintenance_records LIMIT 1`);
    console.log('fleet_maintenance_records sample:', JSON.stringify(m.rows[0]));
    
  } finally { c.release(); await pool.end(); }
}
main().catch(console.error);
