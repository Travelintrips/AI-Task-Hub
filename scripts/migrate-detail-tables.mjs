/**
 * Audit Perbaikan — Hybrid Flow Detail Tables
 * Membuat 3 tabel detail untuk menyimpan field yang dikumpulkan via AI intake
 * tanpa mengubah schema ai_tasks yang sudah ada.
 *
 * Tables:
 *   - trucking_task_details   (Trucking category)
 *   - logistic_task_details   (Import/Export/Customs/PPJK/Freight/Finance)
 *   - sport_center_task_details (Sport Center booking)
 *
 * Usage: cd scripts && node migrate-detail-tables.mjs
 */
import pg from "pg";

const connectionString =
  process.env.SUPABASE_DATABASE_URL ||
  process.env.SUPABASE_DATABASE_URL_DEV ||
  process.env.DATABASE_URL;

if (!connectionString) {
  console.error("❌  No DB URL found (SUPABASE_DATABASE_URL / SUPABASE_DATABASE_URL_DEV / DATABASE_URL)");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString, ssl: { rejectUnauthorized: false } });

const DDL = `
-- ── trucking_task_details ─────────────────────────────────────────────────────
-- Menyimpan field spesifik trucking yang dikumpulkan via conversation intake
CREATE TABLE IF NOT EXISTS trucking_task_details (
  id              SERIAL PRIMARY KEY,
  task_id         INTEGER,           -- FK ai_tasks.id (nullable: dibuat async)
  session_id      INTEGER,           -- FK intake_sessions.id (untuk link awal)
  company_id      TEXT,
  origin          TEXT,              -- Kota asal pengiriman
  destination     TEXT,              -- Kota tujuan pengiriman
  commodity       TEXT,              -- Jenis barang
  cargo_weight    TEXT,              -- Berat muatan (e.g. "5 ton")
  cargo_volume    TEXT,              -- Volume muatan (e.g. "10 CBM")
  vehicle_type    TEXT,              -- Tipe kendaraan (tronton/fuso/engkel dll)
  pickup_date     TEXT,              -- Tanggal pickup (ISO string atau teks)
  contact_person  TEXT,              -- Nama kontak pengirim
  phone           TEXT,              -- Nomor HP
  notes           TEXT,              -- Catatan tambahan
  raw_fields      JSONB DEFAULT '{}', -- Semua collectedFields mentah
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_trucking_details_task   ON trucking_task_details(task_id)   WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trucking_details_session ON trucking_task_details(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trucking_details_company ON trucking_task_details(company_id);

-- ── logistic_task_details ─────────────────────────────────────────────────────
-- Field kritis PPJK/Customs/Import/Export yang tidak ada kolom di ai_tasks
CREATE TABLE IF NOT EXISTS logistic_task_details (
  id              SERIAL PRIMARY KEY,
  task_id         INTEGER,
  session_id      INTEGER,
  company_id      TEXT,
  category        TEXT,              -- Import/Export/Customs/Freight/Finance
  importer_name   TEXT,              -- Nama importir/eksportir
  npwp            TEXT,              -- NPWP perusahaan
  nib             TEXT,              -- NIB perusahaan
  hs_code         TEXT,              -- HS Code komoditas (kritis untuk customs)
  commodity       TEXT,              -- Jenis komoditas
  origin_country  TEXT,              -- Negara asal
  port_of_entry   TEXT,              -- Pelabuhan masuk/keluar
  invoice_value   TEXT,              -- Nilai invoice (USD/IDR)
  invoice_number  TEXT,              -- Nomor invoice
  bl_number       TEXT,              -- Nomor Bill of Lading / AWB
  pib_peb_type    TEXT,              -- Jenis PIB/PEB
  api_number      TEXT,              -- Nomor API importir
  lartas          TEXT,              -- Status lartas (larangan/pembatasan)
  shipment_type   TEXT,              -- FCL/LCL/Air/Sea
  target_date     TEXT,              -- Target penyelesaian
  raw_fields      JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_logistic_details_task    ON logistic_task_details(task_id)    WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_logistic_details_session ON logistic_task_details(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_logistic_details_hs_code ON logistic_task_details(hs_code)    WHERE hs_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_logistic_details_company ON logistic_task_details(company_id);

-- ── sport_center_task_details ─────────────────────────────────────────────────
-- Detail booking lapangan yang dikumpulkan via hybrid intake
CREATE TABLE IF NOT EXISTS sport_center_task_details (
  id              SERIAL PRIMARY KEY,
  task_id         INTEGER,
  session_id      INTEGER,
  company_id      TEXT,
  field_type      TEXT,              -- Jenis lapangan: futsal/badminton/voli dll
  booking_date    TEXT,              -- Tanggal booking (YYYY-MM-DD)
  start_time      TEXT,              -- Jam mulai (HH:MM)
  end_time        TEXT,              -- Jam selesai (HH:MM)
  duration_hours  NUMERIC(4,1),      -- Durasi dalam jam
  player_count    INTEGER,           -- Jumlah pemain/orang
  booker_name     TEXT,              -- Nama pemesan
  phone           TEXT,              -- HP pemesan
  is_member       BOOLEAN DEFAULT false,
  member_id       TEXT,              -- ID member jika ada
  total_price     INTEGER,           -- Total harga (Rupiah)
  booking_code    TEXT,              -- Kode booking (SC-AI-xxxxx)
  notes           TEXT,
  raw_fields      JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sc_details_task      ON sport_center_task_details(task_id)    WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sc_details_session   ON sport_center_task_details(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sc_details_date      ON sport_center_task_details(booking_date);
CREATE INDEX IF NOT EXISTS idx_sc_details_field     ON sport_center_task_details(field_type);
CREATE INDEX IF NOT EXISTS idx_sc_details_company   ON sport_center_task_details(company_id);
`;

try {
  console.log("🔌 Connecting to Supabase...");
  await pool.query("SELECT 1"); // test connection
  console.log("✅ Connected\n");

  console.log("📦 Running DDL migrations...");
  await pool.query(DDL);

  // Verify tables created
  const { rows } = await pool.query(`
    SELECT table_name, 
           (SELECT COUNT(*) FROM information_schema.columns WHERE table_name=t.table_name) AS col_count
    FROM information_schema.tables t
    WHERE table_schema = 'public'
      AND table_name IN ('trucking_task_details','logistic_task_details','sport_center_task_details')
    ORDER BY table_name
  `);

  console.log("\n✅ Tables created/verified:");
  console.table(rows);

  if (rows.length < 3) {
    console.warn("⚠️  Some tables may not have been created — check DDL output above.");
  } else {
    console.log("\n🎉 Migration complete! All 3 detail tables ready.");
  }
} catch (err) {
  console.error("❌ Migration failed:", err.message);
  process.exit(1);
} finally {
  await pool.end();
}
