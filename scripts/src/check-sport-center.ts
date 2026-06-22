import { Pool } from "pg";

const url = process.env.SUPABASE_DATABASE_URL || process.env.SUPABASE_DATABASE_URL_DEV;
if (!url) throw new Error("SUPABASE_DATABASE_URL not set");

const pool = new Pool({
  connectionString: url,
  ssl: url.includes("supabase.com") ? { rejectUnauthorized: false } : false,
});

const client = await pool.connect();

const schemas = await client.query(
  "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('pg_catalog','information_schema','pg_toast') ORDER BY schema_name"
);
console.log("SCHEMAS:", schemas.rows.map((r: any) => r.schema_name));

const scTables = await client.query(
  "SELECT table_name FROM information_schema.tables WHERE table_schema = 'sport_center' ORDER BY table_name"
);
console.log("\nsport_center tables:", scTables.rows.map((r: any) => r.table_name));

for (const row of scTables.rows as { table_name: string }[]) {
  const cols = await client.query(
    "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='sport_center' AND table_name=$1 ORDER BY ordinal_position",
    [row.table_name]
  );
  console.log(`\nTABLE sport_center.${row.table_name}:`);
  (cols.rows as any[]).forEach((c: any) =>
    console.log(`  ${c.column_name}: ${c.data_type}${c.is_nullable === "NO" ? " NOT NULL" : ""}`)
  );
}

client.release();
await pool.end();
