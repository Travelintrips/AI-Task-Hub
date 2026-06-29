/**
 * Seed PPJK (Perusahaan Pengurusan Jasa Kepabeanan) ke database
 * Idempotent: DELETE + INSERT berdasarkan intent_code
 * Run: node scripts/seed-ppjk.mjs
 */

import pkg from "pg";
const { Pool } = pkg;

const CONN =
  process.env.SUPABASE_DATABASE_URL_DEV ||
  process.env.SUPABASE_DATABASE_URL ||
  process.env.DATABASE_URL;

if (!CONN) {
  console.error("❌ Tidak ada DATABASE_URL.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: CONN,
  ssl: CONN.includes("supabase") ? { rejectUnauthorized: false } : false,
});
const COMPANY = "default";
const INTENT_CODE = "ppjk_services";

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ── Bersihkan data lama ─────────────────────────────────────────────────
    console.log("🔄 Menghapus data PPJK lama (jika ada)...");
    await client.query(
      `DELETE FROM keyword_rules WHERE company_id=$1 AND intent_code=$2`,
      [COMPANY, INTENT_CODE]
    );

    const existing = await client.query(
      `SELECT id FROM data_templates WHERE company_id=$1 AND intent_code=$2`,
      [COMPANY, INTENT_CODE]
    );
    if (existing.rows.length > 0) {
      const tid = existing.rows[0].id;
      await client.query(`DELETE FROM data_template_fields WHERE template_id=$1`, [tid]);
      await client.query(`DELETE FROM data_templates WHERE id=$1`, [tid]);
    }

    await client.query(
      `DELETE FROM intent_master WHERE company_id=$1 AND intent_code=$2`,
      [COMPANY, INTENT_CODE]
    );

    // ── 1. Intent master ────────────────────────────────────────────────────
    console.log("✅ Menambah intent PPJK...");
    await client.query(
      `INSERT INTO intent_master
         (company_id, intent_code, intent_name, category,
          suggested_category, suggested_division, suggested_priority,
          sla_hours, is_active, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,NOW(),NOW())`,
      [COMPANY, INTENT_CODE, "Layanan PPJK / Customs Broker",
       "Customs", "Customs", "Customs", "high", 4]
    );

    // ── 2. Data template ────────────────────────────────────────────────────
    console.log("✅ Menambah template PPJK...");
    const { rows } = await client.query(
      `INSERT INTO data_templates
         (company_id, intent_code, name, category, description,
          is_active, use_mini_form, mini_form_type, intake_mode,
          created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,true,$6,$7,$8,NOW(),NOW())
       RETURNING id`,
      [COMPANY, INTENT_CODE,
       "Template Layanan PPJK",
       "Customs",
       "Template untuk pengurusan jasa kepabeanan (PPJK / Customs Broker)",
       false, null, "hybrid"]
    );
    const tplId = rows[0].id;
    console.log(`   Template ID: ${tplId}`);

    // ── 3. Template fields ──────────────────────────────────────────────────
    console.log("✅ Menambah fields template PPJK...");
    const fields = [
      { name: "importer_name",   label: "Nama Importir / Eksportir",       type: "text",   req: true,  sort: 1,  sample: "PT Maju Bersama",       help: null },
      { name: "npwp",            label: "NPWP Perusahaan",                  type: "text",   req: true,  sort: 2,  sample: "01.234.567.8-901.000",  help: null },
      { name: "nib",             label: "NIB (Nomor Induk Berusaha)",       type: "text",   req: false, sort: 3,  sample: "1234567890123",          help: null },
      { name: "commodity",       label: "Jenis Barang / Komoditi",          type: "text",   req: true,  sort: 4,  sample: "Mesin industri",         help: null },
      { name: "hs_code",         label: "HS Code",                          type: "text",   req: false, sort: 5,  sample: "8479.89.00",             help: "Minimal 6 digit" },
      { name: "origin_country",  label: "Negara Asal",                      type: "text",   req: true,  sort: 6,  sample: "China",                  help: null },
      { name: "port_of_entry",   label: "Pelabuhan Masuk / Tujuan",         type: "text",   req: true,  sort: 7,  sample: "Tanjung Priok",          help: null },
      { name: "shipment_type",   label: "Jalur Pengiriman",                 type: "text",   req: true,  sort: 8,  sample: "Laut",                   help: "Laut / Udara / Darat" },
      { name: "invoice_value",   label: "Nilai Invoice",                    type: "text",   req: true,  sort: 9,  sample: "USD 50.000",             help: null },
      { name: "pib_peb_type",    label: "Jenis Pemberitahuan (PIB/PEB)",    type: "text",   req: true,  sort: 10, sample: "PIB",                    help: "PIB = Import, PEB = Export" },
      { name: "api_number",      label: "Nomor API (Angka Pengenal Impor)", type: "text",   req: false, sort: 11, sample: "API-U-1234567890",       help: "Khusus importir" },
      { name: "lartas",          label: "Ada Larangan Pembatasan (Lartas)?",type: "text",   req: false, sort: 12, sample: "Tidak",                  help: "Ya / Tidak" },
      { name: "additional_docs", label: "Dokumen Tambahan yang Ada",        type: "text",   req: false, sort: 13, sample: "COA, SNI, Fumigasi",     help: null },
      { name: "target_date",     label: "Target Tanggal Penyelesaian",      type: "date",   req: false, sort: 14, sample: "30-06-2026",             help: null },
    ];

    for (const f of fields) {
      await client.query(
        `INSERT INTO data_template_fields
           (template_id, field_name, field_label, field_type,
            is_required, sort_order, help_text, sample_value, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
        [tplId, f.name, f.label, f.type, f.req, f.sort, f.help, f.sample]
      );
    }
    console.log(`   ${fields.length} fields ditambahkan`);

    // ── 4. Keywords ─────────────────────────────────────────────────────────
    console.log("✅ Menambah keywords PPJK...");
    const keywords = [
      { kw: "ppjk",                                  w: 3.5 },
      { kw: "PPJK",                                  w: 3.5 },
      { kw: "perusahaan pengurusan jasa kepabeanan",  w: 3.5 },
      { kw: "customs broker",                         w: 3.0 },
      { kw: "jasa kepabeanan",                        w: 3.0 },
      { kw: "pengurusan bea cukai",                   w: 3.0 },
      { kw: "pengurusan pabean",                      w: 3.0 },
      { kw: "urus bea cukai",                         w: 2.8 },
      { kw: "jasa customs",                           w: 2.8 },
      { kw: "bantu clearance",                        w: 2.5 },
      { kw: "bantu bea cukai",                        w: 2.5 },
      { kw: "PIB",                                    w: 2.5 },
      { kw: "PEB",                                    w: 2.5 },
      { kw: "pemberitahuan impor barang",             w: 2.5 },
      { kw: "pemberitahuan ekspor barang",            w: 2.5 },
      { kw: "urus PIB",                               w: 2.8 },
      { kw: "urus PEB",                               w: 2.8 },
      { kw: "pengajuan PIB",                          w: 2.8 },
      { kw: "pengajuan PEB",                          w: 2.8 },
      { kw: "SPPB",                                   w: 2.0 },
      { kw: "surat persetujuan pengeluaran barang",   w: 2.5 },
      { kw: "BC 2.0",                                 w: 2.5 },
      { kw: "BC 3.0",                                 w: 2.5 },
      { kw: "lartas",                                 w: 2.0 },
      { kw: "angka pengenal impor",                   w: 2.5 },
      { kw: "API impor",                              w: 2.0 },
      { kw: "dokumen kepabeanan",                     w: 2.5 },
      { kw: "bea masuk",                              w: 1.8 },
      { kw: "tarif bea",                              w: 1.8 },
      { kw: "jalur merah",                            w: 2.0 },
      { kw: "jalur hijau",                            w: 2.0 },
      { kw: "jalur kuning",                           w: 2.0 },
      { kw: "import custom",                          w: 2.0 },
      { kw: "export custom",                          w: 2.0 },
    ];

    for (const k of keywords) {
      await client.query(
        `INSERT INTO keyword_rules (company_id, intent_code, keyword, weight, is_active, created_at)
         VALUES ($1,$2,$3,$4,true,NOW())`,
        [COMPANY, INTENT_CODE, k.kw, k.w]
      );
    }
    console.log(`   ${keywords.length} keywords ditambahkan`);

    await client.query("COMMIT");
    console.log("\n🎉 PPJK berhasil ditambahkan!");
    console.log(`   Intent  : ${INTENT_CODE} — "Layanan PPJK / Customs Broker"`);
    console.log(`   Template: ID ${tplId} — ${fields.length} fields`);
    console.log(`   Keywords: ${keywords.length} entri`);
    console.log(`   Mode    : Hybrid | Prioritas: High | SLA: 4 jam`);

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error:", err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(() => process.exit(1));
