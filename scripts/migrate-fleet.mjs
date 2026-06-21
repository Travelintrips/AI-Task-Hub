/**
 * Sprint 7B — Fleet Foundation schema migration
 * Runs against SUPABASE_DATABASE_URL (same DB as API server)
 * Usage: node scripts/migrate-fleet.mjs
 */
import pg from "pg";

const { Pool } = pg;

const connectionString =
  process.env.SUPABASE_DATABASE_URL ||
  process.env.SUPABASE_DATABASE_URL_DEV;

if (!connectionString) {
  console.error("❌ SUPABASE_DATABASE_URL not set");
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  max: 1,
});

async function run(label, sql) {
  try {
    await pool.query(sql);
    console.log(`✅ ${label}`);
  } catch (e) {
    console.error(`❌ ${label}: ${e.message}`);
    throw e;
  }
}

try {
  // Drop and recreate all fleet tables cleanly
  await run("Drop fleet tables (clean start)", `
    DROP TABLE IF EXISTS fleet_driver_incidents CASCADE;
    DROP TABLE IF EXISTS fleet_gps_logs CASCADE;
    DROP TABLE IF EXISTS fleet_maintenance_schedules CASCADE;
    DROP TABLE IF EXISTS fleet_maintenance_records CASCADE;
    DROP TABLE IF EXISTS fleet_driver_performance CASCADE;
    DROP TABLE IF EXISTS fleet_drivers CASCADE;
    DROP TABLE IF EXISTS fleet_documents CASCADE;
    DROP TABLE IF EXISTS fleet_units CASCADE;
  `);

  await run("fleet_units", `
    CREATE TABLE fleet_units (
      id SERIAL PRIMARY KEY,
      company_id TEXT NOT NULL DEFAULT 'default',
      unit_number TEXT NOT NULL,
      plate_number TEXT NOT NULL,
      vehicle_type TEXT NOT NULL DEFAULT 'truck',
      brand TEXT,
      model TEXT,
      year INTEGER,
      engine_number TEXT,
      chassis_number TEXT,
      color TEXT,
      capacity_kg REAL,
      capacity_m3 REAL,
      fuel_type TEXT DEFAULT 'solar',
      ownership_type TEXT DEFAULT 'own',
      status TEXT NOT NULL DEFAULT 'available',
      current_odometer_km REAL DEFAULT 0,
      base_location TEXT,
      assigned_driver_id INTEGER,
      photo_url TEXT,
      notes TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX fleet_units_company_idx ON fleet_units(company_id);
    CREATE INDEX fleet_units_plate_idx ON fleet_units(plate_number);
    CREATE INDEX fleet_units_status_idx ON fleet_units(status);
    CREATE INDEX fleet_units_company_status_idx ON fleet_units(company_id, status);
  `);

  await run("fleet_documents", `
    CREATE TABLE fleet_documents (
      id SERIAL PRIMARY KEY,
      company_id TEXT NOT NULL DEFAULT 'default',
      fleet_unit_id INTEGER NOT NULL,
      doc_type TEXT NOT NULL,
      doc_number TEXT,
      issued_date DATE,
      expired_date DATE,
      issuing_authority TEXT,
      file_url TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      reminder_days INTEGER DEFAULT 30,
      notes TEXT,
      created_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX fleet_documents_unit_idx ON fleet_documents(fleet_unit_id);
    CREATE INDEX fleet_documents_company_idx ON fleet_documents(company_id);
    CREATE INDEX fleet_documents_type_idx ON fleet_documents(doc_type);
    CREATE INDEX fleet_documents_status_idx ON fleet_documents(status);
    CREATE INDEX fleet_documents_expired_idx ON fleet_documents(expired_date);
  `);

  await run("fleet_drivers", `
    CREATE TABLE fleet_drivers (
      id SERIAL PRIMARY KEY,
      company_id TEXT NOT NULL DEFAULT 'default',
      employee_id TEXT,
      full_name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      license_number TEXT NOT NULL,
      license_type TEXT DEFAULT 'SIM B2',
      license_expired DATE,
      join_date DATE,
      status TEXT NOT NULL DEFAULT 'active',
      primary_vehicle_id INTEGER,
      base_location TEXT,
      emergency_contact TEXT,
      emergency_phone TEXT,
      photo_url TEXT,
      notes TEXT,
      created_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX fleet_drivers_company_idx ON fleet_drivers(company_id);
    CREATE INDEX fleet_drivers_status_idx ON fleet_drivers(status);
    CREATE INDEX fleet_drivers_license_idx ON fleet_drivers(license_number);
    CREATE INDEX fleet_drivers_company_status_idx ON fleet_drivers(company_id, status);
  `);

  await run("fleet_driver_performance", `
    CREATE TABLE fleet_driver_performance (
      id SERIAL PRIMARY KEY,
      company_id TEXT NOT NULL DEFAULT 'default',
      driver_id INTEGER NOT NULL,
      period_month TEXT NOT NULL,
      total_trips INTEGER DEFAULT 0,
      total_km REAL DEFAULT 0,
      on_time_deliveries INTEGER DEFAULT 0,
      late_deliveries INTEGER DEFAULT 0,
      fuel_consumed_ltr REAL DEFAULT 0,
      incidents INTEGER DEFAULT 0,
      customer_complaints INTEGER DEFAULT 0,
      avg_speed_kmh REAL,
      performance_score REAL,
      ai_notes TEXT,
      computed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX fleet_drv_perf_driver_idx ON fleet_driver_performance(driver_id);
    CREATE INDEX fleet_drv_perf_company_idx ON fleet_driver_performance(company_id);
    CREATE INDEX fleet_drv_perf_period_idx ON fleet_driver_performance(period_month);
  `);

  await run("fleet_maintenance_records", `
    CREATE TABLE fleet_maintenance_records (
      id SERIAL PRIMARY KEY,
      company_id TEXT NOT NULL DEFAULT 'default',
      fleet_unit_id INTEGER NOT NULL,
      maintenance_type TEXT NOT NULL DEFAULT 'routine',
      category TEXT DEFAULT 'other',
      description TEXT NOT NULL,
      odometer_at_service REAL,
      service_date DATE NOT NULL,
      workshop_name TEXT,
      workshop_vendor_id INTEGER,
      cost_estimate REAL,
      cost_actual REAL,
      purchase_request_id INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      approved_by TEXT,
      approved_at TIMESTAMPTZ,
      rejected_by TEXT,
      rejected_at TIMESTAMPTZ,
      rejection_reason TEXT,
      completion_date DATE,
      next_service_km REAL,
      next_service_date DATE,
      parts_used JSONB,
      invoice_url TEXT,
      notes TEXT,
      created_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX fleet_maint_unit_idx ON fleet_maintenance_records(fleet_unit_id);
    CREATE INDEX fleet_maint_company_idx ON fleet_maintenance_records(company_id);
    CREATE INDEX fleet_maint_status_idx ON fleet_maintenance_records(status);
    CREATE INDEX fleet_maint_date_idx ON fleet_maintenance_records(service_date);
    CREATE INDEX fleet_maint_company_status_idx ON fleet_maintenance_records(company_id, status);
  `);

  await run("fleet_maintenance_schedules", `
    CREATE TABLE fleet_maintenance_schedules (
      id SERIAL PRIMARY KEY,
      company_id TEXT NOT NULL DEFAULT 'default',
      fleet_unit_id INTEGER NOT NULL,
      schedule_name TEXT NOT NULL,
      trigger_type TEXT NOT NULL DEFAULT 'km_interval',
      km_interval REAL,
      date_interval_days INTEGER,
      last_done_km REAL,
      last_done_date DATE,
      next_due_km REAL,
      next_due_date DATE,
      status TEXT NOT NULL DEFAULT 'active',
      auto_create_task BOOLEAN DEFAULT false,
      notify_roles JSONB,
      created_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX fleet_maint_sched_unit_idx ON fleet_maintenance_schedules(fleet_unit_id);
    CREATE INDEX fleet_maint_sched_company_idx ON fleet_maintenance_schedules(company_id);
    CREATE INDEX fleet_maint_sched_due_idx ON fleet_maintenance_schedules(next_due_date);
  `);

  await run("fleet_gps_logs", `
    CREATE TABLE fleet_gps_logs (
      id SERIAL PRIMARY KEY,
      company_id TEXT NOT NULL DEFAULT 'default',
      fleet_unit_id INTEGER NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      latitude REAL,
      longitude REAL,
      speed_kmh REAL,
      heading_deg REAL,
      odometer_km REAL,
      engine_on BOOLEAN DEFAULT true,
      source TEXT DEFAULT 'manual',
      raw_payload JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX fleet_gps_unit_idx ON fleet_gps_logs(fleet_unit_id);
    CREATE INDEX fleet_gps_recorded_idx ON fleet_gps_logs(recorded_at);
    CREATE INDEX fleet_gps_company_idx ON fleet_gps_logs(company_id);
  `);

  await run("fleet_driver_incidents", `
    CREATE TABLE fleet_driver_incidents (
      id SERIAL PRIMARY KEY,
      company_id TEXT NOT NULL DEFAULT 'default',
      driver_id INTEGER NOT NULL,
      fleet_unit_id INTEGER,
      incident_type TEXT NOT NULL DEFAULT 'other',
      incident_date DATE NOT NULL,
      location TEXT,
      description TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'low',
      fault_percentage INTEGER DEFAULT 0,
      injuries_reported BOOLEAN DEFAULT false,
      property_damage BOOLEAN DEFAULT false,
      estimated_damage REAL,
      police_report_number TEXT,
      insurance_claim_number TEXT,
      action_taken TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      closed_at TIMESTAMPTZ,
      attachments JSONB,
      notes TEXT,
      created_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX fleet_incidents_driver_idx ON fleet_driver_incidents(driver_id);
    CREATE INDEX fleet_incidents_company_idx ON fleet_driver_incidents(company_id);
    CREATE INDEX fleet_incidents_date_idx ON fleet_driver_incidents(incident_date);
    CREATE INDEX fleet_incidents_status_idx ON fleet_driver_incidents(status);
  `);

  console.log("\n🎉 All fleet tables created in Supabase successfully.");
} catch (e) {
  console.error("\n💥 Migration failed:", e.message);
  process.exit(1);
} finally {
  await pool.end();
}
