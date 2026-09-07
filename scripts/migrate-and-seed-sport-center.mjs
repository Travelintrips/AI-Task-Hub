/**
 * Migrate + Seed sport center ke Supabase (DEV atau PROD)
 * Membuat tabel yang hilang dan mengisi data KB sport center.
 *
 * Run: node scripts/migrate-and-seed-sport-center.mjs
 */

import pg from "pg";
const { Pool } = pg;

// Prioritas: PROD > DEV > local
const RAW_URL =
  process.env.SUPABASE_DATABASE_URL ||
  process.env.SUPABASE_DATABASE_URL_DEV ||
  process.env.DATABASE_URL;

if (!RAW_URL) {
  console.error("ERROR: Tidak ada DATABASE URL yang ditemukan.");
  process.exit(1);
}

// Ganti port pooler 6543 → 5432 (Session mode, wajib untuk DDL)
const connStr = RAW_URL.replace(/:6543\//g, ":5432/").replace(/:6543\?/g, ":5432?");
const isSupabase = connStr.includes("supabase.co");

const pool = new Pool({
  connectionString: connStr,
  ssl: isSupabase ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 10000,
});

const label = process.env.SUPABASE_DATABASE_URL
  ? "SUPABASE_DATABASE_URL (production)"
  : process.env.SUPABASE_DATABASE_URL_DEV
  ? "SUPABASE_DATABASE_URL_DEV (development)"
  : "DATABASE_URL (local)";

console.log(`\n📡 Connecting via: ${label}`);
console.log(`   Host: ${connStr.replace(/:[^:@]*@/, ":***@").substring(0, 80)}\n`);

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ── STEP 1: Create tables if not exist ──────────────────────────────────────
    console.log("[1/5] Creating tables if not exist ...");

    await client.query(`
      CREATE TABLE IF NOT EXISTS intent_master (
        id               SERIAL PRIMARY KEY,
        company_id       TEXT NOT NULL DEFAULT 'default',
        intent_code      TEXT NOT NULL,
        intent_name      TEXT NOT NULL,
        category         TEXT,
        description      TEXT,
        suggested_category  TEXT,
        suggested_division  TEXT,
        suggested_priority  TEXT DEFAULT 'medium',
        sla_hours        INTEGER,
        is_active        BOOLEAN NOT NULL DEFAULT TRUE,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS keyword_rules (
        id          SERIAL PRIMARY KEY,
        company_id  TEXT NOT NULL DEFAULT 'default',
        intent_code TEXT NOT NULL,
        keyword     TEXT NOT NULL,
        weight      NUMERIC(5,2) NOT NULL DEFAULT 1.0,
        is_active   BOOLEAN NOT NULL DEFAULT TRUE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS data_templates (
        id              SERIAL PRIMARY KEY,
        company_id      TEXT NOT NULL DEFAULT 'default',
        intent_code     TEXT,
        name            TEXT NOT NULL,
        category        TEXT,
        description     TEXT,
        is_active       BOOLEAN NOT NULL DEFAULT TRUE,
        use_mini_form   BOOLEAN NOT NULL DEFAULT FALSE,
        mini_form_type  TEXT,
        mini_form_route TEXT,
        intake_mode     TEXT NOT NULL DEFAULT 'conversation',
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS data_template_fields (
        id           SERIAL PRIMARY KEY,
        template_id  INTEGER NOT NULL,
        field_name   TEXT NOT NULL,
        field_label  TEXT NOT NULL,
        field_type   TEXT NOT NULL DEFAULT 'text',
        is_required  BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order   INTEGER NOT NULL DEFAULT 0,
        help_text    TEXT,
        sample_value TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    console.log("   ✓ Tables OK");

    // ── STEP 2: Seed intent_master ────────────────────────────────────────────
    console.log("[2/5] Seeding intent_master ...");
    const intents = [
      { code: "sport_center_booking", name: "Booking Lapangan Olahraga",   cat: "Sport Center", div: "Sport Center", priority: "medium", sla: 2 },
      { code: "sport_center_inquiry", name: "Informasi Lapangan & Jadwal", cat: "Sport Center", div: "Sport Center", priority: "low",    sla: 4 },
      { code: "sport_center_cancel",  name: "Pembatalan Booking Lapangan", cat: "Sport Center", div: "Sport Center", priority: "high",   sla: 1 },
    ];
    for (const i of intents) {
      await client.query(`DELETE FROM intent_master WHERE intent_code = $1 AND company_id = 'default'`, [i.code]);
      await client.query(
        `INSERT INTO intent_master (company_id, intent_code, intent_name, category, suggested_category, suggested_division, suggested_priority, sla_hours, is_active)
         VALUES ('default', $1, $2, $3, $3, $4, $5, $6, true)`,
        [i.code, i.name, i.cat, i.div, i.priority, i.sla],
      );
    }
    console.log(`   ✓ ${intents.length} intents`);

    // ── STEP 3: Seed keyword_rules ────────────────────────────────────────────
    console.log("[3/5] Seeding keyword_rules ...");
    await client.query(`DELETE FROM keyword_rules WHERE intent_code IN ('sport_center_booking','sport_center_inquiry','sport_center_cancel') AND company_id = 'default'`);

    const bookingKws = [
      ["pesan lapangan", 2.0], ["booking lapangan", 2.0], ["reservasi lapangan", 2.0],
      ["sewa lapangan", 2.0], ["ingin pesan lapangan", 2.0], ["mau pesan lapangan", 2.0],
      ["ingin booking", 1.8], ["mau booking", 1.8], ["bisa pesan", 1.5], ["bisa booking", 1.5],
      ["lapangan futsal", 2.0], ["lapangan badminton", 2.0], ["lapangan bola", 2.0],
      ["lapangan basket", 2.0], ["lapangan tenis", 2.0], ["lapangan voli", 2.0],
      ["lapangan mini soccer", 2.0], ["lapangan sepak bola", 2.0], ["lapangan bulutangkis", 2.0],
      ["futsal", 1.5], ["badminton", 1.5], ["basket", 1.5], ["tenis", 1.5], ["voli", 1.5],
      ["jadwal lapangan", 1.8], ["slot lapangan", 1.8], ["tersedia jam", 1.5], ["ada jadwal", 1.3],
      ["sport center", 1.8], ["lapangan olahraga", 2.0], ["olahraga", 0.8],
      ["main futsal", 2.0], ["main badminton", 2.0], ["main basket", 2.0],
      ["main bola", 2.0], ["main voli", 2.0], ["mau main", 1.5], ["ingin main", 1.5],
      ["nge-futsal", 2.0], ["ngefutsal", 2.0], ["nge futsal", 2.0], ["futsal dong", 2.0],
      ["konfirmasi booking", 2.0], ["lanjutkan booking", 2.0],
      ["bayar lapangan", 1.8], ["dp lapangan", 1.8],
      ["pesan untuk besok", 1.5], ["berapa harga lapangan", 1.5],
      ["harga sewa lapangan", 1.5], ["tarif lapangan", 1.5], ["biaya lapangan", 1.5],
      ["jam berapa", 1.0], ["malam ini", 1.0], ["hari ini", 1.0],
    ];
    for (const [kw, w] of bookingKws) {
      await client.query(
        `INSERT INTO keyword_rules (company_id, intent_code, keyword, weight, is_active) VALUES ('default', 'sport_center_booking', $1, $2, true)`,
        [kw, w],
      );
    }

    const inquiryKws = [["info lapangan", 1.5], ["informasi lapangan", 1.5], ["jadwal tersedia", 1.5], ["lapangan kosong", 1.5], ["cek jadwal", 1.5]];
    for (const [kw, w] of inquiryKws) {
      await client.query(
        `INSERT INTO keyword_rules (company_id, intent_code, keyword, weight, is_active) VALUES ('default', 'sport_center_inquiry', $1, $2, true)`,
        [kw, w],
      );
    }

    const cancelKws = [["batal booking", 2.0], ["cancel lapangan", 2.0], ["tidak jadi", 1.5], ["batalkan pesanan", 2.0]];
    for (const [kw, w] of cancelKws) {
      await client.query(
        `INSERT INTO keyword_rules (company_id, intent_code, keyword, weight, is_active) VALUES ('default', 'sport_center_cancel', $1, $2, true)`,
        [kw, w],
      );
    }
    console.log(`   ✓ ${bookingKws.length + inquiryKws.length + cancelKws.length} keywords`);

    // ── STEP 4: Seed data_templates ───────────────────────────────────────────
    console.log("[4/5] Seeding data_templates ...");
    await client.query(`DELETE FROM data_templates WHERE intent_code IN ('sport_center_booking','sport_center_inquiry') AND company_id = 'default'`);

    const { rows: [tpl] } = await client.query(
      `INSERT INTO data_templates (company_id, intent_code, name, category, description, is_active, use_mini_form, mini_form_type, mini_form_route, intake_mode)
       VALUES ('default', 'sport_center_booking', 'Booking Lapangan Olahraga', 'Sport Center',
               'Form pemesanan lapangan olahraga', true, true, 'field-booking', '/mini-form/field-booking', 'mini_form')
       RETURNING id`,
    );
    await client.query(
      `INSERT INTO data_templates (company_id, intent_code, name, category, description, is_active, use_mini_form, intake_mode)
       VALUES ('default', 'sport_center_inquiry', 'Informasi Lapangan', 'Sport Center',
               'Pertanyaan info jadwal dan fasilitas', true, false, 'conversation')`,
    );
    console.log(`   ✓ 2 templates (booking template_id=${tpl.id})`);

    // ── STEP 5: Seed data_template_fields ────────────────────────────────────
    console.log("[5/5] Seeding data_template_fields ...");
    await client.query(`DELETE FROM data_template_fields WHERE template_id = $1`, [tpl.id]);

    const fields = [
      ["nama_pemesan",     "Nama Pemesan",       "text",     true,  1, "",                                        "Budi Santoso"],
      ["no_hp",            "Nomor HP/WA",         "phone",    true,  2, "",                                        "08123456789"],
      ["jenis_lapangan",   "Jenis Lapangan",      "select",   true,  3, "Futsal, Badminton, Basket, Tenis, Voli",  "Futsal"],
      ["tanggal_booking",  "Tanggal Booking",     "date",     true,  4, "",                                        "2024-12-25"],
      ["jam_booking",      "Jam Mulai",           "time",     true,  5, "",                                        "09:00"],
      ["durasi",           "Durasi (Jam)",        "number",   true,  6, "",                                        "2"],
      ["metode_pembayaran","Metode Pembayaran",   "select",   true,  7, "Transfer Bank, Cash, QRIS",               "Transfer Bank"],
      ["catatan",          "Catatan Tambahan",    "textarea", false, 8, "",                                        ""],
    ];
    for (const [fname, flabel, ftype, req, sort, help, sample] of fields) {
      await client.query(
        `INSERT INTO data_template_fields (template_id, field_name, field_label, field_type, is_required, sort_order, help_text, sample_value)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [tpl.id, fname, flabel, ftype, req, sort, help, sample],
      );
    }
    console.log(`   ✓ ${fields.length} fields`);

    await client.query("COMMIT");

    // ── Verifikasi ─────────────────────────────────────────────────────────────
    const { rows: counts } = await client.query(`
      SELECT
        (SELECT count(*) FROM intent_master  WHERE company_id='default') AS intents,
        (SELECT count(*) FROM keyword_rules  WHERE company_id='default') AS keywords,
        (SELECT count(*) FROM data_templates WHERE company_id='default') AS templates,
        (SELECT count(*) FROM data_template_fields WHERE template_id=$1) AS fields
    `, [tpl.id]);

    console.log("\n✅ SELESAI — Verifikasi:");
    console.log(`   intent_master   : ${counts[0].intents} rows`);
    console.log(`   keyword_rules   : ${counts[0].keywords} rows`);
    console.log(`   data_templates  : ${counts[0].templates} rows`);
    console.log(`   template_fields : ${counts[0].fields} rows`);
    console.log("\n📌 Kirim pesan WA 'pesan lapangan futsal' untuk test mini form.\n");

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ ERROR:", err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
