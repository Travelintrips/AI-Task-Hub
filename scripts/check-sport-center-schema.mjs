import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.SUPABASE_DATABASE_URL,
  ssl: false
});

const client = await pool.connect();

const schemas = await client.query(
  "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('pg_catalog','information_schema','pg_toast') ORDER BY schema_name"
);
console.log('SCHEMAS:', schemas.rows.map(r => r.schema_name));

const scTables = await client.query(
  "SELECT table_name FROM information_schema.tables WHERE table_schema = 'sport_center' ORDER BY table_name"
);
console.log('\nsport_center tables:', scTables.rows.map(r => r.table_name));

for (const row of scTables.rows) {
  const cols = await client.query(
    "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='sport_center' AND table_name=$1 ORDER BY ordinal_position",
    [row.table_name]
  );
  console.log(`\nTABLE sport_center.${row.table_name}:`);
  cols.rows.forEach(c => console.log(`  ${c.column_name}: ${c.data_type} ${c.is_nullable === 'NO' ? 'NOT NULL' : ''}`));
}

client.release();
await pool.end();
