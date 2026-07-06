/**
 * Production Supabase Migration + KB Seed
 * Creates all required tables and seeds KB data to the production Supabase.
 *
 * Run: node scripts/migrate-prod-supabase.mjs
 *
 * Uses SUPABASE_DATABASE_URL (production). ssl: false because the Supabase
 * PgBouncer pooler at port 6543 does not support client-side SSL.
 */

import pkg from "pg";
const { Pool } = pkg;

const CONN = process.env.SUPABASE_DATABASE_URL;
if (!CONN) {
  console.error("❌ SUPABASE_DATABASE_URL is not set.");
  process.exit(1);
}

const pool = new Pool({ connectionString: CONN, ssl: false });
const COMPANY = "default";

// ── Step 1: Create core KB tables ─────────────────────────────────────────────

async function createTables() {
  console.log("🏗️  Creating tables if not exist...");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS intent_master (
      id              SERIAL PRIMARY KEY,
      company_id      TEXT NOT NULL DEFAULT 'default',
      intent_code     TEXT NOT NULL,
      intent_name     TEXT NOT NULL,
      category        TEXT,
      description     TEXT,
      suggested_category  TEXT,
      suggested_division  TEXT,
      suggested_priority  TEXT DEFAULT 'medium',
      sla_hours       INTEGER,
      is_active       BOOLEAN NOT NULL DEFAULT true,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS intent_master_company_idx ON intent_master(company_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS intent_master_code_idx ON intent_master(intent_code)`);
  console.log("  ✅ intent_master");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS keyword_rules (
      id          SERIAL PRIMARY KEY,
      company_id  TEXT NOT NULL DEFAULT 'default',
      keyword     TEXT NOT NULL,
      intent_code TEXT NOT NULL,
      weight      REAL NOT NULL DEFAULT 1.0,
      is_active   BOOLEAN NOT NULL DEFAULT true,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS keyword_rules_company_idx ON keyword_rules(company_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS keyword_rules_intent_idx ON keyword_rules(intent_code)`);
  console.log("  ✅ keyword_rules");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS data_templates (
      id              SERIAL PRIMARY KEY,
      company_id      TEXT NOT NULL DEFAULT 'default',
      intent_code     TEXT,
      name            TEXT NOT NULL,
      category        TEXT,
      description     TEXT,
      is_active       BOOLEAN NOT NULL DEFAULT true,
      use_mini_form   BOOLEAN NOT NULL DEFAULT false,
      mini_form_type  TEXT,
      mini_form_route TEXT,
      intake_mode     TEXT NOT NULL DEFAULT 'conversation',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS data_templates_company_idx ON data_templates(company_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS data_templates_intent_idx ON data_templates(intent_code)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS data_templates_category_idx ON data_templates(category)`);
  console.log("  ✅ data_templates");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS data_template_fields (
      id          SERIAL PRIMARY KEY,
      template_id INTEGER NOT NULL,
      field_name  TEXT NOT NULL,
      field_label TEXT NOT NULL,
      field_type  TEXT NOT NULL DEFAULT 'text',
      is_required BOOLEAN NOT NULL DEFAULT true,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      help_text   TEXT,
      sample_value TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS data_template_fields_template_idx ON data_template_fields(template_id)`);
  console.log("  ✅ data_template_fields");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS document_templates (
      id          SERIAL PRIMARY KEY,
      company_id  TEXT NOT NULL DEFAULT 'default',
      intent_code TEXT,
      name        TEXT NOT NULL,
      category    TEXT,
      description TEXT,
      is_active   BOOLEAN NOT NULL DEFAULT true,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS document_templates_company_idx ON document_templates(company_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS document_templates_intent_idx ON document_templates(intent_code)`);
  console.log("  ✅ document_templates");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS document_template_fields (
      id                    SERIAL PRIMARY KEY,
      template_id           INTEGER NOT NULL,
      document_name         TEXT NOT NULL,
      document_type         TEXT,
      is_required           BOOLEAN NOT NULL DEFAULT true,
      description           TEXT,
      sort_order            INTEGER NOT NULL DEFAULT 0,
      example_file_description TEXT,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS document_template_fields_template_idx ON document_template_fields(template_id)`);
  console.log("  ✅ document_template_fields");

  // Also ensure intake_sessions table exists (needed for WA flow)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS conversation_intake_sessions (
      id               SERIAL PRIMARY KEY,
      phone            TEXT NOT NULL,
      company_id       TEXT NOT NULL DEFAULT 'default',
      intent_code      TEXT NOT NULL,
      intent_name      TEXT,
      category         TEXT,
      status           TEXT NOT NULL DEFAULT 'collecting',
      mini_form_type   TEXT,
      required_fields  JSONB NOT NULL DEFAULT '[]',
      collected_fields JSONB NOT NULL DEFAULT '{}',
      missing_fields   JSONB NOT NULL DEFAULT '[]',
      required_documents JSONB NOT NULL DEFAULT '[]',
      uploaded_documents JSONB NOT NULL DEFAULT '[]',
      completion_pct   TEXT NOT NULL DEFAULT '0',
      needs_admin_review BOOLEAN NOT NULL DEFAULT false,
      last_message     TEXT,
      last_question    TEXT,
      last_message_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at       TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log("  ✅ conversation_intake_sessions");
}

// ── Step 2: Seed intent_master ─────────────────────────────────────────────────

const INTENTS = [
  { code: "sport_center_booking",         name: "Booking Lapangan Olahraga",         category: "Sport Center", div: "Sport Center", priority: "medium", sla: 2 },
  { code: "sport_center_cancel",          name: "Pembatalan Booking Lapangan",        category: "Sport Center", div: "Sport Center", priority: "high",   sla: 1 },
  { code: "sport_center_inquiry",         name: "Informasi Lapangan & Jadwal",        category: "Sport Center", div: "Sport Center", priority: "low",    sla: 4 },
  { code: "daftar_membership",            name: "Pendaftaran Membership",             category: "Sport Center", div: "Sport Center", priority: "medium", sla: 4 },
  { code: "perpanjang_membership",        name: "Perpanjangan Membership",            category: "Sport Center", div: "Sport Center", priority: "medium", sla: 4 },
  { code: "konfirmasi_pembayaran_sport",  name: "Konfirmasi Pembayaran Lapangan",     category: "Sport Center", div: "Finance",      priority: "medium", sla: 2 },
  { code: "laporan_masalah_sport",        name: "Laporan Masalah Fasilitas",          category: "Sport Center", div: "Operations",   priority: "high",   sla: 2 },
  { code: "permintaan_penawaran",         name: "Permintaan Penawaran Harga",         category: "Logistik",    div: "Sales",        priority: "medium", sla: 4 },
  { code: "cek_status_pengiriman",        name: "Cek Status Pengiriman",              category: "Logistik",    div: "Operations",   priority: "medium", sla: 2 },
  { code: "trucking_inquiry",             name: "Permintaan Trucking / Angkutan",     category: "Logistik",    div: "Trucking",     priority: "medium", sla: 4 },
  { code: "air_freight_inquiry",          name: "Permintaan Air Freight",             category: "Logistik",    div: "Air Freight",  priority: "medium", sla: 4 },
  { code: "sea_freight_inquiry",          name: "Permintaan Sea Freight",             category: "Logistik",    div: "Sea Freight",  priority: "medium", sla: 8 },
  { code: "import_inquiry",              name: "Permintaan Import",                  category: "Logistik",    div: "Import",       priority: "medium", sla: 8 },
  { code: "export_inquiry",              name: "Permintaan Export",                  category: "Logistik",    div: "Export",       priority: "medium", sla: 8 },
  { code: "customs_clearance",           name: "Customs Clearance / Bea Cukai",      category: "Customs",     div: "Customs",      priority: "high",   sla: 4 },
  { code: "damaged_goods_complaint",     name: "Komplain Barang Rusak",              category: "Logistik",    div: "Operations",   priority: "high",   sla: 2 },
  { code: "delivery_delay_complaint",    name: "Komplain Keterlambatan Pengiriman",  category: "Logistik",    div: "Operations",   priority: "high",   sla: 2 },
  { code: "permintaan_kasbon",           name: "Permintaan Kasbon / Cash Advance",   category: "Finance",     div: "Finance",      priority: "medium", sla: 8 },
  { code: "permintaan_vendor",           name: "Permintaan / Registrasi Vendor",     category: "Logistik",    div: "Procurement",  priority: "low",    sla: 24 },
  { code: "fleet_repair",               name: "Perbaikan / Service Kendaraan",      category: "Fleet",       div: "Fleet",        priority: "high",   sla: 4 },
  { code: "fuel_expense",               name: "Klaim BBM / Bahan Bakar",            category: "Fleet",       div: "Fleet",        priority: "medium", sla: 8 },
  { code: "tire_issue",                 name: "Masalah Ban Kendaraan",              category: "Fleet",       div: "Fleet",        priority: "high",   sla: 2 },
  { code: "daftar_tenant",              name: "Pendaftaran Tenant / Kios Baru",     category: "Tenant",      div: "Tenant",       priority: "medium", sla: 8 },
  { code: "info_sewa_tenant",           name: "Informasi Sewa Kios / Tenant",       category: "Tenant",      div: "Tenant",       priority: "low",    sla: 8 },
  { code: "konfirmasi_pembayaran_tenant",name: "Konfirmasi Pembayaran Sewa",        category: "Tenant",      div: "Finance",      priority: "medium", sla: 4 },
  { code: "laporan_masalah_tenant",     name: "Laporan Masalah Tenant",             category: "Tenant",      div: "Operations",   priority: "high",   sla: 4 },
  { code: "perpanjang_kontrak_tenant",  name: "Perpanjangan Kontrak Sewa",          category: "Tenant",      div: "Tenant",       priority: "medium", sla: 24 },
  { code: "konfirmasi_pembayaran",      name: "Konfirmasi Pembayaran",              category: "Finance",     div: "Finance",      priority: "medium", sla: 4 },
  { code: "pertanyaan_tagihan",         name: "Pertanyaan Tagihan / Invoice",       category: "Finance",     div: "Finance",      priority: "medium", sla: 8 },
  { code: "general_inquiry",            name: "Pertanyaan Umum",                    category: "Umum",        div: null,           priority: "low",    sla: 24 },
  { code: "booking_lapangan",           name: "Booking Lapangan (alias)",           category: "Sport Center",div: "Sport Center", priority: "medium", sla: 2 },
];

async function seedIntents() {
  console.log("\n📋 Seeding intent_master...");
  for (const i of INTENTS) {
    await pool.query(`DELETE FROM intent_master WHERE company_id=$1 AND intent_code=$2`, [COMPANY, i.code]);
    await pool.query(
      `INSERT INTO intent_master (company_id,intent_code,intent_name,category,suggested_category,suggested_division,suggested_priority,sla_hours,is_active,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,NOW(),NOW())`,
      [COMPANY, i.code, i.name, i.category, i.category, i.div, i.priority, i.sla]
    );
    process.stdout.write(`  ✅ ${i.code}\n`);
  }
}

// ── Step 3: Seed data_templates (sport center booking) ────────────────────────

const TEMPLATES = [
  {
    code: "sport_center_booking",
    name: "Form Booking Lapangan",
    category: "Sport Center",
    intakeMode: "conversation",
    useMiniForm: true,
    miniFormType: "field-booking",
    fields: [
      { name: "field_type",    label: "Jenis Lapangan",   type: "text",   req: true,  sort: 1,  help: "Futsal, Badminton, Tennis, dll" },
      { name: "booking_date",  label: "Tanggal Main",     type: "date",   req: true,  sort: 2,  help: "Tanggal booking" },
      { name: "start_time",    label: "Jam Mulai",        type: "text",   req: true,  sort: 3,  help: "Contoh: 10:00" },
      { name: "duration",      label: "Durasi Sewa",      type: "text",   req: false, sort: 4,  help: "1 jam, 2 jam, dst" },
      { name: "end_time",      label: "Jam Selesai",      type: "text",   req: false, sort: 5,  help: "Dihitung otomatis dari durasi" },
      { name: "booker_name",   label: "Nama Pemesan",     type: "text",   req: true,  sort: 6,  help: "Nama lengkap pemesan" },
      { name: "phone",         label: "No. HP / WhatsApp",type: "text",   req: false, sort: 7,  help: "Nomor yang bisa dihubungi" },
      { name: "payment_method",label: "Metode Pembayaran",type: "text",   req: false, sort: 8,  help: "Transfer, Cash, QRIS" },
    ],
  },
  {
    code: "booking_lapangan",
    name: "Form Booking Lapangan (alias)",
    category: "Sport Center",
    intakeMode: "conversation",
    useMiniForm: true,
    miniFormType: "field-booking",
    fields: [
      { name: "field_type",    label: "Jenis Lapangan",   type: "text",   req: true,  sort: 1  },
      { name: "booking_date",  label: "Tanggal Main",     type: "date",   req: true,  sort: 2  },
      { name: "start_time",    label: "Jam Mulai",        type: "text",   req: true,  sort: 3  },
      { name: "duration",      label: "Durasi Sewa",      type: "text",   req: false, sort: 4  },
      { name: "end_time",      label: "Jam Selesai",      type: "text",   req: false, sort: 5  },
      { name: "booker_name",   label: "Nama Pemesan",     type: "text",   req: true,  sort: 6  },
      { name: "phone",         label: "No. HP",           type: "text",   req: false, sort: 7  },
    ],
  },
  {
    code: "permintaan_kasbon",
    name: "Form Pengajuan Kasbon",
    category: "Finance",
    intakeMode: "conversation",
    useMiniForm: true,
    miniFormType: "cash-advance",
    fields: [
      { name: "amount",        label: "Jumlah Kasbon",    type: "number", req: true,  sort: 1, help: "Jumlah dalam rupiah" },
      { name: "purpose",       label: "Keperluan",        type: "text",   req: true,  sort: 2, help: "Untuk apa kasbon ini?" },
      { name: "needed_date",   label: "Tanggal Dibutuhkan",type:"date",   req: true,  sort: 3 },
      { name: "notes",         label: "Catatan Tambahan", type: "text",   req: false, sort: 4 },
    ],
  },
  {
    code: "trucking_inquiry",
    name: "Form Permintaan Trucking",
    category: "Logistik",
    intakeMode: "conversation",
    useMiniForm: true,
    miniFormType: "trucking",
    fields: [
      { name: "pickup_address",  label: "Alamat Pickup",      type: "text", req: true,  sort: 1 },
      { name: "delivery_address",label: "Alamat Tujuan",      type: "text", req: true,  sort: 2 },
      { name: "cargo_type",      label: "Jenis Muatan",       type: "text", req: true,  sort: 3 },
      { name: "cargo_weight",    label: "Berat Muatan (kg)",  type: "text", req: false, sort: 4 },
      { name: "vehicle_type",    label: "Jenis Kendaraan",    type: "text", req: false, sort: 5 },
      { name: "pickup_date",     label: "Tanggal Pickup",     type: "date", req: true,  sort: 6 },
      { name: "contact_person",  label: "Nama Kontak",        type: "text", req: true,  sort: 7 },
      { name: "phone",           label: "No. HP",             type: "text", req: false, sort: 8 },
      { name: "notes",           label: "Catatan",            type: "text", req: false, sort: 9 },
    ],
  },
  {
    code: "damaged_goods_complaint",
    name: "Form Komplain Barang Rusak",
    category: "Logistik",
    intakeMode: "conversation",
    useMiniForm: true,
    miniFormType: "complaint",
    fields: [
      { name: "description", label: "Deskripsi Masalah",  type: "text", req: true,  sort: 1 },
      { name: "notes",       label: "Catatan Tambahan",   type: "text", req: false, sort: 2 },
    ],
  },
  {
    code: "fleet_repair",
    name: "Form Permintaan Perbaikan Armada",
    category: "Fleet",
    intakeMode: "conversation",
    useMiniForm: true,
    miniFormType: "fleet-repair",
    fields: [
      { name: "plate_number",  label: "Nomor Plat",        type: "text", req: true,  sort: 1 },
      { name: "description",   label: "Kerusakan / Keluhan",type: "text",req: true,  sort: 2 },
      { name: "needed_date",   label: "Tanggal Dibutuhkan", type: "date",req: false, sort: 3 },
      { name: "notes",         label: "Catatan",            type: "text",req: false, sort: 4 },
    ],
  },
];

async function seedTemplates() {
  console.log("\n📝 Seeding data_templates + fields...");
  let tCount = 0, fCount = 0;
  for (const t of TEMPLATES) {
    const existing = await pool.query(
      `SELECT id FROM data_templates WHERE company_id=$1 AND intent_code=$2`,
      [COMPANY, t.code]
    );
    if (existing.rows.length > 0) {
      const tid = existing.rows[0].id;
      await pool.query(`DELETE FROM data_template_fields WHERE template_id=$1`, [tid]);
      await pool.query(`DELETE FROM data_templates WHERE id=$1`, [tid]);
    }
    const { rows } = await pool.query(
      `INSERT INTO data_templates (company_id,intent_code,name,category,description,is_active,use_mini_form,mini_form_type,intake_mode,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,true,$6,$7,$8,NOW(),NOW()) RETURNING id`,
      [COMPANY, t.code, t.name, t.category, `Template untuk ${t.code}`, t.useMiniForm ?? false, t.miniFormType ?? null, t.intakeMode ?? "conversation"]
    );
    const tid = rows[0].id;
    tCount++;
    for (const f of t.fields) {
      await pool.query(
        `INSERT INTO data_template_fields (template_id,field_name,field_label,field_type,is_required,sort_order,help_text,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
        [tid, f.name, f.label, f.type, f.req, f.sort, f.help ?? null]
      );
      fCount++;
    }
    console.log(`  ✅ [${t.category}] ${t.code} — ${t.fields.length} fields`);
  }
  console.log(`  → ${tCount} templates, ${fCount} fields seeded.`);
}

// ── RUN ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🚀 Production Supabase Migration + Seed");
  console.log(`   DB: ${CONN.replace(/:([^:@]+)@/, ":***@")}`);
  try {
    await createTables();
    await seedIntents();
    await seedTemplates();

    const [r1, r2, r3] = await Promise.all([
      pool.query("SELECT COUNT(*) as cnt FROM intent_master WHERE company_id=$1", [COMPANY]),
      pool.query("SELECT COUNT(*) as cnt FROM data_templates WHERE company_id=$1", [COMPANY]),
      pool.query("SELECT COUNT(*) as cnt FROM data_template_fields dtf JOIN data_templates dt ON dt.id=dtf.template_id WHERE dt.company_id=$1", [COMPANY]),
    ]);
    console.log("\n✅ DONE — Production Supabase stats:");
    console.log(`   Intent aktif    : ${r1.rows[0].cnt}`);
    console.log(`   Data templates  : ${r2.rows[0].cnt}`);
    console.log(`   Template fields : ${r3.rows[0].cnt}`);
  } catch (err) {
    console.error("❌ Error:", err.message, err.detail ?? "");
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
