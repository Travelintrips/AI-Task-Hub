/**
 * Sprint KB — Knowledge Base Seed Data (Logistik & Freight)
 * Inserts complete KB data so AI can work immediately.
 * All records use company_id = 'default' (Intent Engine hardcodes this).
 * Usage: node scripts/seed-knowledge-base.mjs
 */
import pg from "pg";

const { Pool } = pg;
const connectionString =
  process.env.SUPABASE_DATABASE_URL || process.env.SUPABASE_DATABASE_URL_DEV;

if (!connectionString) {
  console.error("❌ SUPABASE_DATABASE_URL not set");
  process.exit(1);
}

const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 1 });

async function run(label, sql, params = []) {
  try {
    const r = await pool.query(sql, params);
    console.log(`✅ ${label}${r.rowCount != null ? ` (${r.rowCount} rows)` : ""}`);
    return r;
  } catch (e) {
    console.error(`❌ ${label}: ${e.message}`);
    throw e;
  }
}

async function query(sql, params = []) {
  const r = await pool.query(sql, params);
  return r.rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// ENSURE intent_code COLUMN EXISTS (schema drift fix)
// ─────────────────────────────────────────────────────────────────────────────
await run("Add intent_code to data_templates (if missing)", `
  ALTER TABLE data_templates ADD COLUMN IF NOT EXISTS intent_code TEXT
`);
await run("Add intent_code to document_templates (if missing)", `
  ALTER TABLE document_templates ADD COLUMN IF NOT EXISTS intent_code TEXT
`);

// ─────────────────────────────────────────────────────────────────────────────
// CLEAR EXISTING DEFAULT DATA (idempotent re-run)
// ─────────────────────────────────────────────────────────────────────────────
await run("Clear intent_master (default)", `DELETE FROM intent_master WHERE company_id = 'default'`);
await run("Clear keyword_rules (default)", `DELETE FROM keyword_rules WHERE company_id = 'default'`);
await run("Clear service_catalog (default)", `DELETE FROM service_catalog WHERE company_id = 'default'`);
await run("Clear data_template_fields (default)",
  `DELETE FROM data_template_fields WHERE template_id IN (SELECT id FROM data_templates WHERE company_id = 'default')`);
await run("Clear data_templates (default)", `DELETE FROM data_templates WHERE company_id = 'default'`);
await run("Clear document_template_fields (default)",
  `DELETE FROM document_template_fields WHERE template_id IN (SELECT id FROM document_templates WHERE company_id = 'default')`);
await run("Clear document_templates (default)", `DELETE FROM document_templates WHERE company_id = 'default'`);

// ─────────────────────────────────────────────────────────────────────────────
// A. INTENT MASTER  — 14 intents untuk bisnis logistik
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Intent Master ──────────────────────────────────");

const intents = [
  // code, name, category, description, suggestedCategory, suggestedDivision, priority, sla_hours
  ["cek_status_pengiriman", "Cek Status Pengiriman", "Operasional", "Pelanggan menanyakan posisi/status barang yang dikirim", "Pengiriman", "Tim Operasional", "high", 2],
  ["komplain_pengiriman", "Komplain Pengiriman", "Komplain", "Pelanggan melaporkan masalah: telat, rusak, salah kirim, tidak sampai", "Komplain", "Tim Operasional", "critical", 1],
  ["permintaan_pickup", "Permintaan Pickup/Penjemputan", "Operasional", "Pelanggan meminta penjemputan barang di lokasi tertentu", "Pengiriman", "Tim Operasional", "high", 4],
  ["permintaan_penawaran", "Permintaan Penawaran Harga", "Komersial", "Pelanggan meminta quotation atau tarif pengiriman", "Komersial", "Tim Sales", "medium", 8],
  ["konfirmasi_pembayaran", "Konfirmasi Pembayaran", "Keuangan", "Pelanggan mengkonfirmasi sudah bayar atau mengirim bukti transfer", "Keuangan", "Tim Keuangan", "high", 2],
  ["pertanyaan_tagihan", "Pertanyaan Tagihan/Invoice", "Keuangan", "Pelanggan menanyakan invoice, tagihan, atau rincian biaya", "Keuangan", "Tim Keuangan", "medium", 4],
  ["permintaan_dokumen", "Permintaan Dokumen", "Administrasi", "Pelanggan meminta surat jalan, POD, atau dokumen lain", "Administrasi", "Tim Administrasi", "medium", 8],
  ["klaim_asuransi", "Klaim Asuransi/Ganti Rugi", "Keuangan", "Pelanggan mengajukan klaim atas kerusakan atau kehilangan barang", "Keuangan", "Tim Keuangan", "critical", 4],
  ["jadwal_pengiriman", "Pertanyaan Jadwal Pengiriman", "Operasional", "Pelanggan menanyakan jadwal pengiriman, estimasi tiba, atau cut-off", "Pengiriman", "Tim Operasional", "medium", 4],
  ["pendaftaran_pelanggan", "Pendaftaran Pelanggan Baru", "Komersial", "Calon pelanggan ingin mendaftar atau membuat akun", "Komersial", "Tim Sales", "medium", 24],
  ["permintaan_vendor", "Permintaan Kerjasama Vendor", "Komersial", "Vendor atau mitra ingin menawarkan layanan atau kerjasama", "Komersial", "Tim Sales", "low", 48],
  ["feedback_positif", "Feedback/Pujian Positif", "Layanan", "Pelanggan memberikan penilaian baik atau ucapan terima kasih", "Layanan", "Tim Customer Service", "low", 24],
  ["pertanyaan_layanan", "Pertanyaan Informasi Layanan", "Layanan", "Pertanyaan umum tentang layanan, area cakupan, atau ketentuan", "Layanan", "Tim Customer Service", "low", 8],
  ["general_inquiry", "Pertanyaan Umum", "Umum", "Pesan yang tidak masuk kategori lain atau butuh review manual", "Umum", "Tim Customer Service", "low", 24],
];

for (const [code, name, cat, desc, sugCat, sugDiv, prio, sla] of intents) {
  await run(`Intent: ${code}`, `
    INSERT INTO intent_master (company_id, intent_code, intent_name, category, description, suggested_category, suggested_division, suggested_priority, sla_hours, is_active)
    VALUES ('default', $1, $2, $3, $4, $5, $6, $7, $8, true)
  `, [code, name, cat, desc, sugCat, sugDiv, prio, sla]);
}

// ─────────────────────────────────────────────────────────────────────────────
// B. KEYWORD RULES  — 80+ kata kunci Bahasa Indonesia
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Keyword Rules ──────────────────────────────────");

const keywords = [
  // [keyword, intent_code, weight]

  // cek_status_pengiriman
  ["dimana barang", "cek_status_pengiriman", 3.0],
  ["mana barangnya", "cek_status_pengiriman", 3.0],
  ["sudah sampai mana", "cek_status_pengiriman", 3.0],
  ["cek resi", "cek_status_pengiriman", 2.5],
  ["tracking", "cek_status_pengiriman", 2.5],
  ["status pengiriman", "cek_status_pengiriman", 2.5],
  ["posisi barang", "cek_status_pengiriman", 2.5],
  ["update pengiriman", "cek_status_pengiriman", 2.0],
  ["kapan sampai", "cek_status_pengiriman", 2.0],
  ["nomor resi", "cek_status_pengiriman", 2.0],
  ["lacak paket", "cek_status_pengiriman", 2.0],
  ["barang sudah dikirim belum", "cek_status_pengiriman", 2.0],
  ["kiriman saya", "cek_status_pengiriman", 1.5],
  ["paket saya", "cek_status_pengiriman", 1.5],

  // komplain_pengiriman
  ["barang rusak", "komplain_pengiriman", 3.5],
  ["barang hilang", "komplain_pengiriman", 3.5],
  ["tidak sampai", "komplain_pengiriman", 3.5],
  ["belum sampai", "komplain_pengiriman", 3.0],
  ["telat", "komplain_pengiriman", 2.5],
  ["terlambat", "komplain_pengiriman", 2.5],
  ["salah kirim", "komplain_pengiriman", 3.0],
  ["komplain", "komplain_pengiriman", 2.5],
  ["kecewa", "komplain_pengiriman", 2.0],
  ["mengecewakan", "komplain_pengiriman", 2.0],
  ["tidak profesional", "komplain_pengiriman", 2.0],
  ["barang pecah", "komplain_pengiriman", 3.0],
  ["barang bocor", "komplain_pengiriman", 3.0],
  ["isi berkurang", "komplain_pengiriman", 2.5],
  ["bukan pesanan saya", "komplain_pengiriman", 3.0],
  ["laporan", "komplain_pengiriman", 1.5],
  ["protes", "komplain_pengiriman", 2.0],
  ["tidak sesuai", "komplain_pengiriman", 2.0],

  // permintaan_pickup
  ["jemput", "permintaan_pickup", 3.0],
  ["pickup", "permintaan_pickup", 3.0],
  ["penjemputan", "permintaan_pickup", 3.0],
  ["ambil barang", "permintaan_pickup", 2.5],
  ["antar jemput", "permintaan_pickup", 2.5],
  ["minta dijemput", "permintaan_pickup", 3.0],
  ["bisa jemput", "permintaan_pickup", 2.5],
  ["kirim barang", "permintaan_pickup", 2.0],
  ["pengambilan", "permintaan_pickup", 2.0],

  // permintaan_penawaran
  ["harga", "permintaan_penawaran", 2.0],
  ["tarif", "permintaan_penawaran", 2.5],
  ["ongkir", "permintaan_penawaran", 2.5],
  ["ongkos kirim", "permintaan_penawaran", 2.5],
  ["biaya kirim", "permintaan_penawaran", 2.5],
  ["quotation", "permintaan_penawaran", 3.0],
  ["penawaran", "permintaan_penawaran", 2.5],
  ["berapa harga", "permintaan_penawaran", 3.0],
  ["estimasi biaya", "permintaan_penawaran", 2.5],
  ["harga pengiriman", "permintaan_penawaran", 2.5],
  ["rate", "permintaan_penawaran", 2.0],

  // konfirmasi_pembayaran
  ["sudah bayar", "konfirmasi_pembayaran", 3.5],
  ["bukti transfer", "konfirmasi_pembayaran", 3.5],
  ["sudah transfer", "konfirmasi_pembayaran", 3.5],
  ["konfirmasi bayar", "konfirmasi_pembayaran", 3.0],
  ["pembayaran", "konfirmasi_pembayaran", 2.0],
  ["transfer", "konfirmasi_pembayaran", 2.0],
  ["bukti bayar", "konfirmasi_pembayaran", 3.0],
  ["sudah dp", "konfirmasi_pembayaran", 2.5],
  ["sudah lunas", "konfirmasi_pembayaran", 3.0],

  // pertanyaan_tagihan
  ["invoice", "pertanyaan_tagihan", 3.0],
  ["tagihan", "pertanyaan_tagihan", 3.0],
  ["kwitansi", "pertanyaan_tagihan", 2.5],
  ["nota", "pertanyaan_tagihan", 2.0],
  ["total bayar", "pertanyaan_tagihan", 2.5],
  ["rincian biaya", "pertanyaan_tagihan", 2.5],
  ["berapa tagihannya", "pertanyaan_tagihan", 3.0],
  ["belum terima invoice", "pertanyaan_tagihan", 3.0],
  ["minta invoice", "pertanyaan_tagihan", 2.5],

  // permintaan_dokumen
  ["surat jalan", "permintaan_dokumen", 3.5],
  ["pod", "permintaan_dokumen", 3.0],
  ["proof of delivery", "permintaan_dokumen", 3.0],
  ["tanda terima", "permintaan_dokumen", 2.5],
  ["dokumen pengiriman", "permintaan_dokumen", 2.5],
  ["sertifikat", "permintaan_dokumen", 2.0],
  ["minta dokumen", "permintaan_dokumen", 2.5],
  ["kirim dokumen", "permintaan_dokumen", 2.0],

  // klaim_asuransi
  ["klaim", "klaim_asuransi", 3.5],
  ["asuransi", "klaim_asuransi", 3.0],
  ["ganti rugi", "klaim_asuransi", 3.5],
  ["minta ganti", "klaim_asuransi", 3.0],
  ["kompensasi", "klaim_asuransi", 2.5],
  ["tanggung jawab", "klaim_asuransi", 2.0],
  ["hilang harus ganti", "klaim_asuransi", 3.0],

  // jadwal_pengiriman
  ["jadwal", "jadwal_pengiriman", 2.5],
  ["cut off", "jadwal_pengiriman", 3.0],
  ["cutoff", "jadwal_pengiriman", 3.0],
  ["estimasi tiba", "jadwal_pengiriman", 2.5],
  ["hari apa sampai", "jadwal_pengiriman", 2.5],
  ["berapa hari", "jadwal_pengiriman", 2.0],
  ["rute", "jadwal_pengiriman", 2.0],

  // pendaftaran_pelanggan
  ["daftar", "pendaftaran_pelanggan", 2.5],
  ["registrasi", "pendaftaran_pelanggan", 3.0],
  ["buka akun", "pendaftaran_pelanggan", 2.5],
  ["jadi pelanggan", "pendaftaran_pelanggan", 3.0],
  ["ingin bergabung", "pendaftaran_pelanggan", 2.5],
  ["cara mendaftar", "pendaftaran_pelanggan", 2.5],

  // permintaan_vendor
  ["kerjasama", "permintaan_vendor", 3.0],
  ["vendor", "permintaan_vendor", 2.5],
  ["mitra", "permintaan_vendor", 2.5],
  ["penawaran kerjasama", "permintaan_vendor", 3.0],
  ["subkontraktor", "permintaan_vendor", 2.5],

  // feedback_positif
  ["terima kasih", "feedback_positif", 2.5],
  ["makasih", "feedback_positif", 2.0],
  ["bagus", "feedback_positif", 2.0],
  ["memuaskan", "feedback_positif", 2.5],
  ["puas", "feedback_positif", 2.0],
  ["mantap", "feedback_positif", 2.0],
  ["recommended", "feedback_positif", 2.0],
  ["terpercaya", "feedback_positif", 2.0],

  // pertanyaan_layanan
  ["layanan", "pertanyaan_layanan", 1.5],
  ["informasi", "pertanyaan_layanan", 1.5],
  ["area pengiriman", "pertanyaan_layanan", 2.5],
  ["cakupan", "pertanyaan_layanan", 2.0],
  ["tersedia tidak", "pertanyaan_layanan", 2.0],
  ["bisa kirim ke", "pertanyaan_layanan", 2.5],
  ["jenis layanan", "pertanyaan_layanan", 2.0],
  ["ketentuan", "pertanyaan_layanan", 1.5],
  ["syarat", "pertanyaan_layanan", 1.5],
];

for (const [kw, code, weight] of keywords) {
  await run(`Keyword: "${kw}" → ${code}`, `
    INSERT INTO keyword_rules (company_id, keyword, intent_code, weight, is_active)
    VALUES ('default', $1, $2, $3, true)
  `, [kw, code, weight]);
}

// ─────────────────────────────────────────────────────────────────────────────
// C. SERVICE CATALOG  — 14 layanan logistik
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Service Catalog ────────────────────────────────");

const services = [
  // [code, name, category, desc, basePrice, currency, estimatedDays, slaHours, suggestedTeam]
  ["TRK-JKT-SBY", "Trucking Jakarta–Surabaya", "Pengiriman Darat", "Layanan pengiriman truck full load rute Jakarta–Surabaya via tol Trans Jawa", "4500000", "IDR", "2", "48", "Tim Operasional"],
  ["TRK-JKT-SMG", "Trucking Jakarta–Semarang", "Pengiriman Darat", "Layanan pengiriman truck rute Jakarta–Semarang", "2500000", "IDR", "1", "24", "Tim Operasional"],
  ["TRK-JKT-MED", "Trucking Jakarta–Medan", "Pengiriman Darat", "Pengiriman darat + kapal rute Jakarta–Medan via Belawan", "8000000", "IDR", "5", "120", "Tim Operasional"],
  ["EXP-SS", "Express Same Day (Jabodetabek)", "Express", "Pengiriman same day di area Jabodetabek, antar sebelum pukul 18:00", "150000", "IDR", "0", "8", "Tim Operasional"],
  ["EXP-ND", "Express Next Day (Pulau Jawa)", "Express", "Pengiriman next day untuk seluruh kota besar di Pulau Jawa", "250000", "IDR", "1", "24", "Tim Operasional"],
  ["FCL-20", "Full Container Load 20 Feet", "Kargo Laut", "Pengiriman FCL 20 feet antar pulau, kapasitas 25 ton", "15000000", "IDR", "7", "168", "Tim Operasional"],
  ["FCL-40", "Full Container Load 40 Feet", "Kargo Laut", "Pengiriman FCL 40 feet antar pulau, kapasitas 28 ton", "22000000", "IDR", "7", "168", "Tim Operasional"],
  ["LCL-KG", "Less than Container Load (LCL)", "Kargo Laut", "Pengiriman LCL / gabungan untuk kiriman di bawah 1 container penuh", "85000", "IDR", "10", "240", "Tim Operasional"],
  ["COLD-CHAIN", "Cold Chain Logistics", "Khusus", "Pengiriman barang yang membutuhkan pendingin (makanan, farmasi, bahan medis)", "7500000", "IDR", "3", "72", "Tim Operasional"],
  ["B2B-REGULER", "B2B Regular Delivery", "Korporat", "Layanan pengiriman reguler untuk pelanggan korporat dengan volume tetap, diskon khusus", "Negosiasi", "IDR", "3", "72", "Tim Sales"],
  ["GUDANG-JKT", "Warehousing Jakarta", "Pergudangan", "Layanan penyimpanan di gudang Jakarta Utara, kapasitas 5000 m², sistem WMS", "500000", "IDR", "1", "24", "Tim Gudang"],
  ["FULFILLMENT", "E-Commerce Fulfillment", "E-Commerce", "Layanan fulfillment end-to-end: terima, simpan, packing, kirim untuk toko online", "Negosiasi", "IDR", "1", "24", "Tim Fulfillment"],
  ["KUSTOM-KARGO", "Kargo Khusus / Oversized", "Khusus", "Pengiriman barang besar, berat, atau bernilai tinggi dengan penanganan khusus", "Negosiasi", "IDR", "5", "120", "Tim Operasional"],
  ["INS-KARGO", "Asuransi Kargo", "Asuransi", "Perlindungan asuransi untuk kiriman dengan nilai deklarasi, premi 0,2–0,5% dari nilai barang", "Negosiasi", "IDR", "0", "24", "Tim Keuangan"],
];

for (const [code, name, cat, desc, price, curr, days, sla, team] of services) {
  await run(`Service: ${code}`, `
    INSERT INTO service_catalog (company_id, service_code, service_name, category, description, base_price, currency, estimated_days, sla_hours, suggested_team, is_active)
    VALUES ('default', $1, $2, $3, $4, $5, $6, $7, $8, $9, true)
  `, [code, name, cat, desc, price, curr, days, sla, team]);
}

// ─────────────────────────────────────────────────────────────────────────────
// D. DATA TEMPLATES + FIELDS  — 5 template isian data
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Data Templates ─────────────────────────────────");

const dataTemplates = [
  {
    code: "cek_status_pengiriman", name: "Form Cek Status Pengiriman", category: "Operasional",
    desc: "Data yang dibutuhkan untuk melacak status pengiriman pelanggan",
    fields: [
      { name: "nomor_resi", label: "Nomor Resi / AWB", type: "text", required: true, order: 1, help: "Nomor resi pengiriman dari surat jalan", sample: "JKT-SBY-2024-001" },
      { name: "nama_pengirim", label: "Nama Pengirim", type: "text", required: false, order: 2, help: "Nama pengirim jika nomor resi tidak diketahui", sample: "PT Maju Bersama" },
      { name: "tanggal_kirim", label: "Tanggal Pengiriman", type: "date", required: false, order: 3, help: "Perkiraan tanggal barang dikirim", sample: "2024-01-15" },
      { name: "tujuan", label: "Kota Tujuan", type: "text", required: false, order: 4, help: "Kota tujuan pengiriman", sample: "Surabaya" },
    ],
  },
  {
    code: "komplain_pengiriman", name: "Form Komplain Pengiriman", category: "Komplain",
    desc: "Data yang dibutuhkan untuk menangani komplain pengiriman",
    fields: [
      { name: "nomor_resi", label: "Nomor Resi / AWB", type: "text", required: true, order: 1, help: "Nomor resi pengiriman yang dikomplain", sample: "JKT-SBY-2024-001" },
      { name: "jenis_komplain", label: "Jenis Komplain", type: "select", required: true, order: 2, help: "Pilih jenis masalah: rusak/hilang/telat/salah kirim", sample: "Barang rusak" },
      { name: "deskripsi_masalah", label: "Deskripsi Masalah", type: "textarea", required: true, order: 3, help: "Jelaskan masalah secara detail", sample: "Barang sampai dalam kondisi pecah" },
      { name: "nilai_barang", label: "Nilai Barang (Rp)", type: "number", required: true, order: 4, help: "Estimasi nilai barang yang bermasalah", sample: "5000000" },
      { name: "foto_bukti", label: "Foto Bukti Kerusakan", type: "file", required: false, order: 5, help: "Upload foto kondisi barang/kemasan", sample: "" },
    ],
  },
  {
    code: "permintaan_pickup", name: "Form Permintaan Pickup", category: "Operasional",
    desc: "Data yang dibutuhkan untuk menjadwalkan pickup barang",
    fields: [
      { name: "nama_pengirim", label: "Nama Pengirim / Perusahaan", type: "text", required: true, order: 1, help: "Nama lengkap atau perusahaan pengirim", sample: "PT Sukses Makmur" },
      { name: "alamat_pickup", label: "Alamat Pickup", type: "textarea", required: true, order: 2, help: "Alamat lengkap lokasi pickup termasuk patokan", sample: "Jl. Industri No. 12, Cikande, Serang" },
      { name: "tanggal_pickup", label: "Tanggal Pickup", type: "date", required: true, order: 3, help: "Kapan barang siap dijemput", sample: "2024-01-16" },
      { name: "waktu_pickup", label: "Jam Pickup", type: "text", required: true, order: 4, help: "Jam operasional siap pickup", sample: "09:00 - 15:00 WIB" },
      { name: "jenis_barang", label: "Jenis / Deskripsi Barang", type: "text", required: true, order: 5, help: "Deskripsi singkat barang yang akan dikirim", sample: "Spare part mesin, 10 koli" },
      { name: "berat_estimasi", label: "Estimasi Berat (kg)", type: "number", required: true, order: 6, help: "Perkiraan total berat barang", sample: "250" },
      { name: "kota_tujuan", label: "Kota Tujuan", type: "text", required: true, order: 7, help: "Kota tujuan pengiriman akhir", sample: "Surabaya" },
      { name: "kontak_pic", label: "Nama & No. HP PIC", type: "text", required: true, order: 8, help: "Nama dan nomor HP yang bisa dihubungi di lokasi pickup", sample: "Budi - 08123456789" },
    ],
  },
  {
    code: "permintaan_penawaran", name: "Form Permintaan Penawaran Harga", category: "Komersial",
    desc: "Data yang dibutuhkan untuk menyiapkan quotation pengiriman",
    fields: [
      { name: "nama_perusahaan", label: "Nama Perusahaan", type: "text", required: true, order: 1, help: "Nama perusahaan pemohon penawaran", sample: "CV Karya Abadi" },
      { name: "kota_asal", label: "Kota Asal", type: "text", required: true, order: 2, help: "Kota asal pengiriman", sample: "Jakarta" },
      { name: "kota_tujuan", label: "Kota Tujuan", type: "text", required: true, order: 3, help: "Kota tujuan pengiriman", sample: "Surabaya" },
      { name: "jenis_barang", label: "Jenis Barang", type: "text", required: true, order: 4, help: "Jenis atau kategori barang", sample: "Elektronik konsumen" },
      { name: "berat_volume", label: "Berat / Dimensi", type: "text", required: true, order: 5, help: "Total berat (kg) atau dimensi (cm) jika barang besar", sample: "500 kg / 120x80x100 cm" },
      { name: "frekuensi", label: "Frekuensi Pengiriman", type: "text", required: false, order: 6, help: "Seberapa sering pengiriman dilakukan", sample: "2x per minggu" },
      { name: "layanan_diinginkan", label: "Jenis Layanan", type: "select", required: false, order: 7, help: "Regular / Express / Container / Cold Chain", sample: "Regular" },
    ],
  },
  {
    code: "klaim_asuransi", name: "Form Klaim Asuransi / Ganti Rugi", category: "Keuangan",
    desc: "Data yang dibutuhkan untuk memproses klaim asuransi barang",
    fields: [
      { name: "nomor_resi", label: "Nomor Resi / AWB", type: "text", required: true, order: 1, help: "Nomor resi kiriman yang diklaim", sample: "JKT-SBY-2024-001" },
      { name: "nilai_deklarasi", label: "Nilai Deklarasi Barang (Rp)", type: "number", required: true, order: 2, help: "Nilai barang yang dideklarasikan saat pengiriman", sample: "10000000" },
      { name: "jenis_kerusakan", label: "Jenis Kerugian", type: "select", required: true, order: 3, help: "Pilih: Rusak / Hilang / Kekurangan / Kontaminasi", sample: "Rusak" },
      { name: "deskripsi_kejadian", label: "Deskripsi Kejadian", type: "textarea", required: true, order: 4, help: "Jelaskan secara detail kronologi kejadian", sample: "Barang diterima dalam kondisi kemasan hancur dan isi rusak" },
      { name: "nilai_klaim", label: "Nilai Klaim yang Diajukan (Rp)", type: "number", required: true, order: 5, help: "Jumlah ganti rugi yang diminta", sample: "8000000" },
      { name: "nomor_rekening", label: "Nomor Rekening Bank", type: "text", required: true, order: 6, help: "Rekening tujuan pembayaran klaim", sample: "BCA - 1234567890 a.n. Budi Santoso" },
    ],
  },
];

for (const tmpl of dataTemplates) {
  const res = await run(`Data Template: ${tmpl.name}`, `
    INSERT INTO data_templates (company_id, intent_code, name, category, description, is_active)
    VALUES ('default', $1, $2, $3, $4, true)
    RETURNING id
  `, [tmpl.code, tmpl.name, tmpl.category, tmpl.desc]);
  const templateId = res.rows[0].id;

  for (const f of tmpl.fields) {
    await run(`  Field: ${f.label}`, `
      INSERT INTO data_template_fields (template_id, field_name, field_label, field_type, is_required, sort_order, help_text, sample_value)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [templateId, f.name, f.label, f.type, f.required, f.order, f.help, f.sample]);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// E. DOCUMENT TEMPLATES + FIELDS  — dokumen yang diperlukan per intent
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Document Templates ─────────────────────────────");

const docTemplates = [
  {
    code: "komplain_pengiriman", name: "Dokumen Komplain Pengiriman", category: "Komplain",
    desc: "Dokumen pendukung yang diperlukan untuk memproses komplain pengiriman",
    docs: [
      { name: "Foto Kondisi Barang", type: "image", required: true, order: 1, desc: "Foto jelas kondisi barang dan kemasan saat diterima", example: "foto_kerusakan_*.jpg" },
      { name: "Foto Label Pengiriman", type: "image", required: true, order: 2, desc: "Foto label pengiriman / resi yang masih menempel di paket", example: "foto_label_resi.jpg" },
      { name: "Surat Jalan / Resi Asli", type: "document", required: false, order: 3, desc: "Scan atau foto surat jalan / bukti resi pengiriman", example: "surat_jalan.pdf" },
    ],
  },
  {
    code: "klaim_asuransi", name: "Dokumen Klaim Asuransi", category: "Keuangan",
    desc: "Dokumen yang wajib dilampirkan untuk pengajuan klaim asuransi kargo",
    docs: [
      { name: "Surat Klaim Resmi", type: "document", required: true, order: 1, desc: "Surat klaim tertulis dengan kop perusahaan dan tanda tangan", example: "surat_klaim_resmi.pdf" },
      { name: "Invoice / Faktur Barang", type: "document", required: true, order: 2, desc: "Invoice atau faktur pembelian barang yang diklaim (menunjukkan nilai barang)", example: "invoice_barang.pdf" },
      { name: "Foto Bukti Kerusakan", type: "image", required: true, order: 3, desc: "Foto detail kerusakan atau kondisi saat barang diterima", example: "bukti_kerusakan_*.jpg" },
      { name: "Berita Acara Kerusakan", type: "document", required: false, order: 4, desc: "Berita acara serah terima yang mencantumkan kondisi barang rusak", example: "berita_acara.pdf" },
      { name: "Surat Jalan / AWB Asli", type: "document", required: true, order: 5, desc: "Salinan surat jalan / Air Waybill asli", example: "awb_surat_jalan.pdf" },
    ],
  },
  {
    code: "permintaan_pickup", name: "Dokumen Pendukung Pickup", category: "Operasional",
    desc: "Dokumen yang perlu disiapkan saat pickup oleh kurir",
    docs: [
      { name: "Packing List", type: "document", required: true, order: 1, desc: "Daftar isi barang lengkap dengan jumlah dan berat per item", example: "packing_list.xlsx" },
      { name: "Surat Jalan Internal", type: "document", required: false, order: 2, desc: "Surat jalan dari pengirim jika sudah disiapkan", example: "surat_jalan_internal.pdf" },
    ],
  },
  {
    code: "pendaftaran_pelanggan", name: "Dokumen Registrasi Pelanggan", category: "Komersial",
    desc: "Dokumen yang diperlukan untuk proses pendaftaran pelanggan baru",
    docs: [
      { name: "NIB / SIUP", type: "document", required: true, order: 1, desc: "Nomor Induk Berusaha atau Surat Izin Usaha Perdagangan", example: "nib_siup.pdf" },
      { name: "KTP Penanggung Jawab", type: "identity", required: true, order: 2, desc: "KTP direktur atau penanggung jawab perusahaan", example: "ktp_pic.jpg" },
      { name: "NPWP Perusahaan", type: "document", required: false, order: 3, desc: "NPWP perusahaan untuk keperluan penagihan invoice resmi", example: "npwp.pdf" },
      { name: "Akta Pendirian Perusahaan", type: "document", required: false, order: 4, desc: "Akta pendirian / perubahan terakhir (untuk kontrak korporat)", example: "akta_perusahaan.pdf" },
    ],
  },
  {
    code: "permintaan_vendor", name: "Dokumen Pendaftaran Vendor/Mitra", category: "Komersial",
    desc: "Dokumen yang diperlukan untuk evaluasi calon vendor atau mitra",
    docs: [
      { name: "Company Profile", type: "document", required: true, order: 1, desc: "Profil perusahaan mencakup kapasitas, area layanan, dan pengalaman", example: "company_profile.pdf" },
      { name: "NIB / SIUP Vendor", type: "document", required: true, order: 2, desc: "Izin usaha yang masih berlaku", example: "nib_vendor.pdf" },
      { name: "Daftar Armada / Kapasitas", type: "document", required: false, order: 3, desc: "Daftar kendaraan/armada atau kapasitas layanan", example: "daftar_armada.pdf" },
      { name: "Referensi Klien", type: "document", required: false, order: 4, desc: "Surat referensi dari klien sebelumnya", example: "referensi_klien.pdf" },
    ],
  },
];

for (const tmpl of docTemplates) {
  const res = await run(`Doc Template: ${tmpl.name}`, `
    INSERT INTO document_templates (company_id, intent_code, name, category, description, is_active)
    VALUES ('default', $1, $2, $3, $4, true)
    RETURNING id
  `, [tmpl.code, tmpl.name, tmpl.category, tmpl.desc]);
  const templateId = res.rows[0].id;

  for (const d of tmpl.docs) {
    await run(`  Doc: ${d.name}`, `
      INSERT INTO document_template_fields (template_id, document_name, document_type, is_required, sort_order, description, example_file_description)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [templateId, d.name, d.type, d.required, d.order, d.desc, d.example]);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Verifikasi Final ───────────────────────────────");
const counts = await query(`
  SELECT
    (SELECT COUNT(*) FROM intent_master WHERE company_id = 'default') AS intents,
    (SELECT COUNT(*) FROM keyword_rules WHERE company_id = 'default') AS keywords,
    (SELECT COUNT(*) FROM service_catalog WHERE company_id = 'default') AS services,
    (SELECT COUNT(*) FROM data_templates WHERE company_id = 'default') AS data_templates,
    (SELECT COUNT(*) FROM data_template_fields f JOIN data_templates t ON t.id = f.template_id WHERE t.company_id = 'default') AS data_fields,
    (SELECT COUNT(*) FROM document_templates WHERE company_id = 'default') AS doc_templates,
    (SELECT COUNT(*) FROM document_template_fields f JOIN document_templates t ON t.id = f.template_id WHERE t.company_id = 'default') AS doc_fields
`);
const c = counts[0];
console.log(`
✅ Knowledge Base seed selesai!

  Intent Master     : ${c.intents} intent
  Keyword Rules     : ${c.keywords} keyword
  Service Catalog   : ${c.services} layanan
  Data Templates    : ${c.data_templates} template (${c.data_fields} fields)
  Doc Templates     : ${c.doc_templates} template (${c.doc_fields} fields)
`);

await pool.end();
