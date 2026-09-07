import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.SUPABASE_DATABASE_URL, ssl: { rejectUnauthorized: false } });

const TABLES = [
  'fleet_units','fleet_documents','fleet_drivers',
  'fleet_driver_performance','fleet_maintenance_records','fleet_maintenance_schedules',
  'fleet_fuel_logs','fleet_fuel_benchmarks',
  'fleet_tires','fleet_tire_rotations','fleet_utilization_logs'
];

async function main() {
  const c = await pool.connect();
  try {
    console.log('\n===== SECTION 1: DATABASE TABLES =====');
    for (const t of TABLES) {
      const ex = await c.query(`SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1)`,[t]);
      if (!ex.rows[0].exists) { console.log(`❌ MISSING: ${t}`); continue; }
      const cnt = await c.query(`SELECT COUNT(*) FROM ${t}`);
      const idx = await c.query(`SELECT indexname FROM pg_indexes WHERE tablename=$1 AND schemaname='public'`,[t]);
      const cid = await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name=$1 AND table_schema='public' AND column_name='company_id'`,[t]);
      console.log(`✅ ${t}: rows=${cnt.rows[0].count}, indexes=${idx.rows.length}, company_id=${cid.rows.length>0}`);
    }

    console.log('\n===== SECTION 6: AI TASKS (fleet) =====');
    try {
      const r = await c.query(`SELECT type, priority, status, LEFT(title,60) as title FROM ai_tasks WHERE type ILIKE '%fleet%' OR type ILIKE '%fuel%' OR type ILIKE '%tire%' OR type ILIKE '%utiliz%' ORDER BY created_at DESC LIMIT 10`);
      if (!r.rows.length) console.log('  (no fleet AI tasks found)');
      r.rows.forEach(row=>console.log(`  [${row.type}] ${row.priority} - ${row.title} (${row.status})`));
    } catch(e){ console.log('  ai_tasks error:',e.message); }

    console.log('\n===== SPRINT 7B UNITS SAMPLE =====');
    try {
      const r = await c.query(`SELECT id, plate_number, vehicle_type, status FROM fleet_units LIMIT 3`);
      r.rows.forEach(row=>console.log(' ',JSON.stringify(row)));
      if (!r.rows.length) console.log('  (no fleet_units data)');
    } catch(e){ console.log('  error:',e.message); }

    console.log('\n===== SPRINT 7B DRIVERS SAMPLE =====');
    try {
      const r = await c.query(`SELECT id, name, license_number, status FROM fleet_drivers LIMIT 3`);
      r.rows.forEach(row=>console.log(' ',JSON.stringify(row)));
      if (!r.rows.length) console.log('  (no fleet_drivers data)');
    } catch(e){ console.log('  error:',e.message); }

  } finally { c.release(); await pool.end(); }
}
main().catch(console.error);
