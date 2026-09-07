/**
 * Seed Knowledge Base — intent_master, keyword_rules, data_templates, data_template_fields
 * Termasuk intent kasbon (cash advance) dengan template tanya-balik otomatis
 */
import pg from "pg";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL || "" });

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Bersihkan data lama
    await client.query("DELETE FROM data_template_fields");
    await client.query("DELETE FROM data_templates");
    await client.query("DELETE FROM keyword_rules");
    await client.query("DELETE FROM intent_master");
    console.log("🗑  Data lama dihapus");

    // ─── 1. Intent Master ─────────────────────────────────────────────────────
    const intents = [
      { code: "permintaan_kasbon",        name: "Permintaan Kasbon / Uang Muka",       category: "Finance",         division: "Keuangan",    priority: "medium", sla: 4  },
      { code: "cek_status_pengiriman",    name: "Cek Status Pengiriman",               category: "Trucking",        division: "Operasional", priority: "medium", sla: 2  },
      { code: "komplain_pengiriman",      name: "Komplain Pengiriman",                 category: "Complaint",       division: "Pelanggan",   priority: "high",   sla: 2  },
      { code: "permintaan_pickup",        name: "Permintaan Pickup",                   category: "Trucking",        division: "Operasional", priority: "medium", sla: 4  },
      { code: "permintaan_penawaran",     name: "Permintaan Penawaran Harga",          category: "Import",          division: "Sales",       priority: "medium", sla: 8  },
      { code: "konfirmasi_pembayaran",    name: "Konfirmasi Pembayaran",               category: "Finance",         division: "Keuangan",    priority: "high",   sla: 2  },
      { code: "pertanyaan_tagihan",       name: "Pertanyaan Tagihan / Invoice",        category: "Finance",         division: "Keuangan",    priority: "medium", sla: 4  },
      { code: "permintaan_dokumen",       name: "Permintaan Dokumen",                  category: "Customs",         division: "Operasional", priority: "medium", sla: 8  },
      { code: "klaim_asuransi",           name: "Klaim Asuransi",                      category: "Complaint",       division: "Keuangan",    priority: "high",   sla: 4  },
      { code: "jadwal_pengiriman",        name: "Jadwal Pengiriman",                   category: "Trucking",        division: "Operasional", priority: "medium", sla: 4  },
      { code: "pendaftaran_pelanggan",    name: "Pendaftaran Pelanggan Baru",          category: "General Inquiry", division: "Sales",       priority: "low",    sla: 24 },
      { code: "permintaan_vendor",        name: "Kerjasama Vendor",                    category: "General Inquiry", division: "Operasional", priority: "low",    sla: 48 },
      { code: "feedback_positif",         name: "Feedback / Pujian",                   category: "General Inquiry", division: "Pelanggan",   priority: "low",    sla: 24 },
      { code: "pertanyaan_layanan",       name: "Informasi Layanan",                   category: "General Inquiry", division: "Sales",       priority: "low",    sla: 8  },
      { code: "general_inquiry",          name: "Pertanyaan Umum",                     category: "General Inquiry", division: "Operasional", priority: "low",    sla: 24 },
    ];

    const intentRows = await client.query(`
      INSERT INTO intent_master (company_id, intent_code, intent_name, category, suggested_category, suggested_division, suggested_priority, sla_hours, is_active)
      SELECT 'default', v.code, v.name, v.category, v.category, v.division, v.priority, v.sla::int, true
      FROM jsonb_to_recordset($1::jsonb) AS v(code text, name text, category text, division text, priority text, sla int)
      RETURNING id, intent_code
    `, [JSON.stringify(intents)]);
    console.log(`✅ ${intentRows.rowCount} intent ditambahkan`);

    // ─── 2. Keyword Rules ─────────────────────────────────────────────────────
    const keywords = [
      // Kasbon
      { kw: "kasbon",             code: "permintaan_kasbon",     w: 5 },
      { kw: "kasb0n",             code: "permintaan_kasbon",     w: 4 },
      { kw: "uang muka",          code: "permintaan_kasbon",     w: 4 },
      { kw: "pinjam uang",        code: "permintaan_kasbon",     w: 4 },
      { kw: "minta kasbon",       code: "permintaan_kasbon",     w: 5 },
      { kw: "mau kasbon",         code: "permintaan_kasbon",     w: 5 },
      { kw: "perlu kasbon",       code: "permintaan_kasbon",     w: 5 },
      { kw: "butuh uang",         code: "permintaan_kasbon",     w: 3 },
      { kw: "talangan",           code: "permintaan_kasbon",     w: 3 },
      { kw: "advance gaji",       code: "permintaan_kasbon",     w: 4 },
      { kw: "cicilan kasbon",     code: "permintaan_kasbon",     w: 4 },
      { kw: "pinjaman kantor",    code: "permintaan_kasbon",     w: 4 },
      // Status pengiriman
      { kw: "status",             code: "cek_status_pengiriman", w: 3 },
      { kw: "di mana",            code: "cek_status_pengiriman", w: 2 },
      { kw: "sudah sampai",       code: "cek_status_pengiriman", w: 4 },
      { kw: "tracking",           code: "cek_status_pengiriman", w: 3 },
      { kw: "lacak",              code: "cek_status_pengiriman", w: 3 },
      // Komplain
      { kw: "komplain",           code: "komplain_pengiriman",   w: 5 },
      { kw: "rusak",              code: "komplain_pengiriman",   w: 4 },
      { kw: "hilang",             code: "komplain_pengiriman",   w: 4 },
      { kw: "telat",              code: "komplain_pengiriman",   w: 3 },
      { kw: "belum sampai",       code: "komplain_pengiriman",   w: 3 },
      // Pickup
      { kw: "pickup",             code: "permintaan_pickup",     w: 5 },
      { kw: "jemput",             code: "permintaan_pickup",     w: 4 },
      { kw: "ambil barang",       code: "permintaan_pickup",     w: 4 },
      // Penawaran
      { kw: "harga",              code: "permintaan_penawaran",  w: 3 },
      { kw: "penawaran",          code: "permintaan_penawaran",  w: 4 },
      { kw: "quotation",          code: "permintaan_penawaran",  w: 4 },
      { kw: "tarif",              code: "permintaan_penawaran",  w: 3 },
      // Pembayaran
      { kw: "transfer",           code: "konfirmasi_pembayaran", w: 3 },
      { kw: "sudah bayar",        code: "konfirmasi_pembayaran", w: 4 },
      { kw: "konfirmasi",         code: "konfirmasi_pembayaran", w: 3 },
      { kw: "bukti transfer",     code: "konfirmasi_pembayaran", w: 5 },
    ];

    await client.query(`
      INSERT INTO keyword_rules (company_id, keyword, intent_code, weight, is_active)
      SELECT 'default', v.kw, v.code, v.w::real, true
      FROM jsonb_to_recordset($1::jsonb) AS v(kw text, code text, w int)
    `, [JSON.stringify(keywords)]);
    console.log(`✅ ${keywords.length} keyword rules ditambahkan`);

    // ─── 3. Data Templates untuk Kasbon ──────────────────────────────────────
    const { rows: [kasbonTemplate] } = await client.query(`
      INSERT INTO data_templates (company_id, intent_code, name, category, description, is_active)
      VALUES ('default', 'permintaan_kasbon', 'Template Kasbon', 'Finance',
              'Data yang dibutuhkan untuk memproses permintaan kasbon karyawan', true)
      RETURNING id
    `);

    const kasbonFields = [
      { name: "nama_karyawan",    label: "Nama lengkap karyawan",              type: "text",   required: true,  order: 1, help: "Nama sesuai data karyawan", sample: "Budi Santoso" },
      { name: "jumlah_kasbon",    label: "Jumlah kasbon yang diminta (Rp)",    type: "number", required: true,  order: 2, help: "Nominal dalam rupiah", sample: "2000000" },
      { name: "alasan_kasbon",    label: "Alasan / keperluan kasbon",          type: "text",   required: true,  order: 3, help: "Singkat dan jelas", sample: "Biaya berobat keluarga" },
      { name: "tanggal_butuh",    label: "Tanggal butuh dana",                 type: "date",   required: true,  order: 4, help: "Format: DD/MM/YYYY", sample: "25/06/2026" },
      { name: "cicilan_bulan",    label: "Rencana cicilan (berapa bulan)",     type: "number", required: false, order: 5, help: "Misal: 2 bulan", sample: "2" },
    ];

    for (const f of kasbonFields) {
      await client.query(`
        INSERT INTO data_template_fields (template_id, field_name, field_label, field_type, is_required, sort_order, help_text, sample_value)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [kasbonTemplate.id, f.name, f.label, f.type, f.required, f.order, f.help, f.sample]);
    }
    console.log(`✅ Template kasbon + ${kasbonFields.length} field ditambahkan`);

    // ─── 4. Data Templates untuk Import ──────────────────────────────────────
    const { rows: [importTemplate] } = await client.query(`
      INSERT INTO data_templates (company_id, intent_code, name, category, description, is_active)
      VALUES ('default', 'permintaan_penawaran', 'Template Import', 'Import',
              'Data yang dibutuhkan untuk penawaran jasa import', true)
      RETURNING id
    `);

    const importFields = [
      { name: "supplier_name",        label: "Nama supplier",                 type: "text",   required: true,  order: 1, sample: "ABC Trading Co" },
      { name: "country_origin",       label: "Negara asal barang",            type: "text",   required: true,  order: 2, sample: "China" },
      { name: "commodity",            label: "Jenis barang / komoditi",       type: "text",   required: true,  order: 3, sample: "Mesin tekstil" },
      { name: "gross_weight",         label: "Berat kotor (kg)",              type: "number", required: true,  order: 4, sample: "500" },
      { name: "hs_code",              label: "HS Code",                       type: "text",   required: false, order: 5, sample: "8444.00.00" },
      { name: "incoterm",             label: "Incoterm (EXW/FOB/CIF)",        type: "text",   required: false, order: 6, sample: "FOB" },
    ];

    for (const f of importFields) {
      await client.query(`
        INSERT INTO data_template_fields (template_id, field_name, field_label, field_type, is_required, sort_order, help_text, sample_value)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [importTemplate.id, f.name, f.label, f.type, f.required, f.order, null, f.sample]);
    }
    console.log(`✅ Template import + ${importFields.length} field ditambahkan`);

    await client.query("COMMIT");
    console.log("\n🎉 Knowledge base berhasil di-seed!");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(e => { console.error("❌ Gagal:", e.message); process.exit(1); });
