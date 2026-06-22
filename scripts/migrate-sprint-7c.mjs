/**
 * Sprint 7C Migration — Fuel Intelligence, Tire Lifecycle, Utilization
 * Run: node scripts/migrate-sprint-7c.mjs
 */

import pg from "pg";

const { Pool } = pg;

const connectionString = process.env.SUPABASE_DATABASE_URL;
if (!connectionString) {
  console.error("ERROR: SUPABASE_DATABASE_URL is not set");
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

const migrations = [
  {
    name: "fleet_fuel_benchmarks",
    sql: `
      CREATE TABLE IF NOT EXISTS fleet_fuel_benchmarks (
        id SERIAL PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT 'default',
        vehicle_type TEXT NOT NULL,
        fuel_type TEXT NOT NULL DEFAULT 'solar',
        benchmark_km_per_liter REAL NOT NULL,
        tolerance_pct REAL NOT NULL DEFAULT 20,
        min_liters_alert REAL,
        max_liters_alert REAL,
        notes TEXT,
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS fleet_fuel_bench_company_idx ON fleet_fuel_benchmarks(company_id);
      CREATE INDEX IF NOT EXISTS fleet_fuel_bench_type_idx ON fleet_fuel_benchmarks(vehicle_type, fuel_type);
    `,
  },
  {
    name: "fleet_fuel_logs",
    sql: `
      CREATE TABLE IF NOT EXISTS fleet_fuel_logs (
        id SERIAL PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT 'default',
        fleet_unit_id INTEGER NOT NULL,
        driver_id INTEGER,
        logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        odometer_km REAL NOT NULL,
        liters_filled REAL NOT NULL,
        fuel_type TEXT DEFAULT 'solar',
        price_per_liter REAL,
        total_cost REAL,
        station_name TEXT,
        km_since_last_fill REAL,
        km_per_liter REAL,
        is_anomaly BOOLEAN DEFAULT FALSE,
        anomaly_reason TEXT,
        anomaly_score REAL,
        notes TEXT,
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS fleet_fuel_unit_idx ON fleet_fuel_logs(fleet_unit_id);
      CREATE INDEX IF NOT EXISTS fleet_fuel_company_idx ON fleet_fuel_logs(company_id);
      CREATE INDEX IF NOT EXISTS fleet_fuel_logged_idx ON fleet_fuel_logs(logged_at);
      CREATE INDEX IF NOT EXISTS fleet_fuel_anomaly_idx ON fleet_fuel_logs(is_anomaly);
    `,
  },
  {
    name: "fleet_tires",
    sql: `
      CREATE TABLE IF NOT EXISTS fleet_tires (
        id SERIAL PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT 'default',
        fleet_unit_id INTEGER NOT NULL,
        serial_number TEXT,
        brand TEXT,
        model TEXT,
        size_name TEXT,
        position TEXT NOT NULL,
        install_date DATE,
        install_odometer_km REAL,
        expected_life_km REAL DEFAULT 80000,
        current_odometer_km REAL,
        used_km REAL,
        remaining_km REAL,
        wear_pct REAL,
        status TEXT NOT NULL DEFAULT 'good',
        replaced_at TIMESTAMPTZ,
        replaced_reason TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        notes TEXT,
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS fleet_tires_unit_idx ON fleet_tires(fleet_unit_id);
      CREATE INDEX IF NOT EXISTS fleet_tires_company_idx ON fleet_tires(company_id);
      CREATE INDEX IF NOT EXISTS fleet_tires_status_idx ON fleet_tires(status);
      CREATE INDEX IF NOT EXISTS fleet_tires_active_idx ON fleet_tires(is_active);
    `,
  },
  {
    name: "fleet_tire_rotations",
    sql: `
      CREATE TABLE IF NOT EXISTS fleet_tire_rotations (
        id SERIAL PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT 'default',
        fleet_unit_id INTEGER NOT NULL,
        rotation_date DATE NOT NULL,
        odometer_at_rotation REAL,
        positions_changed JSONB,
        performed_by TEXT,
        workshop_name TEXT,
        notes TEXT,
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS fleet_tire_rot_unit_idx ON fleet_tire_rotations(fleet_unit_id);
      CREATE INDEX IF NOT EXISTS fleet_tire_rot_company_idx ON fleet_tire_rotations(company_id);
      CREATE INDEX IF NOT EXISTS fleet_tire_rot_date_idx ON fleet_tire_rotations(rotation_date);
    `,
  },
  {
    name: "fleet_utilization_logs",
    sql: `
      CREATE TABLE IF NOT EXISTS fleet_utilization_logs (
        id SERIAL PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT 'default',
        fleet_unit_id INTEGER NOT NULL,
        driver_id INTEGER,
        ai_task_id INTEGER,
        origin TEXT,
        destination TEXT,
        trip_purpose TEXT,
        planned_km REAL,
        actual_km REAL,
        planned_departure TIMESTAMPTZ,
        actual_departure TIMESTAMPTZ,
        planned_arrival TIMESTAMPTZ,
        actual_arrival TIMESTAMPTZ,
        delay_minutes INTEGER,
        capacity_used_pct REAL,
        cargo_weight_kg REAL,
        status TEXT NOT NULL DEFAULT 'planned',
        cancel_reason TEXT,
        notes TEXT,
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS fleet_util_unit_idx ON fleet_utilization_logs(fleet_unit_id);
      CREATE INDEX IF NOT EXISTS fleet_util_company_idx ON fleet_utilization_logs(company_id);
      CREATE INDEX IF NOT EXISTS fleet_util_status_idx ON fleet_utilization_logs(status);
      CREATE INDEX IF NOT EXISTS fleet_util_departure_idx ON fleet_utilization_logs(planned_departure);
    `,
  },
];

async function run() {
  const client = await pool.connect();
  try {
    console.log("Sprint 7C Migration starting...\n");

    for (const m of migrations) {
      process.stdout.write(`  Creating ${m.name}... `);
      try {
        await client.query(m.sql);
        console.log("✓");
      } catch (err) {
        console.log("✗");
        console.error(`  ERROR: ${err.message}`);
        throw err;
      }
    }

    console.log("\nAll 5 tables created successfully.");
    console.log("Sprint 7C migration complete ✓");
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error("\nMigration failed:", err.message);
  process.exit(1);
});
