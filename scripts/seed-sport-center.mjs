/**
 * Seed sport center booking intent ke Supabase DB
 * Menambahkan: intent_master, keyword_rules, data_templates, data_template_fields
 *
 * Run: node scripts/seed-sport-center.mjs
 */

import pg from "pg";

const { Pool } = pg;

const PROD_URL  = process.env.SUPABASE_DATABASE_URL;
const DEV_URL   = process.env.SUPABASE_DATABASE_URL_DEV;
const LOCAL_URL = process.env.DATABASE_URL;

const connStr = PROD_URL || DEV_URL || LOCAL_URL;
if (!connStr) {
  console.error("ERROR: No database URL found. Set SUPABASE_DATABASE_URL or DATABASE_URL.");
  process.exit(1);
}

// Use port 5432 (Session mode) instead of 6543 (Transaction mode) for Supabase
const safeUrl = connStr
  .replace(":6543/", ":5432/")
  .replace(":6543?", ":5432?");

const isSupabase = safeUrl.includes("supabase.co");
const pool = new Pool({
  connectionString: safeUrl,
  ssl: isSupabase ? { rejectUnauthorized: false } : false,
});

console.log(`\n📡 Connecting to: ${isSupabase ? "Supabase" : "Local"} DB`);
if (PROD_URL)      console.log("   → Using SUPABASE_DATABASE_URL (production)");
else if (DEV_URL)  console.log("   → Using SUPABASE_DATABASE_URL_DEV (development)");
else               console.log("   → Using DATABASE_URL (local)");

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ── 1. intent_master ───────────────────────────────────────────────────────
    console.log("\n[1/4] Seeding intent_master ...");

    const intents = [
      {
        code: "sport_center_booking",
        name: "Pemesanan Lapangan Olahraga",
        category: "Sport Center",
        description: "Customer ingin memesan/menyewa lapangan olahraga (futsal, badminton, basket, tenis, voli, sepak bola)",
        division: "Sport Center",
        priority: "medium",
        sla_hours: 2,
      },
      {
        code: "sport_center_inquiry",
        name: "Informasi Lapangan Olahraga",
        category: "Sport Center",
        description: "Customer bertanya tentang harga, jadwal, atau ketersediaan lapangan",
        division: "Sport Center",
        priority: "low",
        sla_hours: 4,
      },
      {
        code: "sport_center_cancel",
        name: "Pembatalan Booking Lapangan",
        category: "Sport Center",
        description: "Customer ingin membatalkan atau mengubah booking lapangan",
        division: "Sport Center",
        priority: "medium",
        sla_hours: 2,
      },
    ];

    for (const intent of intents) {
      const existing = await client.query(
        "SELECT id FROM intent_master WHERE intent_code = $1 AND company_id = 'default'",
        [intent.code],
      );
      if (existing.rows.length > 0) {
        await client.query(
          `UPDATE intent_master SET
            intent_name=$1, category=$2, description=$3,
            suggested_division=$4, suggested_priority=$5, sla_hours=$6,
            is_active=true, updated_at=NOW()
           WHERE intent_code=$7 AND company_id='default'`,
          [intent.name, intent.category, intent.description, intent.division, intent.priority, intent.sla_hours, intent.code],
        );
        console.log(`   ✅ Updated: ${intent.code}`);
      } else {
        await client.query(
          `INSERT INTO intent_master
            (company_id, intent_code, intent_name, category, description,
             suggested_division, suggested_priority, sla_hours, is_active)
           VALUES ('default',$1,$2,$3,$4,$5,$6,$7,true)`,
          [intent.code, intent.name, intent.category, intent.description, intent.division, intent.priority, intent.sla_hours],
        );
        console.log(`   ✅ Inserted: ${intent.code}`);
      }
    }

    // ── 2. keyword_rules ──────────────────────────────────────────────────────
    console.log("\n[2/4] Seeding keyword_rules ...");

    const keywordsBooking = [
      // Utama
      "lapangan bola", "lapangan futsal", "lapangan badminton", "lapangan basket",
      "lapangan tenis", "lapangan voli", "lapangan sepak bola", "lapangan olahraga",
      // Pesan/Sewa
      "pesan lapangan", "booking lapangan", "sewa lapangan", "mau pesan lapangan",
      "mau booking", "mau sewa lapangan", "mau main", "mau pesan",
      "ingin pesan lapangan", "ingin booking", "ingin sewa lapangan",
      "bisa booking", "bisa pesan lapangan", "bisa sewa",
      // Sport center
      "sport center", "sportcenter", "gor", "gedung olahraga",
      // Jenis olahraga
      "futsal", "badminton", "basket", "basketball", "tenis", "tennis", "voli", "volleyball",
      // Waktu & konteks
      "main besok", "main hari ini", "main minggu ini", "jadwal main",
      "slot kosong", "slot tersedia", "jam berapa kosong",
    ];

    const keywordsInquiry = [
      "harga lapangan", "tarif lapangan", "biaya sewa lapangan", "berapa sewa",
      "ada lapangan", "tersedia tidak", "ada slot", "jadwal lapangan",
      "info lapangan", "informasi lapangan",
    ];

    const keywordsCancel = [
      "cancel booking", "batalkan booking", "ubah booking", "reschedule lapangan",
      "ganti jadwal lapangan",
    ];

    const allKeywords = [
      ...keywordsBooking.map(k => ({ keyword: k, intent: "sport_center_booking", weight: k.includes("pesan") || k.includes("booking") || k.includes("sewa") ? 2.0 : 1.5 })),
      ...keywordsInquiry.map(k => ({ keyword: k, intent: "sport_center_inquiry", weight: 1.5 })),
      ...keywordsCancel.map(k => ({ keyword: k, intent: "sport_center_cancel", weight: 1.5 })),
    ];

    let kwInserted = 0, kwUpdated = 0;
    for (const kw of allKeywords) {
      const existing = await client.query(
        "SELECT id FROM keyword_rules WHERE keyword = $1 AND company_id = 'default'",
        [kw.keyword],
      );
      if (existing.rows.length > 0) {
        await client.query(
          "UPDATE keyword_rules SET intent_code=$1, weight=$2, is_active=true WHERE keyword=$3 AND company_id='default'",
          [kw.intent, kw.weight, kw.keyword],
        );
        kwUpdated++;
      } else {
        await client.query(
          "INSERT INTO keyword_rules (company_id, keyword, intent_code, weight, is_active) VALUES ('default',$1,$2,$3,true)",
          [kw.keyword, kw.intent, kw.weight],
        );
        kwInserted++;
      }
    }
    console.log(`   ✅ Keywords: ${kwInserted} inserted, ${kwUpdated} updated (${allKeywords.length} total)`);

    // ── 3. data_templates ─────────────────────────────────────────────────────
    console.log("\n[3/4] Seeding data_templates ...");

    const templates = [
      {
        intent_code: "sport_center_booking",
        name: "Pemesanan Lapangan Olahraga",
        category: "Sport Center",
        description: "Template untuk pemesanan/booking lapangan olahraga",
        intake_mode: "mini_form",   // ← KUNCI: kirim link mini form
        use_mini_form: true,
        mini_form_type: "field-booking",
        mini_form_route: "/mini-form/field-booking",
      },
      {
        intent_code: "sport_center_inquiry",
        name: "Informasi Lapangan Olahraga",
        category: "Sport Center",
        description: "Template untuk inquiry harga/ketersediaan lapangan",
        intake_mode: "conversation",
        use_mini_form: false,
        mini_form_type: null,
        mini_form_route: null,
      },
      {
        intent_code: "sport_center_cancel",
        name: "Pembatalan Booking Lapangan",
        category: "Sport Center",
        description: "Template untuk pembatalan booking lapangan",
        intake_mode: "conversation",
        use_mini_form: false,
        mini_form_type: null,
        mini_form_route: null,
      },
    ];

    const templateIds = {};
    for (const tpl of templates) {
      const existing = await client.query(
        "SELECT id FROM data_templates WHERE intent_code = $1 AND company_id = 'default'",
        [tpl.intent_code],
      );
      let tplId;
      if (existing.rows.length > 0) {
        tplId = existing.rows[0].id;
        await client.query(
          `UPDATE data_templates SET
            name=$1, category=$2, description=$3, intake_mode=$4,
            use_mini_form=$5, mini_form_type=$6, mini_form_route=$7,
            is_active=true, updated_at=NOW()
           WHERE intent_code=$8 AND company_id='default'`,
          [tpl.name, tpl.category, tpl.description, tpl.intake_mode, tpl.use_mini_form, tpl.mini_form_type, tpl.mini_form_route, tpl.intent_code],
        );
        console.log(`   ✅ Updated template: ${tpl.intent_code} (id=${tplId}) intake_mode=${tpl.intake_mode}`);
      } else {
        const res = await client.query(
          `INSERT INTO data_templates
            (company_id, intent_code, name, category, description,
             intake_mode, use_mini_form, mini_form_type, mini_form_route, is_active)
           VALUES ('default',$1,$2,$3,$4,$5,$6,$7,$8,true)
           RETURNING id`,
          [tpl.intent_code, tpl.name, tpl.category, tpl.description, tpl.intake_mode, tpl.use_mini_form, tpl.mini_form_type, tpl.mini_form_route],
        );
        tplId = res.rows[0].id;
        console.log(`   ✅ Inserted template: ${tpl.intent_code} (id=${tplId}) intake_mode=${tpl.intake_mode}`);
      }
      templateIds[tpl.intent_code] = tplId;
    }

    // ── 4. data_template_fields (untuk booking saja) ──────────────────────────
    console.log("\n[4/4] Seeding data_template_fields ...");

    const bookingFields = [
      { name: "booker_name",    label: "Nama Pemesan",         type: "text",     required: true,  sort: 1,  help: null,            sample: "Budi Santoso" },
      { name: "phone",          label: "Nomor WhatsApp",       type: "text",     required: true,  sort: 2,  help: null,            sample: "08123456789" },
      { name: "field_type",     label: "Jenis Lapangan",       type: "select",   required: true,  sort: 3,  help: null,            sample: "Futsal" },
      { name: "booking_date",   label: "Tanggal Main",         type: "date",     required: true,  sort: 4,  help: null,            sample: "2024-12-25" },
      { name: "start_time",     label: "Jam Mulai",            type: "select",   required: true,  sort: 5,  help: null,            sample: "09:00" },
      { name: "duration",       label: "Durasi Sewa",          type: "select",   required: true,  sort: 6,  help: null,            sample: "1 jam" },
      { name: "payment_method", label: "Metode Pembayaran",    type: "select",   required: true,  sort: 7,  help: null,            sample: "Transfer Bank" },
      { name: "notes",          label: "Catatan Tambahan",     type: "textarea", required: false, sort: 8,  help: "Opsional",      sample: null },
    ];

    const bookingTplId = templateIds["sport_center_booking"];
    if (bookingTplId) {
      // Delete old fields first (idempotent)
      await client.query("DELETE FROM data_template_fields WHERE template_id = $1", [bookingTplId]);
      for (const f of bookingFields) {
        await client.query(
          `INSERT INTO data_template_fields
            (template_id, field_name, field_label, field_type, is_required, sort_order, help_text, sample_value)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [bookingTplId, f.name, f.label, f.type, f.required, f.sort, f.help, f.sample],
        );
      }
      console.log(`   ✅ ${bookingFields.length} fields inserted for sport_center_booking`);
    }

    await client.query("COMMIT");
    console.log("\n🎉 Seed sport center selesai!\n");

    // Verifikasi
    const v1 = await client.query("SELECT COUNT(*) FROM intent_master WHERE category='Sport Center'");
    const v2 = await client.query("SELECT COUNT(*) FROM keyword_rules WHERE intent_code LIKE 'sport_center%'");
    const v3 = await client.query("SELECT intent_code, intake_mode, mini_form_type FROM data_templates WHERE category='Sport Center'");
    console.log("📊 Verifikasi:");
    console.log(`   intent_master (Sport Center): ${v1.rows[0].count} rows`);
    console.log(`   keyword_rules (sport_center*): ${v2.rows[0].count} rows`);
    console.log(`   data_templates:`);
    v3.rows.forEach(r => console.log(`     - ${r.intent_code}: intake_mode=${r.intake_mode}, mini_form_type=${r.mini_form_type}`));

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("\n❌ Seed gagal:", err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(() => process.exit(1));
