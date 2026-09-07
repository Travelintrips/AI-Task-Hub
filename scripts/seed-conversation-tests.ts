/**
 * Sprint 9D — Create conversation test tables + seed 30 test cases
 * Uses same DB priority as Drizzle ORM: SUPABASE_DATABASE_URL first, then DATABASE_URL
 *
 * Run: tsx scripts/seed-conversation-tests.ts
 */

import { Pool } from "pg";

const connectionString =
  process.env.SUPABASE_DATABASE_URL ||
  process.env.SUPABASE_DATABASE_URL_DEV ||
  process.env.DATABASE_URL ||
  "postgresql://postgres:password@helium/heliumdb?sslmode=disable";

console.log(`▶ Connecting to DB (${connectionString.includes("supabase") ? "Supabase" : "Replit"})`);

const pool = new Pool({
  connectionString,
  ssl: connectionString.includes("supabase.co") ? { rejectUnauthorized: false } : false,
});

async function main() {
  const client = await pool.connect();
  try {
    console.log("▶ Creating conversation test tables...");

    await client.query(`
      CREATE TABLE IF NOT EXISTS conversation_test_cases (
        id                      SERIAL PRIMARY KEY,
        company_id              TEXT NOT NULL DEFAULT 'default',
        test_name               TEXT NOT NULL,
        intent_code             TEXT,
        scenario_type           TEXT NOT NULL DEFAULT 'normal',
        input_messages          JSONB NOT NULL DEFAULT '[]',
        expected_behavior       JSONB NOT NULL DEFAULT '{}',
        expected_intent_code    TEXT,
        expected_intake_mode    TEXT,
        expected_task_created   BOOLEAN NOT NULL DEFAULT false,
        expected_mini_form_sent BOOLEAN NOT NULL DEFAULT false,
        expected_admin_handoff  BOOLEAN NOT NULL DEFAULT false,
        expected_missing_fields JSONB NOT NULL DEFAULT '[]',
        is_critical             BOOLEAN NOT NULL DEFAULT false,
        is_active               BOOLEAN NOT NULL DEFAULT true,
        created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS conversation_test_runs (
        id                  SERIAL PRIMARY KEY,
        company_id          TEXT NOT NULL DEFAULT 'default',
        run_name            TEXT NOT NULL,
        total_cases         INTEGER NOT NULL DEFAULT 0,
        passed_cases        INTEGER NOT NULL DEFAULT 0,
        failed_cases        INTEGER NOT NULL DEFAULT 0,
        pass_rate           REAL NOT NULL DEFAULT 0,
        status              TEXT NOT NULL DEFAULT 'running',
        quality_gate_passed BOOLEAN,
        gate_details        JSONB NOT NULL DEFAULT '{}',
        started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        finished_at         TIMESTAMPTZ,
        created_by          TEXT
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS conversation_test_results (
        id                      SERIAL PRIMARY KEY,
        company_id              TEXT NOT NULL DEFAULT 'default',
        run_id                  INTEGER NOT NULL,
        test_case_id            INTEGER NOT NULL,
        status                  TEXT NOT NULL DEFAULT 'failed',
        actual_intent_code      TEXT,
        actual_intake_mode      TEXT,
        actual_task_created     BOOLEAN NOT NULL DEFAULT false,
        actual_mini_form_sent   BOOLEAN NOT NULL DEFAULT false,
        actual_admin_handoff    BOOLEAN NOT NULL DEFAULT false,
        actual_missing_fields   JSONB NOT NULL DEFAULT '[]',
        actual_reply            TEXT,
        actual_confidence_score TEXT,
        failure_reason          TEXT,
        duration_ms             INTEGER,
        created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS ai_production_mode TEXT NOT NULL DEFAULT 'off';
    `);

    console.log("✓ Tables and columns created");

    console.log("▶ Checking existing seed data...");
    const existing = await client.query(
      "SELECT COUNT(*) FROM conversation_test_cases WHERE company_id = 'default'",
    );
    if (parseInt(existing.rows[0].count, 10) >= 30) {
      console.log("✓ Seed data already exists. Skipping.");
      return;
    }

    console.log("▶ Seeding 30 test cases...");

    const cases = [
      {
        test_name: "Trucking - pesan singkat tanpa data",
        scenario_type: "normal",
        input_messages: ["Saya mau pengiriman trucking"],
        expected_intent_code: "trucking_inquiry",
        expected_intake_mode: "continue_collecting",
        expected_task_created: false,
        expected_mini_form_sent: false,
        expected_admin_handoff: false,
        expected_missing_fields: ["pickup_location", "destination", "cargo_type"],
        is_critical: true,
      },
      {
        test_name: "Trucking - data lengkap via WA",
        scenario_type: "complete",
        input_messages: [
          "Saya mau trucking dari Surabaya ke Jakarta, muatan beras 5 ton, tanggal 25 Juni 2026, pickup jam 08.00"
        ],
        expected_intent_code: "trucking_inquiry",
        expected_intake_mode: "ready_for_task",
        expected_task_created: true,
        expected_mini_form_sent: false,
        expected_admin_handoff: false,
        expected_missing_fields: [],
        is_critical: true,
      },
      {
        test_name: "Kasbon - pesan singkat",
        scenario_type: "normal",
        input_messages: ["Saya mau kasbon"],
        expected_intent_code: "kasbon_request",
        expected_intake_mode: "continue_collecting",
        expected_task_created: false,
        expected_mini_form_sent: false,
        expected_admin_handoff: false,
        expected_missing_fields: ["amount", "purpose"],
        is_critical: false,
      },
      {
        test_name: "Kasbon - data lengkap",
        scenario_type: "complete",
        input_messages: ["Kasbon 500 ribu untuk bensin hari ini transfer BCA"],
        expected_intent_code: "kasbon_request",
        expected_intake_mode: "ready_for_task",
        expected_task_created: true,
        expected_mini_form_sent: false,
        expected_admin_handoff: false,
        expected_missing_fields: [],
        is_critical: false,
      },
      {
        test_name: "Barang rusak - keluhan",
        scenario_type: "complaint",
        input_messages: ["Barang saya pecah"],
        expected_intent_code: "complaint",
        expected_intake_mode: "continue_collecting",
        expected_task_created: false,
        expected_mini_form_sent: false,
        expected_admin_handoff: false,
        expected_missing_fields: ["order_number", "photo"],
        is_critical: false,
      },
      {
        test_name: "Ban pecah - armada",
        scenario_type: "normal",
        input_messages: ["Ban mobil pecah"],
        expected_intent_code: "fleet_incident",
        expected_intake_mode: "continue_collecting",
        expected_task_created: false,
        expected_mini_form_sent: false,
        expected_admin_handoff: false,
        expected_missing_fields: ["plate_number", "location"],
        is_critical: false,
      },
      {
        test_name: "Import inquiry - pesan singkat",
        scenario_type: "normal",
        input_messages: ["Mau import mesin dari China"],
        expected_intent_code: "import_inquiry",
        expected_intake_mode: "continue_collecting",
        expected_task_created: false,
        expected_mini_form_sent: false,
        expected_admin_handoff: false,
        expected_missing_fields: ["hs_code", "gross_weight"],
        is_critical: true,
      },
      {
        test_name: "Export inquiry - pesan singkat",
        scenario_type: "normal",
        input_messages: ["Mau export barang ke Singapore"],
        expected_intent_code: "export_inquiry",
        expected_intake_mode: "continue_collecting",
        expected_task_created: false,
        expected_mini_form_sent: false,
        expected_admin_handoff: false,
        expected_missing_fields: ["commodity", "hs_code"],
        is_critical: false,
      },
      {
        test_name: "Request invoice tanpa nomor order",
        scenario_type: "normal",
        input_messages: ["Tolong kirim invoice"],
        expected_intent_code: "invoice_request",
        expected_intake_mode: "continue_collecting",
        expected_task_created: false,
        expected_mini_form_sent: false,
        expected_admin_handoff: false,
        expected_missing_fields: ["order_number"],
        is_critical: false,
      },
      {
        test_name: "Low confidence - pesan ambigu",
        scenario_type: "low_confidence",
        input_messages: ["Bisa bantu?"],
        expected_intent_code: "general_inquiry",
        expected_intake_mode: "continue_collecting",
        expected_task_created: false,
        expected_mini_form_sent: false,
        expected_admin_handoff: false,
        expected_missing_fields: [],
        is_critical: true,
      },
      {
        test_name: "Pembatalan - user bilang batal",
        scenario_type: "cancellation",
        input_messages: ["batal"],
        expected_intent_code: null,
        expected_intake_mode: "cancelled",
        expected_task_created: false,
        expected_mini_form_sent: false,
        expected_admin_handoff: false,
        expected_missing_fields: [],
        is_critical: true,
      },
      {
        test_name: "Pelanggan marah - barang rusak semua",
        scenario_type: "angry",
        input_messages: ["Saya kecewa, barang rusak semua! Ini sangat mengecewakan!"],
        expected_intent_code: "complaint",
        expected_intake_mode: "continue_collecting",
        expected_task_created: false,
        expected_mini_form_sent: false,
        expected_admin_handoff: true,
        expected_missing_fields: [],
        is_critical: true,
      },
      {
        test_name: "Barang berbahaya - bahan kimia DG",
        scenario_type: "dg_goods",
        input_messages: ["Mau kirim bahan kimia berbahaya, asam sulfat 200 liter"],
        expected_intent_code: "dg_shipment",
        expected_intake_mode: "continue_collecting",
        expected_task_created: false,
        expected_mini_form_sent: false,
        expected_admin_handoff: true,
        expected_missing_fields: [],
        is_critical: true,
      },
      {
        test_name: "Sengketa pembayaran",
        scenario_type: "finance",
        input_messages: ["Saya sudah bayar tapi masih ditagih"],
        expected_intent_code: "payment_dispute",
        expected_intake_mode: "continue_collecting",
        expected_task_created: false,
        expected_mini_form_sent: false,
        expected_admin_handoff: true,
        expected_missing_fields: [],
        is_critical: true,
      },
      {
        test_name: "Klaim BBM - armada",
        scenario_type: "normal",
        input_messages: ["Mau klaim bensin"],
        expected_intent_code: "fuel_claim",
        expected_intake_mode: "continue_collecting",
        expected_task_created: false,
        expected_mini_form_sent: false,
        expected_admin_handoff: false,
        expected_missing_fields: ["receipt_photo", "amount"],
        is_critical: false,
      },
      {
        test_name: "Trucking - cancel setelah mulai",
        scenario_type: "cancellation",
        input_messages: ["Saya mau trucking dari Jakarta", "ga jadi deh"],
        expected_intent_code: null,
        expected_intake_mode: "cancelled",
        expected_task_created: false,
        expected_mini_form_sent: false,
        expected_admin_handoff: false,
        expected_missing_fields: [],
        is_critical: false,
      },
      {
        test_name: "Import inquiry - data hampir lengkap",
        scenario_type: "normal",
        input_messages: [
          "Import mesin jahit dari Guangzhou China, 10 unit, berat 500kg, HS code 8452.10.00, via FCL"
        ],
        expected_intent_code: "import_inquiry",
        expected_intake_mode: "continue_collecting",
        expected_task_created: false,
        expected_mini_form_sent: false,
        expected_admin_handoff: false,
        expected_missing_fields: ["commercial_invoice"],
        is_critical: false,
      },
      {
        test_name: "Export - data lengkap",
        scenario_type: "complete",
        input_messages: [
          "Export kopi arabika 10 ton ke Singapore, HS 0901.21.00, pelabuhan Tanjung Priok, sudah ada sertifikat COO"
        ],
        expected_intent_code: "export_inquiry",
        expected_intake_mode: "ready_for_task",
        expected_task_created: true,
        expected_mini_form_sent: false,
        expected_admin_handoff: false,
        expected_missing_fields: [],
        is_critical: false,
      },
      {
        test_name: "Warehouse inquiry",
        scenario_type: "normal",
        input_messages: ["Saya perlu sewa gudang untuk 200 pallet barang elektronik"],
        expected_intent_code: "warehouse_inquiry",
        expected_intake_mode: "continue_collecting",
        expected_task_created: false,
        expected_mini_form_sent: false,
        expected_admin_handoff: false,
        expected_missing_fields: ["duration", "location"],
        is_critical: false,
      },
      {
        test_name: "Perlu quotasi pengiriman",
        scenario_type: "normal",
        input_messages: ["Berapa harga kirim 5 ton ke Surabaya?"],
        expected_intent_code: "quotation_request",
        expected_intake_mode: "continue_collecting",
        expected_task_created: false,
        expected_mini_form_sent: false,
        expected_admin_handoff: false,
        expected_missing_fields: ["cargo_type", "pickup_location"],
        is_critical: false,
      },
      {
        test_name: "Lacak pengiriman",
        scenario_type: "normal",
        input_messages: ["Dimana barang saya? No resi TRK-2024-001"],
        expected_intent_code: "shipment_tracking",
        expected_intake_mode: "continue_collecting",
        expected_task_created: false,
        expected_mini_form_sent: false,
        expected_admin_handoff: false,
        expected_missing_fields: [],
        is_critical: false,
      },
      {
        test_name: "Dokumen customs clearance",
        scenario_type: "normal",
        input_messages: ["Butuh jasa customs clearance untuk kontainer dari Jepang"],
        expected_intent_code: "customs_clearance",
        expected_intake_mode: "continue_collecting",
        expected_task_created: false,
        expected_mini_form_sent: false,
        expected_admin_handoff: false,
        expected_missing_fields: ["hs_code", "invoice"],
        is_critical: false,
      },
      {
        test_name: "Low confidence - hanya salam",
        scenario_type: "low_confidence",
        input_messages: ["Halo"],
        expected_intent_code: "general_inquiry",
        expected_intake_mode: "continue_collecting",
        expected_task_created: false,
        expected_mini_form_sent: false,
        expected_admin_handoff: false,
        expected_missing_fields: [],
        is_critical: false,
      },
      {
        test_name: "Permintaan refund",
        scenario_type: "finance",
        input_messages: ["Saya mau refund, pesanan dibatalkan tapi uang belum kembali"],
        expected_intent_code: "refund_request",
        expected_intake_mode: "continue_collecting",
        expected_task_created: false,
        expected_mini_form_sent: false,
        expected_admin_handoff: true,
        expected_missing_fields: ["order_number"],
        is_critical: false,
      },
      {
        test_name: "Pengiriman ekspres urgent",
        scenario_type: "normal",
        input_messages: ["Urgent! Saya butuh kirim dokumen ke Jakarta sekarang, hari ini juga"],
        expected_intent_code: "trucking_inquiry",
        expected_intake_mode: "continue_collecting",
        expected_task_created: false,
        expected_mini_form_sent: false,
        expected_admin_handoff: false,
        expected_missing_fields: ["pickup_location", "destination"],
        is_critical: false,
      },
      {
        test_name: "Cek status persetujuan kasbon",
        scenario_type: "normal",
        input_messages: ["Sudah diapprove belum kasbon saya?"],
        expected_intent_code: "kasbon_status",
        expected_intake_mode: "continue_collecting",
        expected_task_created: false,
        expected_mini_form_sent: false,
        expected_admin_handoff: false,
        expected_missing_fields: [],
        is_critical: false,
      },
      {
        test_name: "Barang hilang",
        scenario_type: "complaint",
        input_messages: ["Barang saya hilang, sudah 2 minggu tidak sampai"],
        expected_intent_code: "complaint",
        expected_intake_mode: "continue_collecting",
        expected_task_created: false,
        expected_mini_form_sent: false,
        expected_admin_handoff: true,
        expected_missing_fields: ["order_number"],
        is_critical: true,
      },
      {
        test_name: "Pertanyaan harga umum",
        scenario_type: "low_confidence",
        input_messages: ["Ada promo?"],
        expected_intent_code: "general_inquiry",
        expected_intake_mode: "continue_collecting",
        expected_task_created: false,
        expected_mini_form_sent: false,
        expected_admin_handoff: false,
        expected_missing_fields: [],
        is_critical: false,
      },
      {
        test_name: "Perlu sopir tambahan - SDM",
        scenario_type: "normal",
        input_messages: ["Saya butuh driver pengganti, driver saya sakit hari ini"],
        expected_intent_code: "driver_request",
        expected_intake_mode: "continue_collecting",
        expected_task_created: false,
        expected_mini_form_sent: false,
        expected_admin_handoff: true,
        expected_missing_fields: ["plate_number", "route"],
        is_critical: false,
      },
      {
        test_name: "Bahan kimia - pupuk urea bulk",
        scenario_type: "dg_goods",
        input_messages: ["Kirim pupuk urea 50 ton, apakah bisa?"],
        expected_intent_code: "trucking_inquiry",
        expected_intake_mode: "continue_collecting",
        expected_task_created: false,
        expected_mini_form_sent: false,
        expected_admin_handoff: true,
        expected_missing_fields: ["msds_document"],
        is_critical: false,
      },
    ];

    for (const tc of cases) {
      await client.query(
        `INSERT INTO conversation_test_cases
          (company_id, test_name, scenario_type, input_messages, expected_intent_code,
           expected_intake_mode, expected_task_created, expected_mini_form_sent,
           expected_admin_handoff, expected_missing_fields, is_critical, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          "default",
          tc.test_name,
          tc.scenario_type,
          JSON.stringify(tc.input_messages),
          tc.expected_intent_code,
          tc.expected_intake_mode,
          tc.expected_task_created,
          tc.expected_mini_form_sent,
          tc.expected_admin_handoff,
          JSON.stringify(tc.expected_missing_fields),
          tc.is_critical,
          true,
        ],
      );
    }

    console.log(`✓ Seeded ${cases.length} test cases`);
    console.log("✅ Sprint 9D migration complete");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("❌ Migration failed:", err.message);
  process.exit(1);
});
