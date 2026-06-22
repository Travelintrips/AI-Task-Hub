/**
 * SPRINT 8E — Service Coverage Expansion
 * Increases KB coverage from ~23% → ≥80%
 *
 * Adds:
 *  - 18 new intents to intent_master
 *  - 180+ keyword rules
 *  - 10 new service_catalog entries
 *  - 26 new data_templates (18 new + 8 existing intents lacking templates)
 *  - 200+ data_template_fields
 *  - 18 new document_templates
 *  - 70+ document_template_fields
 *
 * Idempotent: safe to re-run (DELETE+INSERT for intents/keywords, check before insert for templates)
 *
 * Run: node scripts/seed-sprint8e-service-coverage.mjs
 */

import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({ connectionString: process.env.SUPABASE_DATABASE_URL });
const C = 'default'; // company_id

// ── Helpers ───────────────────────────────────────────────────────────────────

async function insertIntent({ code, name, category, description, suggestedPriority = 'medium', slaHours = 48 }) {
  await pool.query(`DELETE FROM intent_master WHERE company_id=$1 AND intent_code=$2`, [C, code]);
  await pool.query(`
    INSERT INTO intent_master (company_id, intent_code, intent_name, category, description,
      suggested_category, suggested_division, suggested_priority, sla_hours, is_active, created_at, updated_at)
    VALUES ($1,$2,$3,$4,$5,$4,'Operations',$6,$7,true,NOW(),NOW())
  `, [C, code, name, category, description, suggestedPriority, slaHours]);
}

async function insertKeywords(intentCode, keywords) {
  await pool.query(`DELETE FROM keyword_rules WHERE company_id=$1 AND intent_code=$2`, [C, intentCode]);
  for (const kw of keywords) {
    await pool.query(`
      INSERT INTO keyword_rules (company_id, keyword, intent_code, weight, is_active, created_at)
      VALUES ($1,$2,$3,1.0,true,NOW())
    `, [C, kw, intentCode]);
  }
}

async function insertServiceCatalog({ code, name, category, description, slaHours = '48', team = 'Operasional' }) {
  const { rows } = await pool.query(`SELECT id FROM service_catalog WHERE company_id=$1 AND service_code=$2`, [C, code]);
  if (rows.length) return;
  await pool.query(`
    INSERT INTO service_catalog (company_id, service_code, service_name, category, description,
      currency, sla_hours, is_active, suggested_team, created_at, updated_at)
    VALUES ($1,$2,$3,$4,$5,'IDR',$6,true,$7,NOW(),NOW())
  `, [C, code, name, category, description, slaHours, team]);
}

async function insertDataTemplate({ intentCode, name, category, description, intakeMode = 'conversation', useMiniForm = false, miniFormType = null }) {
  const { rows } = await pool.query(`SELECT id FROM data_templates WHERE company_id=$1 AND intent_code=$2`, [C, intentCode]);
  if (rows.length) {
    // Update intake_mode if missing
    await pool.query(`UPDATE data_templates SET intake_mode=$1, updated_at=NOW() WHERE company_id=$2 AND intent_code=$3 AND (intake_mode IS NULL OR intake_mode='')`, [intakeMode, C, intentCode]);
    return rows[0].id;
  }
  const { rows: r } = await pool.query(`
    INSERT INTO data_templates (company_id, name, category, description, is_active,
      intent_code, use_mini_form, mini_form_type, intake_mode, created_at, updated_at)
    VALUES ($1,$2,$3,$4,true,$5,$6,$7,$8,NOW(),NOW()) RETURNING id
  `, [C, name, category, description, intentCode, useMiniForm, miniFormType, intakeMode]);
  return r[0].id;
}

async function insertFields(templateId, fields) {
  // Remove existing fields for this template
  await pool.query(`DELETE FROM data_template_fields WHERE template_id=$1`, [templateId]);
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    await pool.query(`
      INSERT INTO data_template_fields (template_id, field_name, field_label, field_type,
        is_required, sort_order, help_text, sample_value, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
    `, [templateId, f.name, f.label, f.type ?? 'text', f.required ?? false, i + 1, f.help ?? null, f.sample ?? null]);
  }
}

async function insertDocTemplate({ intentCode, name, category, description }) {
  const { rows } = await pool.query(`SELECT id FROM document_templates WHERE company_id=$1 AND intent_code=$2`, [C, intentCode]);
  if (rows.length) return rows[0].id;
  const { rows: r } = await pool.query(`
    INSERT INTO document_templates (company_id, name, category, description, is_active, intent_code, created_at, updated_at)
    VALUES ($1,$2,$3,$4,true,$5,NOW(),NOW()) RETURNING id
  `, [C, name, category, description, intentCode]);
  return r[0].id;
}

async function insertDocFields(templateId, docs) {
  await pool.query(`DELETE FROM document_template_fields WHERE template_id=$1`, [templateId]);
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    await pool.query(`
      INSERT INTO document_template_fields (template_id, document_name, document_type, is_required,
        description, sort_order, example_file_description, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
    `, [templateId, d.name, d.type ?? 'document', d.required ?? false, d.desc ?? null, i + 1, d.example ?? null]);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  console.log('=== Sprint 8E Service Coverage Expansion ===\n');

  // ── PHASE A: New Intents ────────────────────────────────────────────────────

  console.log('Phase A: Adding new intents...');

  const newIntents = [
    { code: 'trucking_inquiry',       name: 'Permintaan Layanan Trucking',              category: 'Logistik',    description: 'Permintaan layanan trucking / pengiriman darat', suggestedPriority: 'medium', slaHours: 24 },
    { code: 'air_freight_inquiry',    name: 'Permintaan Pengiriman Udara',              category: 'Logistik',    description: 'Permintaan layanan pengiriman via udara / cargo pesawat', suggestedPriority: 'high', slaHours: 12 },
    { code: 'sea_freight_inquiry',    name: 'Permintaan Pengiriman Laut',               category: 'Logistik',    description: 'Permintaan layanan pengiriman via kapal / FCL / LCL', suggestedPriority: 'medium', slaHours: 48 },
    { code: 'customs_clearance',      name: 'Permintaan Bea Cukai / Customs Clearance', category: 'Logistik',    description: 'Permintaan pengurusan bea cukai import/export', suggestedPriority: 'high', slaHours: 24 },
    { code: 'ppjk_service',          name: 'Permintaan Layanan PPJK',                  category: 'Logistik',    description: 'Permintaan layanan Pengusaha Pengurusan Jasa Kepabeanan', suggestedPriority: 'high', slaHours: 24 },
    { code: 'warehousing_request',   name: 'Permintaan Layanan Gudang / Warehousing',  category: 'Logistik',    description: 'Permintaan layanan penyimpanan / pergudangan', suggestedPriority: 'medium', slaHours: 48 },
    { code: 'import_inquiry',        name: 'Permintaan Layanan Import',                category: 'Logistik',    description: 'Permintaan pengurusan importasi barang dari luar negeri', suggestedPriority: 'high', slaHours: 24 },
    { code: 'export_inquiry',        name: 'Permintaan Layanan Export',                category: 'Logistik',    description: 'Permintaan pengurusan ekspor barang ke luar negeri', suggestedPriority: 'high', slaHours: 24 },
    { code: 'dg_cargo',              name: 'Pengiriman Barang Berbahaya (DG Cargo)',   category: 'Logistik',    description: 'Permintaan pengiriman barang berbahaya sesuai regulasi IATA/IMDG', suggestedPriority: 'high', slaHours: 12 },
    { code: 'live_animal_cargo',     name: 'Pengiriman Hewan Hidup',                   category: 'Logistik',    description: 'Permintaan pengiriman hewan hidup / live animal', suggestedPriority: 'high', slaHours: 12 },
    { code: 'cold_chain',            name: 'Pengiriman Cold Chain / Rantai Dingin',    category: 'Logistik',    description: 'Permintaan pengiriman produk yang memerlukan kontrol suhu', suggestedPriority: 'high', slaHours: 12 },
    { code: 'project_cargo',         name: 'Pengiriman Project Cargo',                 category: 'Logistik',    description: 'Permintaan pengiriman kargo proyek / oversize / heavy lift', suggestedPriority: 'high', slaHours: 24 },
    { code: 'fleet_repair',          name: 'Permintaan Perbaikan Kendaraan',           category: 'Operasional', description: 'Laporan kerusakan dan permintaan servis/perbaikan armada', suggestedPriority: 'high', slaHours: 8 },
    { code: 'fuel_expense',          name: 'Laporan Pengeluaran BBM',                  category: 'Operasional', description: 'Laporan pengisian BBM dan pengeluaran bahan bakar kendaraan', suggestedPriority: 'medium', slaHours: 48 },
    { code: 'tire_issue',            name: 'Laporan Masalah Ban Kendaraan',            category: 'Operasional', description: 'Laporan masalah ban (bocor, aus, ganti) pada kendaraan operasional', suggestedPriority: 'high', slaHours: 8 },
    { code: 'damaged_goods_complaint', name: 'Komplain Kerusakan Barang',             category: 'Komplain',    description: 'Komplain barang rusak, cacat, atau tidak sesuai saat diterima', suggestedPriority: 'high', slaHours: 4 },
    { code: 'delivery_delay_complaint', name: 'Komplain Keterlambatan Pengiriman',    category: 'Komplain',    description: 'Komplain pengiriman yang terlambat dari estimasi', suggestedPriority: 'high', slaHours: 4 },
    { code: 'customer_data_update',  name: 'Perbarui Data Pelanggan',                 category: 'Administrasi',description: 'Permintaan update data profil, kontak, atau alamat pelanggan', suggestedPriority: 'low', slaHours: 72 },
  ];

  for (const intent of newIntents) {
    await insertIntent(intent);
    console.log(`  ✓ Intent: ${intent.code}`);
  }

  // ── PHASE B: Keyword Rules ───────────────────────────────────────────────────

  console.log('\nPhase B: Adding keyword rules...');

  const keywordMap = {
    trucking_inquiry: ['trucking', 'truck', 'truk', 'kirim darat', 'angkut darat', 'muatan truk', 'colt diesel', 'fuso', 'wingbox', 'engkel', 'tronton', 'arm roll', 'lowbed', 'flatbed', 'kendaraan besar', 'muat mobil', 'pengiriman darat', 'sewa truk', 'hire truk', 'kirim lewat darat'],
    air_freight_inquiry: ['air freight', 'cargo udara', 'kargo pesawat', 'kirim pesawat', 'via udara', 'angkut udara', 'airport', 'bandara', 'AWB', 'airway bill', 'cargo express', 'kirim cepat pesawat', 'air cargo', 'charter pesawat', 'pengiriman udara', 'ekspres udara', 'kiriman udara', 'door to airport', 'airport to door'],
    sea_freight_inquiry: ['sea freight', 'kapal', 'via kapal', 'cargo laut', 'kirim kapal', 'container', 'kontainer', 'FCL', 'LCL', 'pelabuhan', 'port', 'shipping', 'OOCL', 'Maersk', 'Evergreen', 'bill of lading', 'BL', 'stuffing', 'unstuffing', 'CFS', 'pengiriman laut'],
    customs_clearance: ['customs', 'bea cukai', 'clearance', 'kepabeanan', 'pengurusan bea cukai', 'custom clearance', 'BC', 'kantor pabean', 'clearance import', 'clearance export', 'urus cukai', 'dokumen pabean', 'PIB', 'PEB', 'lartas'],
    ppjk_service: ['PPJK', 'pengurusan jasa kepabeanan', 'jasa kepabeanan', 'freight forwarder', 'forwarder', 'ekspedisi muatan kapal laut', 'EMKL', 'EMKU', 'freight forwarding'],
    warehousing_request: ['gudang', 'warehouse', 'warehousing', 'sewa gudang', 'titip barang', 'simpan barang', 'stok gudang', 'inbound', 'outbound', 'WMS', 'fulfillment center', 'pick and pack', 'cross dock', 'cold storage', 'rak gudang', 'penyimpanan barang'],
    import_inquiry: ['import', 'importasi', 'impor', 'barang impor', 'customs import', 'bea masuk', 'PIB', 'BPIB', 'larangan impor', 'HS code', 'harmonized system', 'bea masuk barang', 'NIK importir', 'API import', 'PPJK import'],
    export_inquiry: ['export', 'ekspor', 'barang ekspor', 'customs export', 'PEB', 'pemberitahuan ekspor barang', 'bea keluar', 'dokumen ekspor', 'certificate of origin', 'COO', 'SKA', 'surat keterangan asal', 'LNSW', 'inaportnet'],
    dg_cargo: ['dangerous goods', 'DG', 'barang berbahaya', 'hazmat', 'hazardous material', 'bahan kimia', 'kimia berbahaya', 'explosive', 'flammable', 'corrosive', 'IATA DG', 'IMDG', 'UN number', 'MSDS', 'safety data sheet', 'restricted goods', 'barang terlarang'],
    live_animal_cargo: ['hewan hidup', 'live animal', 'kirim hewan', 'angkut hewan', 'ternak', 'unggas', 'livestock', 'binatang', 'satwa', 'hewan peliharaan', 'kirim anjing', 'kirim kucing', 'kirim burung', 'CITES', 'sertifikat hewan', 'karantina hewan'],
    cold_chain: ['cold chain', 'rantai dingin', 'suhu dingin', 'cold storage', 'freezer', 'refrigerated', 'reefeer', 'chiller', 'frozen', 'beku', 'produk segar', 'obat obatan', 'vaksin', 'farmasi dingin', 'temperature controlled', 'minus derajat', 'cold truck'],
    project_cargo: ['project cargo', 'over dimension', 'oversize', 'heavy lift', 'kargo besar', 'kargo berat', 'over gauge', 'OOG', 'break bulk', 'mesin besar', 'alat berat', 'heavy equipment', 'prefab', 'offshore', 'engineering cargo'],
    fleet_repair: ['servis', 'service kendaraan', 'perbaikan', 'kendaraan rusak', 'mogok', 'mesin rusak', 'ban bocor', 'accident', 'kecelakaan', 'derek', 'towing', 'spare part', 'bengkel', 'AC rusak', 'rem blong', 'oli mesin', 'turun mesin', 'kendaraan bermasalah'],
    fuel_expense: ['BBM', 'bahan bakar', 'solar', 'bensin', 'pertamax', 'pengisian BBM', 'isi bensin', 'isi solar', 'laporan BBM', 'reimburs BBM', 'bon BBM', 'konsumsi BBM', 'fuel', 'SPBU', 'pom bensin'],
    tire_issue: ['ban', 'tyre', 'tire', 'ban bocor', 'ban kempes', 'ganti ban', 'ban aus', 'ban retak', 'ban sobek', 'vulkanisir', 'tambah angin', 'tekanan ban', 'ban cadangan', 'spare ban', 'velg'],
    damaged_goods_complaint: ['barang rusak', 'barang pecah', 'barang hancur', 'barang cacat', 'barang tidak sesuai', 'klaim kerusakan', 'komplain rusak', 'kondisi barang', 'barang lecet', 'packingnya rusak', 'isi berkurang', 'hilang sebagian', 'not in good condition', 'damaged'],
    delivery_delay_complaint: ['terlambat', 'delay', 'belum sampai', 'mana kiriman', 'pengiriman lama', 'kapan sampai', 'estimasi lewat', 'sudah lewat tanggal', 'mana barang saya', 'tracking tidak update', 'stuck', 'kiriman tertahan', 'belum terima', 'lambat sekali'],
    customer_data_update: ['update data', 'ganti nomor', 'ganti alamat', 'ubah data', 'perbarui data', 'edit profil', 'ganti email', 'alamat baru', 'nomor baru', 'kontak berubah', 'pindah kantor', 'revisi data', 'koreksi data'],
  };

  for (const [code, keywords] of Object.entries(keywordMap)) {
    await insertKeywords(code, keywords);
    console.log(`  ✓ Keywords: ${code} (${keywords.length})`);
  }

  // ── PHASE C: Service Catalog ─────────────────────────────────────────────────

  console.log('\nPhase C: Adding service catalog entries...');

  const newServices = [
    { code: 'AIR-INT',    name: 'Air Freight International',       category: 'Pengiriman Udara',   description: 'Pengiriman cargo udara internasional via maskapai kargo', slaHours: '12', team: 'Air Freight' },
    { code: 'AIR-DOM',    name: 'Air Freight Domestik',            category: 'Pengiriman Udara',   description: 'Pengiriman cargo udara domestik antar kota di Indonesia', slaHours: '24', team: 'Air Freight' },
    { code: 'SEA-FCL',    name: 'Sea Freight FCL (Full Container)', category: 'Pengiriman Laut',    description: 'Pengiriman full container load FCL 20ft / 40ft', slaHours: '72', team: 'Sea Freight' },
    { code: 'CUSTOMS-IMP',name: 'Customs Clearance Import',        category: 'Bea Cukai',          description: 'Pengurusan bea cukai dan PIB untuk importasi', slaHours: '24', team: 'Customs' },
    { code: 'CUSTOMS-EXP',name: 'Customs Clearance Export',        category: 'Bea Cukai',          description: 'Pengurusan PEB dan bea cukai untuk ekspor', slaHours: '24', team: 'Customs' },
    { code: 'PPJK-FULL',  name: 'PPJK Full Service',              category: 'Kepabeanan',          description: 'Pengurusan kepabeanan end-to-end termasuk HS classification', slaHours: '24', team: 'Customs' },
    { code: 'WH-REGULER', name: 'Warehousing Regular',             category: 'Pergudangan',         description: 'Layanan gudang reguler termasuk inbound, outbound, stocking', slaHours: '48', team: 'Gudang' },
    { code: 'DG-SPECIAL', name: 'Dangerous Goods Handling',        category: 'Khusus',              description: 'Penanganan dan pengiriman barang berbahaya sesuai regulasi', slaHours: '24', team: 'DG Specialist' },
    { code: 'LIVE-ANIMAL',name: 'Live Animal Transport',           category: 'Khusus',              description: 'Transportasi hewan hidup dengan dokumen karantina', slaHours: '12', team: 'Live Animal' },
    { code: 'PROJECT-CGO',name: 'Project Cargo Handling',          category: 'Khusus',              description: 'Pengiriman kargo proyek / heavy lift / oversize', slaHours: '48', team: 'Project Cargo' },
  ];

  for (const svc of newServices) {
    await insertServiceCatalog(svc);
    console.log(`  ✓ Service: ${svc.code}`);
  }

  // ── PHASE D: Data Templates + Fields ────────────────────────────────────────

  console.log('\nPhase D: Adding data templates and fields...');

  // ---- 1. Trucking Inquiry ----
  const tTrucking = await insertDataTemplate({ intentCode: 'trucking_inquiry', name: 'Form Permintaan Trucking', category: 'Logistik', description: 'Formulir pengajuan layanan pengiriman darat/trucking', intakeMode: 'conversation' });
  await insertFields(tTrucking, [
    { name: 'nama_pengirim',       label: 'Nama Pengirim / PIC',        type: 'text',     required: true,  help: 'Nama lengkap atau nama perusahaan pengirim', sample: 'PT. Maju Jaya' },
    { name: 'nomor_telepon',       label: 'Nomor Telepon PIC',          type: 'text',     required: true,  help: 'Nomor HP yang bisa dihubungi', sample: '0812xxxx' },
    { name: 'alamat_muat',         label: 'Alamat / Lokasi Muat',       type: 'textarea', required: true,  help: 'Alamat lengkap tempat barang diambil' },
    { name: 'kota_tujuan',         label: 'Kota Tujuan',                type: 'text',     required: true,  help: 'Kota atau daerah tujuan pengiriman', sample: 'Surabaya' },
    { name: 'alamat_tujuan',       label: 'Alamat Tujuan (Opsional)',   type: 'textarea', required: false, help: 'Alamat lengkap penerima' },
    { name: 'jenis_barang',        label: 'Jenis / Deskripsi Barang',   type: 'text',     required: true,  help: 'Contoh: elektronik, furnitur, bahan makanan', sample: 'Perabot rumah tangga' },
    { name: 'berat_kg',            label: 'Berat Estimasi (kg)',         type: 'number',   required: true,  help: 'Berat total muatan dalam kilogram', sample: '1500' },
    { name: 'volume_cbm',          label: 'Volume Estimasi (CBM)',       type: 'number',   required: false, help: 'Volume dalam kubik meter (p×l×t/1.000.000)', sample: '3.5' },
    { name: 'jenis_kendaraan',     label: 'Jenis Kendaraan Dibutuhkan', type: 'select',   required: false, help: 'Pilih jenis truk yang dibutuhkan', sample: 'Engkel Box' },
    { name: 'tanggal_muat',        label: 'Tanggal Muat Rencanakan',    type: 'date',     required: true,  help: 'Kapan barang siap diambil' },
    { name: 'catatan_khusus',      label: 'Catatan / Instruksi Khusus', type: 'textarea', required: false, help: 'Instruksi bongkar muat, kondisi barang, dll.' },
  ]);
  console.log('  ✓ Template: trucking_inquiry');

  // ---- 2. Air Freight ----
  const tAir = await insertDataTemplate({ intentCode: 'air_freight_inquiry', name: 'Form Permintaan Air Freight', category: 'Logistik', description: 'Formulir pengajuan pengiriman cargo udara', intakeMode: 'conversation' });
  await insertFields(tAir, [
    { name: 'nama_pengirim',       label: 'Nama Shipper / Pengirim',    type: 'text',     required: true,  sample: 'PT. Ekspor Nusantara' },
    { name: 'nomor_telepon',       label: 'Nomor Telepon',              type: 'text',     required: true,  sample: '0812xxxx' },
    { name: 'bandara_asal',        label: 'Bandara Asal (Origin)',      type: 'text',     required: true,  help: 'Kode IATA bandara asal', sample: 'CGK (Jakarta)' },
    { name: 'bandara_tujuan',      label: 'Bandara Tujuan (Dest)',      type: 'text',     required: true,  help: 'Kode IATA bandara tujuan', sample: 'SIN (Singapore)' },
    { name: 'deskripsi_barang',    label: 'Deskripsi Kargo',            type: 'text',     required: true,  sample: 'Mesin elektronik' },
    { name: 'berat_kg',            label: 'Berat Kotor (kg)',            type: 'number',   required: true,  sample: '250' },
    { name: 'dimensi',             label: 'Dimensi (p×l×t cm)',         type: 'text',     required: false, sample: '80x60x70' },
    { name: 'jumlah_koli',         label: 'Jumlah Koli / Pieces',       type: 'number',   required: true,  sample: '5' },
    { name: 'nilai_barang',        label: 'Nilai Barang (USD/IDR)',      type: 'number',   required: false, sample: '5000' },
    { name: 'tanggal_siap',        label: 'Tanggal Cargo Siap',         type: 'date',     required: true  },
    { name: 'tipe_layanan',        label: 'Tipe Layanan',               type: 'select',   required: false, help: 'Economy / Express / Charter', sample: 'Economy' },
    { name: 'hs_code',             label: 'HS Code (Opsional)',          type: 'text',     required: false, sample: '8471.30.00' },
    { name: 'incoterm',            label: 'Incoterm',                   type: 'select',   required: false, sample: 'EXW' },
    { name: 'catatan',             label: 'Instruksi Khusus',           type: 'textarea', required: false },
  ]);
  console.log('  ✓ Template: air_freight_inquiry');

  // ---- 3. Sea Freight ----
  const tSea = await insertDataTemplate({ intentCode: 'sea_freight_inquiry', name: 'Form Permintaan Sea Freight', category: 'Logistik', description: 'Formulir pengajuan pengiriman kargo laut FCL/LCL', intakeMode: 'conversation' });
  await insertFields(tSea, [
    { name: 'nama_shipper',        label: 'Nama Shipper',               type: 'text',     required: true,  sample: 'PT. Global Shipping' },
    { name: 'nomor_telepon',       label: 'Nomor Telepon',              type: 'text',     required: true,  sample: '0812xxxx' },
    { name: 'pol',                 label: 'Port of Loading (POL)',      type: 'text',     required: true,  help: 'Pelabuhan muat', sample: 'Tanjung Priok, Jakarta' },
    { name: 'pod',                 label: 'Port of Discharge (POD)',    type: 'text',     required: true,  help: 'Pelabuhan bongkar', sample: 'Singapore' },
    { name: 'tipe_kontainer',      label: 'Tipe Container',             type: 'select',   required: true,  help: 'FCL 20ft / FCL 40ft / LCL', sample: 'FCL 20ft' },
    { name: 'jumlah_kontainer',    label: 'Jumlah Container (FCL)',     type: 'number',   required: false, sample: '2' },
    { name: 'cbm',                 label: 'Volume CBM (LCL)',           type: 'number',   required: false, sample: '12' },
    { name: 'berat_kg',            label: 'Berat Kotor (kg)',            type: 'number',   required: false, sample: '8000' },
    { name: 'komoditi',            label: 'Komoditi / Jenis Barang',    type: 'text',     required: true,  sample: 'General cargo - furniture' },
    { name: 'hs_code',             label: 'HS Code',                    type: 'text',     required: false, sample: '9403.60.00' },
    { name: 'nilai_barang',        label: 'Nilai Kargo (USD)',           type: 'number',   required: false, sample: '15000' },
    { name: 'incoterm',            label: 'Incoterm',                   type: 'select',   required: false, sample: 'FOB' },
    { name: 'tanggal_siap',        label: 'Ready to Load (ETD)',        type: 'date',     required: true  },
    { name: 'asuransi',            label: 'Perlu Asuransi?',            type: 'select',   required: false, sample: 'Ya' },
    { name: 'catatan',             label: 'Catatan Khusus',             type: 'textarea', required: false },
  ]);
  console.log('  ✓ Template: sea_freight_inquiry');

  // ---- 4. Customs Clearance ----
  const tCustoms = await insertDataTemplate({ intentCode: 'customs_clearance', name: 'Form Permintaan Bea Cukai', category: 'Logistik', description: 'Formulir pengurusan bea cukai / customs clearance', intakeMode: 'conversation' });
  await insertFields(tCustoms, [
    { name: 'nama_perusahaan',     label: 'Nama Perusahaan Importir/Eksportir', type: 'text', required: true, sample: 'PT. Import Jaya' },
    { name: 'nomor_telepon',       label: 'Nomor Telepon PIC',          type: 'text',     required: true },
    { name: 'jenis_pengurusan',    label: 'Jenis Pengurusan',           type: 'select',   required: true,  help: 'Import / Export', sample: 'Import' },
    { name: 'pelabuhan',           label: 'Pelabuhan / Bandara',        type: 'text',     required: true,  sample: 'Tanjung Priok' },
    { name: 'deskripsi_barang',    label: 'Deskripsi Barang',           type: 'text',     required: true,  sample: 'Mesin dan spare part' },
    { name: 'hs_code',             label: 'HS Code',                    type: 'text',     required: false, sample: '8482.10.00' },
    { name: 'nilai_pabean',        label: 'Nilai Pabean (USD/IDR)',      type: 'number',   required: true,  sample: '25000' },
    { name: 'negara_asal',         label: 'Negara Asal Barang',         type: 'text',     required: true,  sample: 'China' },
    { name: 'nomor_bl_awb',        label: 'Nomor BL / AWB',             type: 'text',     required: true,  sample: 'OOCL123456789' },
    { name: 'estimasi_tiba',       label: 'Estimasi Tiba / ETA',        type: 'date',     required: true },
    { name: 'api_importer',        label: 'Nomor API (Angka Pengenal Importir)', type: 'text', required: false },
    { name: 'catatan',             label: 'Keterangan Tambahan',        type: 'textarea', required: false },
  ]);
  console.log('  ✓ Template: customs_clearance');

  // ---- 5. PPJK ----
  const tPpjk = await insertDataTemplate({ intentCode: 'ppjk_service', name: 'Form Layanan PPJK', category: 'Logistik', description: 'Formulir pengajuan layanan PPJK / freight forwarding', intakeMode: 'conversation' });
  await insertFields(tPpjk, [
    { name: 'nama_perusahaan',     label: 'Nama Perusahaan',            type: 'text',     required: true },
    { name: 'nomor_telepon',       label: 'Nomor Telepon',              type: 'text',     required: true },
    { name: 'jenis_layanan',       label: 'Jenis Layanan',              type: 'select',   required: true,  help: 'Import / Export / Transshipment', sample: 'Import' },
    { name: 'moda_transportasi',   label: 'Moda Transportasi',          type: 'select',   required: true,  sample: 'Sea Freight' },
    { name: 'pelabuhan_muat',      label: 'Pelabuhan Muat (POL)',       type: 'text',     required: true,  sample: 'Tanjung Priok' },
    { name: 'pelabuhan_bongkar',   label: 'Pelabuhan Bongkar (POD)',    type: 'text',     required: true,  sample: 'Port Klang' },
    { name: 'komoditi',            label: 'Komoditi',                   type: 'text',     required: true },
    { name: 'hs_code',             label: 'HS Code',                    type: 'text',     required: false },
    { name: 'nilai_barang',        label: 'Nilai Barang',               type: 'number',   required: true },
    { name: 'tanggal_perlu',       label: 'Tanggal Layanan Diperlukan', type: 'date',     required: true },
  ]);
  console.log('  ✓ Template: ppjk_service');

  // ---- 6. Warehousing ----
  const tWarehouse = await insertDataTemplate({ intentCode: 'warehousing_request', name: 'Form Permintaan Gudang', category: 'Logistik', description: 'Formulir pengajuan layanan warehousing / pergudangan', intakeMode: 'conversation' });
  await insertFields(tWarehouse, [
    { name: 'nama_perusahaan',     label: 'Nama Perusahaan',            type: 'text',     required: true },
    { name: 'nomor_telepon',       label: 'Nomor Telepon',              type: 'text',     required: true },
    { name: 'jenis_barang',        label: 'Jenis Barang yang Disimpan', type: 'text',     required: true,  sample: 'Elektronik, consumer goods' },
    { name: 'volume_cbm',          label: 'Volume yang Dibutuhkan (CBM)', type: 'number', required: true,  sample: '50' },
    { name: 'luas_m2',             label: 'Luas Gudang Diperlukan (m²)', type: 'number',  required: false, sample: '100' },
    { name: 'durasi_sewa',         label: 'Durasi Sewa',                type: 'select',   required: true,  sample: '3 bulan' },
    { name: 'tanggal_mulai',       label: 'Tanggal Mulai',              type: 'date',     required: true },
    { name: 'lokasi_gudang',       label: 'Preferensi Lokasi Gudang',   type: 'text',     required: false, sample: 'Jakarta Barat / Bekasi' },
    { name: 'perlu_cold_storage',  label: 'Perlu Cold Storage?',        type: 'select',   required: false, sample: 'Tidak' },
    { name: 'layanan_tambahan',    label: 'Layanan Tambahan',           type: 'textarea', required: false, help: 'Pick & pack, labeling, dll.' },
  ]);
  console.log('  ✓ Template: warehousing_request');

  // ---- 7. Import ----
  const tImport = await insertDataTemplate({ intentCode: 'import_inquiry', name: 'Form Permintaan Layanan Import', category: 'Logistik', description: 'Formulir pengajuan importasi barang dari luar negeri', intakeMode: 'conversation' });
  await insertFields(tImport, [
    { name: 'nama_importir',       label: 'Nama Importir / Perusahaan', type: 'text',     required: true },
    { name: 'nomor_telepon',       label: 'Nomor Telepon',              type: 'text',     required: true },
    { name: 'negara_asal',         label: 'Negara Asal Barang',         type: 'text',     required: true,  sample: 'China, Japan, USA' },
    { name: 'deskripsi_barang',    label: 'Deskripsi Barang',           type: 'text',     required: true,  sample: 'Electronic components' },
    { name: 'hs_code',             label: 'HS Code',                    type: 'text',     required: false, sample: '8542.31.00' },
    { name: 'nilai_barang',        label: 'Nilai Barang (USD)',          type: 'number',   required: true,  sample: '50000' },
    { name: 'berat_total',         label: 'Berat Total (kg)',            type: 'number',   required: false, sample: '2000' },
    { name: 'moda_pengiriman',     label: 'Moda Pengiriman',            type: 'select',   required: true,  sample: 'Sea Freight' },
    { name: 'pelabuhan_tujuan',    label: 'Pelabuhan Tujuan di Indonesia', type: 'text',  required: true,  sample: 'Tanjung Priok' },
    { name: 'eta',                 label: 'Estimasi Tiba (ETA)',         type: 'date',     required: false },
    { name: 'api_importir',        label: 'Nomor API Importir',         type: 'text',     required: false },
    { name: 'perlu_customs',       label: 'Perlu Pengurusan Bea Cukai?', type: 'select',  required: true,  sample: 'Ya - end to end' },
    { name: 'catatan',             label: 'Catatan Khusus',             type: 'textarea', required: false },
  ]);
  console.log('  ✓ Template: import_inquiry');

  // ---- 8. Export ----
  const tExport = await insertDataTemplate({ intentCode: 'export_inquiry', name: 'Form Permintaan Layanan Export', category: 'Logistik', description: 'Formulir pengajuan ekspor barang ke luar negeri', intakeMode: 'conversation' });
  await insertFields(tExport, [
    { name: 'nama_eksportir',      label: 'Nama Eksportir / Perusahaan', type: 'text',    required: true },
    { name: 'nomor_telepon',       label: 'Nomor Telepon',              type: 'text',     required: true },
    { name: 'negara_tujuan',       label: 'Negara Tujuan',              type: 'text',     required: true,  sample: 'Japan, Singapore, USA' },
    { name: 'deskripsi_barang',    label: 'Deskripsi Barang / Komoditi', type: 'text',    required: true,  sample: 'Crude Palm Oil, Furniture' },
    { name: 'hs_code',             label: 'HS Code',                    type: 'text',     required: false, sample: '1511.10.00' },
    { name: 'nilai_barang',        label: 'Nilai Barang (USD)',          type: 'number',   required: true },
    { name: 'berat_total',         label: 'Berat Total (kg)',            type: 'number',   required: false },
    { name: 'moda_pengiriman',     label: 'Moda Pengiriman',            type: 'select',   required: true,  sample: 'Sea Freight' },
    { name: 'pelabuhan_muat',      label: 'Pelabuhan Muat',             type: 'text',     required: true,  sample: 'Tanjung Priok' },
    { name: 'etd',                 label: 'Tanggal Estimasi Muat (ETD)', type: 'date',    required: false },
    { name: 'incoterm',            label: 'Incoterm',                   type: 'select',   required: false, sample: 'FOB' },
    { name: 'perlu_sku',           label: 'Perlu Surat Keterangan Asal (SKA)?', type: 'select', required: false, sample: 'Ya' },
    { name: 'catatan',             label: 'Catatan / Instruksi',        type: 'textarea', required: false },
  ]);
  console.log('  ✓ Template: export_inquiry');

  // ---- 9. DG Cargo ----
  const tDg = await insertDataTemplate({ intentCode: 'dg_cargo', name: 'Form Pengiriman Barang Berbahaya (DG)', category: 'Logistik', description: 'Formulir pengajuan pengiriman dangerous goods sesuai regulasi IATA/IMDG', intakeMode: 'conversation' });
  await insertFields(tDg, [
    { name: 'nama_pengirim',       label: 'Nama Shipper',               type: 'text',     required: true },
    { name: 'nomor_telepon',       label: 'Nomor Telepon',              type: 'text',     required: true },
    { name: 'nama_barang',         label: 'Nama Barang Berbahaya (Proper Shipping Name)', type: 'text', required: true, sample: 'Lithium Ion Batteries' },
    { name: 'un_number',           label: 'UN Number',                  type: 'text',     required: true,  sample: 'UN3480' },
    { name: 'hazard_class',        label: 'Hazard Class / Division',    type: 'text',     required: true,  sample: '9' },
    { name: 'packing_group',       label: 'Packing Group',              type: 'select',   required: false, sample: 'II' },
    { name: 'berat_net_kg',        label: 'Berat Net (kg)',              type: 'number',   required: true,  sample: '50' },
    { name: 'asal',                label: 'Kota / Bandara Asal',        type: 'text',     required: true },
    { name: 'tujuan',              label: 'Kota / Bandara Tujuan',      type: 'text',     required: true },
    { name: 'moda_pengiriman',     label: 'Moda (Udara/Laut/Darat)',    type: 'select',   required: true },
    { name: 'tanggal_pengiriman',  label: 'Tanggal Rencana Pengiriman', type: 'date',     required: true },
    { name: 'msds_tersedia',       label: 'MSDS/SDS Tersedia?',         type: 'select',   required: true,  sample: 'Ya' },
    { name: 'catatan_keselamatan', label: 'Catatan Keselamatan Khusus', type: 'textarea', required: false },
  ]);
  console.log('  ✓ Template: dg_cargo');

  // ---- 10. Live Animal ----
  const tAnimal = await insertDataTemplate({ intentCode: 'live_animal_cargo', name: 'Form Pengiriman Hewan Hidup', category: 'Logistik', description: 'Formulir pengajuan transportasi hewan hidup', intakeMode: 'conversation' });
  await insertFields(tAnimal, [
    { name: 'nama_pengirim',       label: 'Nama Pengirim',              type: 'text',     required: true },
    { name: 'nomor_telepon',       label: 'Nomor Telepon',              type: 'text',     required: true },
    { name: 'jenis_hewan',         label: 'Jenis / Spesies Hewan',      type: 'text',     required: true,  sample: 'Anjing Golden Retriever' },
    { name: 'jumlah',              label: 'Jumlah Hewan',               type: 'number',   required: true,  sample: '2' },
    { name: 'berat_per_ekor',      label: 'Berat Per Ekor (kg)',         type: 'number',   required: false, sample: '25' },
    { name: 'asal',                label: 'Kota Asal',                  type: 'text',     required: true },
    { name: 'tujuan',              label: 'Kota Tujuan',                type: 'text',     required: true },
    { name: 'tanggal_pengiriman',  label: 'Tanggal Pengiriman',         type: 'date',     required: true },
    { name: 'dokumen_karantina',   label: 'Sertifikat Karantina Tersedia?', type: 'select', required: true, sample: 'Ya' },
    { name: 'vaksinasi',           label: 'Buku Vaksinasi Lengkap?',    type: 'select',   required: true,  sample: 'Ya' },
    { name: 'catatan_khusus',      label: 'Kondisi Kesehatan / Catatan', type: 'textarea', required: false },
  ]);
  console.log('  ✓ Template: live_animal_cargo');

  // ---- 11. Cold Chain ----
  const tCold = await insertDataTemplate({ intentCode: 'cold_chain', name: 'Form Permintaan Cold Chain', category: 'Logistik', description: 'Formulir pengajuan layanan pengiriman dengan kontrol suhu', intakeMode: 'conversation' });
  await insertFields(tCold, [
    { name: 'nama_pengirim',       label: 'Nama Shipper',               type: 'text',     required: true },
    { name: 'nomor_telepon',       label: 'Nomor Telepon',              type: 'text',     required: true },
    { name: 'jenis_produk',        label: 'Jenis Produk',               type: 'text',     required: true,  sample: 'Produk farmasi / daging beku / buah segar' },
    { name: 'suhu_diperlukan',     label: 'Suhu Penyimpanan (°C)',       type: 'text',     required: true,  sample: '-18°C / 2-8°C' },
    { name: 'berat_kg',            label: 'Berat Total (kg)',            type: 'number',   required: true },
    { name: 'asal',                label: 'Lokasi Asal',                type: 'text',     required: true },
    { name: 'tujuan',              label: 'Lokasi Tujuan',              type: 'text',     required: true },
    { name: 'tanggal_muat',        label: 'Tanggal Muat',               type: 'date',     required: true },
    { name: 'durasi_transit',      label: 'Estimasi Durasi Transit',    type: 'text',     required: false, sample: '2 hari' },
    { name: 'kemasan',             label: 'Jenis Kemasan (Cardboard/Styrofoam/Reefer)', type: 'select', required: false },
    { name: 'monitoring_suhu',     label: 'Perlu Data Logger / Monitoring?', type: 'select', required: false, sample: 'Ya' },
    { name: 'catatan',             label: 'Catatan Khusus',             type: 'textarea', required: false },
  ]);
  console.log('  ✓ Template: cold_chain');

  // ---- 12. Project Cargo ----
  const tProject = await insertDataTemplate({ intentCode: 'project_cargo', name: 'Form Permintaan Project Cargo', category: 'Logistik', description: 'Formulir pengajuan pengiriman kargo proyek / oversize', intakeMode: 'conversation' });
  await insertFields(tProject, [
    { name: 'nama_perusahaan',     label: 'Nama Perusahaan',            type: 'text',     required: true },
    { name: 'nama_project',        label: 'Nama Proyek',                type: 'text',     required: true,  sample: 'Proyek PLTU Kalimantan' },
    { name: 'nomor_telepon',       label: 'Nomor Telepon PIC',          type: 'text',     required: true },
    { name: 'deskripsi_kargo',     label: 'Deskripsi Kargo',            type: 'textarea', required: true,  sample: 'Generator set 500 kVA, 1 unit' },
    { name: 'dimensi',             label: 'Dimensi (P×L×T meter)',      type: 'text',     required: true,  sample: '6.0 x 2.5 x 3.0' },
    { name: 'berat_ton',           label: 'Berat Total (ton)',           type: 'number',   required: true,  sample: '45' },
    { name: 'lokasi_asal',         label: 'Lokasi Asal',                type: 'text',     required: true },
    { name: 'lokasi_tujuan',       label: 'Lokasi Tujuan',              type: 'text',     required: true },
    { name: 'moda_pengiriman',     label: 'Moda Pengiriman',            type: 'select',   required: true,  sample: 'Sea + Darat' },
    { name: 'tanggal_target',      label: 'Target Tiba di Site',        type: 'date',     required: true },
    { name: 'lashing_cashing',     label: 'Perlu Lashing / Cashing?',   type: 'select',   required: false, sample: 'Ya' },
    { name: 'survey_diperlukan',   label: 'Perlu Survey Jalur?',        type: 'select',   required: false, sample: 'Ya' },
    { name: 'catatan',             label: 'Instruksi / Catatan Khusus', type: 'textarea', required: false },
  ]);
  console.log('  ✓ Template: project_cargo');

  // ---- 13. Fleet Repair ----
  const tFleet = await insertDataTemplate({ intentCode: 'fleet_repair', name: 'Form Laporan Kerusakan Kendaraan', category: 'Operasional', description: 'Formulir laporan kerusakan / permintaan servis armada', intakeMode: 'conversation' });
  await insertFields(tFleet, [
    { name: 'nama_pengemudi',      label: 'Nama Pengemudi / Pelapor',   type: 'text',     required: true },
    { name: 'nomor_telepon',       label: 'Nomor Telepon',              type: 'text',     required: true },
    { name: 'plat_kendaraan',      label: 'Nomor Plat Kendaraan',       type: 'text',     required: true,  sample: 'B 1234 ABC' },
    { name: 'jenis_kerusakan',     label: 'Jenis Kerusakan / Masalah',  type: 'select',   required: true,  help: 'Mesin / Ban / Rem / Listrik / Lainnya', sample: 'Mesin' },
    { name: 'deskripsi_masalah',   label: 'Deskripsi Detail Masalah',   type: 'textarea', required: true },
    { name: 'lokasi_kendaraan',    label: 'Lokasi Kendaraan Saat Ini',  type: 'text',     required: true },
    { name: 'kondisi_kendaraan',   label: 'Kondisi (Masih Bisa Jalan / Mogok)', type: 'select', required: true, sample: 'Mogok' },
    { name: 'tanggal_kejadian',    label: 'Tanggal Kejadian',           type: 'date',     required: true },
    { name: 'foto_kerusakan',      label: 'Foto Kerusakan',             type: 'file',     required: false },
    { name: 'urgensi',             label: 'Tingkat Urgensi',            type: 'select',   required: true,  sample: 'Darurat' },
  ]);
  console.log('  ✓ Template: fleet_repair');

  // ---- 14. Fuel Expense ----
  const tFuel = await insertDataTemplate({ intentCode: 'fuel_expense', name: 'Form Laporan BBM', category: 'Operasional', description: 'Formulir pelaporan pengeluaran bahan bakar kendaraan', intakeMode: 'conversation' });
  await insertFields(tFuel, [
    { name: 'nama_pengemudi',      label: 'Nama Pengemudi',             type: 'text',     required: true },
    { name: 'plat_kendaraan',      label: 'Nomor Plat Kendaraan',       type: 'text',     required: true,  sample: 'B 9876 XYZ' },
    { name: 'tanggal_isi',         label: 'Tanggal Pengisian',          type: 'date',     required: true },
    { name: 'jenis_bbm',           label: 'Jenis BBM',                  type: 'select',   required: true,  sample: 'Solar B30' },
    { name: 'liter',               label: 'Volume Pengisian (Liter)',   type: 'number',   required: true,  sample: '60' },
    { name: 'total_biaya',         label: 'Total Biaya (Rp)',            type: 'number',   required: true,  sample: '840000' },
    { name: 'nama_spbu',           label: 'Nama / Lokasi SPBU',         type: 'text',     required: false, sample: 'SPBU Pertamina Jl. Sudirman' },
    { name: 'odometer',            label: 'Odometer Saat Ini (km)',      type: 'number',   required: false, sample: '45230' },
    { name: 'foto_struk',          label: 'Foto Struk / Bon',           type: 'file',     required: true },
    { name: 'rute_perjalanan',     label: 'Rute Perjalanan',            type: 'text',     required: false, sample: 'Jakarta - Semarang' },
  ]);
  console.log('  ✓ Template: fuel_expense');

  // ---- 15. Tire Issue ----
  const tTire = await insertDataTemplate({ intentCode: 'tire_issue', name: 'Form Laporan Masalah Ban', category: 'Operasional', description: 'Formulir pelaporan masalah ban kendaraan operasional', intakeMode: 'conversation' });
  await insertFields(tTire, [
    { name: 'nama_pengemudi',      label: 'Nama Pengemudi / Pelapor',   type: 'text',     required: true },
    { name: 'plat_kendaraan',      label: 'Nomor Plat Kendaraan',       type: 'text',     required: true },
    { name: 'posisi_ban',          label: 'Posisi Ban Bermasalah',      type: 'select',   required: true,  help: 'Depan Kiri / Depan Kanan / Belakang / dll.', sample: 'Belakang Kiri' },
    { name: 'jenis_masalah',       label: 'Jenis Masalah Ban',          type: 'select',   required: true,  help: 'Bocor / Aus / Sobek / Tekanan Rendah', sample: 'Bocor' },
    { name: 'lokasi_kejadian',     label: 'Lokasi Kejadian',            type: 'text',     required: true },
    { name: 'tanggal_kejadian',    label: 'Tanggal Kejadian',           type: 'date',     required: true },
    { name: 'merk_ban',            label: 'Merek / Ukuran Ban',         type: 'text',     required: false, sample: 'Bridgestone 10.00-20' },
    { name: 'tindakan_darurat',    label: 'Tindakan Darurat yang Dilakukan', type: 'textarea', required: false },
    { name: 'foto_ban',            label: 'Foto Kondisi Ban',           type: 'file',     required: false },
    { name: 'perlu_penggantian',   label: 'Perlu Ganti Ban Baru?',      type: 'select',   required: true,  sample: 'Ya' },
  ]);
  console.log('  ✓ Template: tire_issue');

  // ---- 16. Damaged Goods Complaint ----
  const tDamaged = await insertDataTemplate({ intentCode: 'damaged_goods_complaint', name: 'Form Komplain Kerusakan Barang', category: 'Komplain', description: 'Formulir komplain barang rusak / cacat saat penerimaan', intakeMode: 'conversation' });
  await insertFields(tDamaged, [
    { name: 'nama_pelapor',        label: 'Nama Pelapor',               type: 'text',     required: true },
    { name: 'nomor_telepon',       label: 'Nomor Telepon',              type: 'text',     required: true },
    { name: 'nomor_resi',          label: 'Nomor Resi / AWB / BL',      type: 'text',     required: true },
    { name: 'tanggal_terima',      label: 'Tanggal Barang Diterima',    type: 'date',     required: true },
    { name: 'deskripsi_barang',    label: 'Deskripsi Barang Rusak',     type: 'text',     required: true,  sample: 'Laptop 2 unit' },
    { name: 'jenis_kerusakan',     label: 'Jenis Kerusakan',            type: 'select',   required: true,  help: 'Pecah/Retak / Tergores / Tidak Lengkap / Basah / Lainnya' },
    { name: 'deskripsi_kerusakan', label: 'Detail Kerusakan',           type: 'textarea', required: true },
    { name: 'nilai_tuntutan',      label: 'Estimasi Nilai Kerugian (Rp)', type: 'number', required: false },
    { name: 'foto_bukti',          label: 'Foto Kerusakan',             type: 'file',     required: true,  help: 'Foto kondisi barang dan kemasan saat diterima' },
    { name: 'perlu_penggantian',   label: 'Tuntutan',                   type: 'select',   required: true,  sample: 'Penggantian barang' },
  ]);
  console.log('  ✓ Template: damaged_goods_complaint');

  // ---- 17. Delivery Delay Complaint ----
  const tDelay = await insertDataTemplate({ intentCode: 'delivery_delay_complaint', name: 'Form Komplain Keterlambatan', category: 'Komplain', description: 'Formulir komplain pengiriman yang terlambat', intakeMode: 'conversation' });
  await insertFields(tDelay, [
    { name: 'nama_pelapor',        label: 'Nama Pelapor',               type: 'text',     required: true },
    { name: 'nomor_telepon',       label: 'Nomor Telepon',              type: 'text',     required: true },
    { name: 'nomor_resi',          label: 'Nomor Resi / AWB / Order',   type: 'text',     required: true },
    { name: 'tanggal_estimasi',    label: 'Tanggal Estimasi Tiba (Awal)', type: 'date',   required: true },
    { name: 'hari_ini',            label: 'Sudah Berapa Hari Terlambat?', type: 'number', required: false, sample: '3' },
    { name: 'tujuan_pengiriman',   label: 'Tujuan Pengiriman',          type: 'text',     required: true },
    { name: 'last_tracking',       label: 'Status Tracking Terakhir',   type: 'text',     required: false, sample: 'In transit - Surabaya' },
    { name: 'dampak_keterlambatan',label: 'Dampak Keterlambatan',       type: 'textarea', required: false, help: 'Apakah ada kerugian bisnis akibat keterlambatan?' },
    { name: 'tuntutan',            label: 'Yang Diharapkan',            type: 'select',   required: true,  sample: 'Percepat pengiriman + kompensasi' },
  ]);
  console.log('  ✓ Template: delivery_delay_complaint');

  // ---- 18. Customer Data Update ----
  const tUpdate = await insertDataTemplate({ intentCode: 'customer_data_update', name: 'Form Perbarui Data Pelanggan', category: 'Administrasi', description: 'Formulir perbarui data profil pelanggan', intakeMode: 'conversation' });
  await insertFields(tUpdate, [
    { name: 'nama_pelanggan',      label: 'Nama Pelanggan / Perusahaan', type: 'text',    required: true },
    { name: 'nomor_telepon_lama',  label: 'Nomor Telepon Lama (jika berubah)', type: 'text', required: false },
    { name: 'nomor_telepon_baru',  label: 'Nomor Telepon Baru',         type: 'text',     required: false },
    { name: 'email_baru',          label: 'Email Baru (jika berubah)',  type: 'text',     required: false },
    { name: 'alamat_baru',         label: 'Alamat Baru (jika berubah)', type: 'textarea', required: false },
    { name: 'nama_pic_baru',       label: 'Nama PIC Baru',              type: 'text',     required: false },
    { name: 'data_lain',           label: 'Data Lain yang Diperbarui',  type: 'textarea', required: false },
  ]);
  console.log('  ✓ Template: customer_data_update');

  // ---- Existing intents that lack templates ----

  // Invoice Request (pertanyaan_tagihan)
  const tInvoice = await insertDataTemplate({ intentCode: 'pertanyaan_tagihan', name: 'Form Permintaan Invoice / Tagihan', category: 'Keuangan', description: 'Formulir permintaan atau pertanyaan terkait invoice', intakeMode: 'conversation' });
  await insertFields(tInvoice, [
    { name: 'nama_perusahaan',     label: 'Nama Perusahaan',            type: 'text',     required: true },
    { name: 'nomor_telepon',       label: 'Nomor Telepon',              type: 'text',     required: true },
    { name: 'periode_tagihan',     label: 'Periode Tagihan',            type: 'text',     required: false, sample: 'Januari 2026' },
    { name: 'nomor_order',         label: 'Nomor Order / Referensi',    type: 'text',     required: false },
    { name: 'jenis_permintaan',    label: 'Jenis Permintaan',           type: 'select',   required: true,  help: 'Invoice baru / Duplikat / Pertanyaan tagihan / Koreksi' },
    { name: 'email_kirim_invoice', label: 'Email Tujuan Invoice',       type: 'text',     required: false },
    { name: 'catatan',             label: 'Keterangan',                 type: 'textarea', required: false },
  ]);
  console.log('  ✓ Template: pertanyaan_tagihan');

  // Payment Confirmation (konfirmasi_pembayaran)
  const tPayment = await insertDataTemplate({ intentCode: 'konfirmasi_pembayaran', name: 'Form Konfirmasi Pembayaran', category: 'Keuangan', description: 'Formulir konfirmasi transfer pembayaran tagihan', intakeMode: 'conversation' });
  await insertFields(tPayment, [
    { name: 'nama_perusahaan',     label: 'Nama Perusahaan Pembayar',   type: 'text',     required: true },
    { name: 'nomor_telepon',       label: 'Nomor Telepon',              type: 'text',     required: true },
    { name: 'nomor_invoice',       label: 'Nomor Invoice yang Dibayar', type: 'text',     required: true },
    { name: 'jumlah_bayar',        label: 'Jumlah yang Dibayarkan (Rp)', type: 'number',  required: true },
    { name: 'tanggal_transfer',    label: 'Tanggal Transfer',           type: 'date',     required: true },
    { name: 'bank_pengirim',       label: 'Bank Pengirim',              type: 'text',     required: false, sample: 'BCA' },
    { name: 'bank_tujuan',         label: 'Bank Tujuan',                type: 'text',     required: false, sample: 'Mandiri' },
    { name: 'bukti_transfer',      label: 'Foto / Bukti Transfer',      type: 'file',     required: true },
  ]);
  console.log('  ✓ Template: konfirmasi_pembayaran');

  // Vendor Registration (permintaan_vendor)
  const tVendor = await insertDataTemplate({ intentCode: 'permintaan_vendor', name: 'Form Pendaftaran Vendor / Mitra', category: 'Komersial', description: 'Formulir pendaftaran vendor / mitra baru', intakeMode: 'conversation' });
  await insertFields(tVendor, [
    { name: 'nama_perusahaan',     label: 'Nama Perusahaan',            type: 'text',     required: true },
    { name: 'nama_pic',            label: 'Nama PIC / Kontak',          type: 'text',     required: true },
    { name: 'nomor_telepon',       label: 'Nomor Telepon',              type: 'text',     required: true },
    { name: 'email',               label: 'Email Perusahaan',           type: 'text',     required: true },
    { name: 'jenis_layanan',       label: 'Layanan yang Ditawarkan',    type: 'textarea', required: true,  sample: 'Trucking, Sea Freight, Customs' },
    { name: 'wilayah_operasi',     label: 'Wilayah Operasi',            type: 'text',     required: false, sample: 'Jabodetabek, Jawa Tengah' },
    { name: 'kapasitas',           label: 'Kapasitas / Armada',         type: 'text',     required: false, sample: '10 unit truk, 2 kontainer' },
    { name: 'pengalaman',          label: 'Pengalaman (Tahun)',          type: 'number',   required: false, sample: '5' },
    { name: 'referensi',           label: 'Referensi Klien',            type: 'textarea', required: false },
  ]);
  console.log('  ✓ Template: permintaan_vendor');

  // Tenant rental (daftar_tenant)
  const tTenant = await insertDataTemplate({ intentCode: 'daftar_tenant', name: 'Form Pendaftaran Sewa Tenant', category: 'Tenant', description: 'Formulir pengajuan sewa kios / tenant / ruang usaha baru', intakeMode: 'conversation' });
  await insertFields(tTenant, [
    { name: 'nama_usaha',          label: 'Nama Usaha / Bisnis',        type: 'text',     required: true },
    { name: 'nama_penyewa',        label: 'Nama Penyewa (PIC)',         type: 'text',     required: true },
    { name: 'nomor_telepon',       label: 'Nomor Telepon',              type: 'text',     required: true },
    { name: 'jenis_usaha',         label: 'Jenis Usaha',                type: 'text',     required: true,  sample: 'Toko pakaian / kuliner / elektronik' },
    { name: 'lokasi_diinginkan',   label: 'Preferensi Lokasi / Blok',   type: 'text',     required: false, sample: 'Blok A, dekat pintu masuk' },
    { name: 'luas_diperlukan',     label: 'Luas Yang Dibutuhkan (m²)',   type: 'number',   required: false, sample: '12' },
    { name: 'durasi_sewa',         label: 'Durasi Sewa yang Diinginkan', type: 'select',   required: true,  sample: '1 tahun' },
    { name: 'tanggal_mulai',       label: 'Rencana Mulai Sewa',         type: 'date',     required: true },
    { name: 'catatan',             label: 'Kebutuhan Khusus',           type: 'textarea', required: false },
  ]);
  console.log('  ✓ Template: daftar_tenant');

  // Sport Center Booking (booking_lapangan)
  const tSport = await insertDataTemplate({ intentCode: 'booking_lapangan', name: 'Form Booking Lapangan Olahraga', category: 'Sport Center', description: 'Formulir pemesanan jadwal lapangan / fasilitas sport center', intakeMode: 'conversation' });
  await insertFields(tSport, [
    { name: 'nama_pemesan',        label: 'Nama Pemesan',               type: 'text',     required: true },
    { name: 'nomor_telepon',       label: 'Nomor Telepon',              type: 'text',     required: true },
    { name: 'jenis_olahraga',      label: 'Jenis Olahraga / Lapangan',  type: 'select',   required: true,  help: 'Badminton / Futsal / Tenis / Basket / Squash', sample: 'Badminton' },
    { name: 'nomor_lapangan',      label: 'Nomor / Preferensi Lapangan', type: 'text',    required: false, sample: 'Lapangan 2' },
    { name: 'tanggal_booking',     label: 'Tanggal Booking',            type: 'date',     required: true },
    { name: 'jam_mulai',           label: 'Jam Mulai',                  type: 'text',     required: true,  sample: '08:00' },
    { name: 'durasi',              label: 'Durasi (Jam)',                type: 'select',   required: true,  sample: '2 jam' },
    { name: 'jumlah_orang',        label: 'Jumlah Orang',               type: 'number',   required: false, sample: '4' },
    { name: 'member_id',           label: 'ID Membership (Jika Ada)',    type: 'text',     required: false },
    { name: 'catatan',             label: 'Catatan Tambahan',           type: 'textarea', required: false },
  ]);
  console.log('  ✓ Template: booking_lapangan');

  // Jadwal Pengiriman (jadwal_pengiriman)
  const tJadwal = await insertDataTemplate({ intentCode: 'jadwal_pengiriman', name: 'Form Pertanyaan Jadwal Pengiriman', category: 'Operasional', description: 'Formulir pertanyaan atau request jadwal pengiriman', intakeMode: 'conversation' });
  await insertFields(tJadwal, [
    { name: 'nomor_resi',          label: 'Nomor Resi / Order',         type: 'text',     required: false },
    { name: 'nama_pengirim',       label: 'Nama Pengirim',              type: 'text',     required: false },
    { name: 'tujuan',              label: 'Kota / Area Tujuan',         type: 'text',     required: true },
    { name: 'jenis_barang',        label: 'Jenis Barang',               type: 'text',     required: false },
    { name: 'tanggal_diinginkan',  label: 'Tanggal Pengiriman Diinginkan', type: 'date',  required: true },
    { name: 'waktu_preferensi',    label: 'Waktu Preferensi',           type: 'text',     required: false, sample: 'Pagi hari / Siang / Sore' },
    { name: 'nomor_telepon',       label: 'Nomor Telepon',              type: 'text',     required: true },
  ]);
  console.log('  ✓ Template: jadwal_pengiriman');

  // Permintaan Dokumen (permintaan_dokumen)
  const tDokumen = await insertDataTemplate({ intentCode: 'permintaan_dokumen', name: 'Form Permintaan Dokumen', category: 'Administrasi', description: 'Formulir permintaan dokumen seperti POD, BL, sertifikat, dll.', intakeMode: 'conversation' });
  await insertFields(tDokumen, [
    { name: 'nama_pemohon',        label: 'Nama Pemohon',               type: 'text',     required: true },
    { name: 'nomor_telepon',       label: 'Nomor Telepon',              type: 'text',     required: true },
    { name: 'jenis_dokumen',       label: 'Jenis Dokumen Diperlukan',   type: 'select',   required: true,  help: 'POD / BL / AWB / Invoice / Sertifikat / Lainnya', sample: 'POD (Proof of Delivery)' },
    { name: 'nomor_referensi',     label: 'Nomor Referensi / Resi',     type: 'text',     required: false },
    { name: 'periode',             label: 'Periode / Bulan',            type: 'text',     required: false, sample: 'Januari - Maret 2026' },
    { name: 'format',              label: 'Format yang Diperlukan',     type: 'select',   required: false, sample: 'PDF via Email' },
    { name: 'catatan',             label: 'Keterangan',                 type: 'textarea', required: false },
  ]);
  console.log('  ✓ Template: permintaan_dokumen');

  // Customer Registration (pendaftaran_pelanggan)
  const tCustReg = await insertDataTemplate({ intentCode: 'pendaftaran_pelanggan', name: 'Form Pendaftaran Pelanggan Baru', category: 'Komersial', description: 'Formulir pendaftaran pelanggan / shipper baru', intakeMode: 'conversation' });
  await insertFields(tCustReg, [
    { name: 'nama_perusahaan',     label: 'Nama Perusahaan / Individu', type: 'text',     required: true },
    { name: 'nama_pic',            label: 'Nama PIC',                   type: 'text',     required: true },
    { name: 'nomor_telepon',       label: 'Nomor Telepon',              type: 'text',     required: true },
    { name: 'email',               label: 'Email',                      type: 'text',     required: false },
    { name: 'alamat',              label: 'Alamat Lengkap',             type: 'textarea', required: true },
    { name: 'jenis_kebutuhan',     label: 'Layanan yang Dibutuhkan',    type: 'textarea', required: true,  sample: 'Trucking reguler, pengiriman ke Surabaya' },
    { name: 'frekuensi_pengiriman',label: 'Frekuensi Pengiriman',       type: 'select',   required: false, sample: 'Mingguan' },
    { name: 'npwp',                label: 'NPWP (Opsional)',            type: 'text',     required: false },
  ]);
  console.log('  ✓ Template: pendaftaran_pelanggan');

  // ── PHASE E: Document Templates + Fields ─────────────────────────────────────

  console.log('\nPhase E: Adding document templates...');

  // Air Freight
  const dAir = await insertDocTemplate({ intentCode: 'air_freight_inquiry', name: 'Dokumen Air Freight', category: 'Logistik', description: 'Daftar dokumen untuk pengiriman cargo udara' });
  await insertDocFields(dAir, [
    { name: 'Packing List',                   type: 'document', required: true,  desc: 'Daftar rinci barang yang akan dikirim' },
    { name: 'Commercial Invoice',             type: 'document', required: true,  desc: 'Faktur komersial dengan nilai barang' },
    { name: 'Airway Bill (AWB)',              type: 'document', required: true,  desc: 'Dokumen pengiriman udara dari maskapai' },
    { name: 'MSDS (jika DG)',                type: 'document', required: false, desc: 'Wajib untuk barang berbahaya' },
    { name: 'Shipper Letter of Instruction', type: 'document', required: false, desc: 'Instruksi pengiriman dari shipper' },
  ]);
  console.log('  ✓ Doc template: air_freight_inquiry');

  // Sea Freight
  const dSea = await insertDocTemplate({ intentCode: 'sea_freight_inquiry', name: 'Dokumen Sea Freight', category: 'Logistik', description: 'Daftar dokumen untuk pengiriman kargo laut' });
  await insertDocFields(dSea, [
    { name: 'Packing List',                   type: 'document', required: true,  desc: 'Daftar rinci isi container' },
    { name: 'Commercial Invoice',             type: 'document', required: true,  desc: 'Faktur komersial barang' },
    { name: 'Bill of Lading (BL)',            type: 'document', required: true,  desc: 'Dokumen pengiriman laut' },
    { name: 'Certificate of Origin (COO/SKA)', type: 'document', required: false, desc: 'Sertifikat asal barang' },
    { name: 'Fumigation Certificate',         type: 'document', required: false, desc: 'Untuk komoditi pertanian / kayu' },
  ]);
  console.log('  ✓ Doc template: sea_freight_inquiry');

  // Customs Clearance
  const dCustoms = await insertDocTemplate({ intentCode: 'customs_clearance', name: 'Dokumen Bea Cukai', category: 'Logistik', description: 'Daftar dokumen wajib untuk pengurusan bea cukai' });
  await insertDocFields(dCustoms, [
    { name: 'Invoice & Packing List',         type: 'document', required: true,  desc: 'Faktur dan packing list barang' },
    { name: 'Bill of Lading / AWB',          type: 'document', required: true,  desc: 'Dokumen pengangkutan' },
    { name: 'PIB / PEB (Draft)',              type: 'document', required: false, desc: 'Draft Pemberitahuan Impor/Ekspor Barang' },
    { name: 'API / NPWP',                    type: 'identity',  required: true,  desc: 'API Importir dan NPWP perusahaan' },
    { name: 'Sertifikat Halal / SNI (jika wajib)', type: 'document', required: false, desc: 'Dokumen izin impor tertentu' },
    { name: 'Letter of Credit (jika ada)',   type: 'document', required: false, desc: 'LC dari bank untuk pembayaran' },
  ]);
  console.log('  ✓ Doc template: customs_clearance');

  // Import
  const dImport = await insertDocTemplate({ intentCode: 'import_inquiry', name: 'Dokumen Layanan Import', category: 'Logistik', description: 'Dokumen wajib untuk proses importasi' });
  await insertDocFields(dImport, [
    { name: 'Commercial Invoice',             type: 'document', required: true },
    { name: 'Packing List',                   type: 'document', required: true },
    { name: 'Bill of Lading / AWB',          type: 'document', required: true },
    { name: 'Certificate of Origin',          type: 'document', required: false },
    { name: 'API Importir',                   type: 'identity',  required: true },
    { name: 'NPWP Perusahaan',               type: 'identity',  required: true },
    { name: 'Izin Impor / LS (jika lartas)', type: 'document', required: false, desc: 'Dokumen larangan/pembatasan import' },
  ]);
  console.log('  ✓ Doc template: import_inquiry');

  // Export
  const dExport = await insertDocTemplate({ intentCode: 'export_inquiry', name: 'Dokumen Layanan Export', category: 'Logistik', description: 'Dokumen wajib untuk proses ekspor' });
  await insertDocFields(dExport, [
    { name: 'Commercial Invoice',             type: 'document', required: true },
    { name: 'Packing List',                   type: 'document', required: true },
    { name: 'Surat Keterangan Asal (SKA/COO)', type: 'document', required: false },
    { name: 'PEB (Pemberitahuan Ekspor Barang)', type: 'document', required: false },
    { name: 'NPWP Eksportir',                 type: 'identity',  required: true },
    { name: 'Phytosanitary Certificate (komoditas pertanian)', type: 'document', required: false },
  ]);
  console.log('  ✓ Doc template: export_inquiry');

  // DG Cargo
  const dDg = await insertDocTemplate({ intentCode: 'dg_cargo', name: 'Dokumen Barang Berbahaya (DG)', category: 'Logistik', description: 'Dokumen wajib sesuai regulasi IATA/IMDG untuk DG cargo' });
  await insertDocFields(dDg, [
    { name: 'MSDS / Safety Data Sheet',      type: 'document', required: true,  desc: 'Material Safety Data Sheet wajib' },
    { name: 'DG Declaration (Shipper)',       type: 'document', required: true,  desc: 'Deklarasi barang berbahaya dari shipper' },
    { name: 'Dangerous Goods Acceptance Checklist', type: 'document', required: true },
    { name: 'Packing Certificate',            type: 'document', required: false, desc: 'Sertifikat packing sesuai UN packing group' },
  ]);
  console.log('  ✓ Doc template: dg_cargo');

  // Live Animal
  const dAnimal = await insertDocTemplate({ intentCode: 'live_animal_cargo', name: 'Dokumen Hewan Hidup', category: 'Logistik', description: 'Dokumen karantina dan kesehatan untuk pengiriman hewan hidup' });
  await insertDocFields(dAnimal, [
    { name: 'Sertifikat Kesehatan Hewan',    type: 'document', required: true,  desc: 'Dikeluarkan oleh dokter hewan resmi' },
    { name: 'Sertifikat Karantina',          type: 'document', required: true,  desc: 'Dari BBUSKP / Badan Karantina' },
    { name: 'Buku Vaksinasi',                type: 'document', required: true,  desc: 'Riwayat vaksinasi lengkap' },
    { name: 'Izin Angkut (CITES jika perlu)', type: 'document', required: false, desc: 'Untuk hewan dilindungi' },
  ]);
  console.log('  ✓ Doc template: live_animal_cargo');

  // Cold Chain
  const dCold = await insertDocTemplate({ intentCode: 'cold_chain', name: 'Dokumen Cold Chain', category: 'Logistik', description: 'Dokumen untuk pengiriman cold chain / suhu terkontrol' });
  await insertDocFields(dCold, [
    { name: 'Packing List dengan Spesifikasi Suhu', type: 'document', required: true },
    { name: 'Certificate of Analysis (Farmasi)',  type: 'document', required: false },
    { name: 'Sertifikat Halal / BPOM (jika pangan)', type: 'document', required: false },
    { name: 'Cold Chain Monitoring Report',         type: 'document', required: false },
  ]);
  console.log('  ✓ Doc template: cold_chain');

  // Project Cargo
  const dProject = await insertDocTemplate({ intentCode: 'project_cargo', name: 'Dokumen Project Cargo', category: 'Logistik', description: 'Dokumen untuk pengiriman kargo proyek / heavy lift' });
  await insertDocFields(dProject, [
    { name: 'Technical Specification Sheet',  type: 'document', required: true,  desc: 'Spesifikasi teknis kargo (dimensi, berat, titik angkat)' },
    { name: 'Drawing / Gambar Teknis',        type: 'document', required: false },
    { name: 'Survey Route Report',            type: 'document', required: false, desc: 'Hasil survey jalur jika perlu izin overdimensi' },
    { name: 'Izin Overdimensi / ODOL',        type: 'document', required: false },
    { name: 'Insurance Certificate',          type: 'document', required: true },
  ]);
  console.log('  ✓ Doc template: project_cargo');

  // Fleet Repair
  const dFleet = await insertDocTemplate({ intentCode: 'fleet_repair', name: 'Dokumen Perbaikan Kendaraan', category: 'Operasional', description: 'Dokumen pendukung laporan kerusakan kendaraan' });
  await insertDocFields(dFleet, [
    { name: 'Foto Kerusakan Kendaraan',       type: 'image',    required: true,  desc: 'Minimal 2 foto dari sudut berbeda' },
    { name: 'Foto Odometer',                  type: 'image',    required: false, desc: 'Foto pembacaan km saat ini' },
    { name: 'Laporan Driver',                 type: 'document', required: false, desc: 'Narasi kejadian dari pengemudi' },
  ]);
  console.log('  ✓ Doc template: fleet_repair');

  // Damaged Goods
  const dDamaged = await insertDocTemplate({ intentCode: 'damaged_goods_complaint', name: 'Dokumen Komplain Kerusakan Barang', category: 'Komplain', description: 'Dokumen pendukung klaim kerusakan barang' });
  await insertDocFields(dDamaged, [
    { name: 'Foto Kondisi Barang Rusak',      type: 'image',    required: true,  desc: 'Foto barang dan kemasan yang rusak' },
    { name: 'Foto Label / Resi Pengiriman',   type: 'image',    required: true },
    { name: 'Surat Jalan / DO Asli',          type: 'document', required: false },
    { name: 'Berita Acara Kerusakan',         type: 'document', required: false, desc: 'Jika sudah dibuat' },
    { name: 'Invoice Barang',                 type: 'document', required: false, desc: 'Untuk perhitungan nilai klaim' },
  ]);
  console.log('  ✓ Doc template: damaged_goods_complaint');

  // Delivery Delay
  const dDelay = await insertDocTemplate({ intentCode: 'delivery_delay_complaint', name: 'Dokumen Komplain Keterlambatan', category: 'Komplain', description: 'Dokumen pendukung komplain keterlambatan pengiriman' });
  await insertDocFields(dDelay, [
    { name: 'Foto / Screenshot Tracking',     type: 'image',    required: false, desc: 'Screenshot status tracking terakhir' },
    { name: 'Bukti Janji Waktu Pengiriman',   type: 'document', required: false, desc: 'Email / chat konfirmasi ETA awal' },
  ]);
  console.log('  ✓ Doc template: delivery_delay_complaint');

  // Payment confirmation doc
  const dPay = await insertDocTemplate({ intentCode: 'konfirmasi_pembayaran', name: 'Dokumen Konfirmasi Pembayaran', category: 'Keuangan', description: 'Bukti pembayaran yang perlu dilampirkan' });
  await insertDocFields(dPay, [
    { name: 'Bukti Transfer / Screenshot',    type: 'image',    required: true,  desc: 'Bukti transfer dari mobile banking atau ATM' },
    { name: 'Invoice yang Dibayar',           type: 'document', required: false, desc: 'Copy invoice yang dilunasi' },
  ]);
  console.log('  ✓ Doc template: konfirmasi_pembayaran');

  // Fuel expense doc
  const dFuel = await insertDocTemplate({ intentCode: 'fuel_expense', name: 'Dokumen Laporan BBM', category: 'Operasional', description: 'Bukti pengisian BBM yang dilaporkan' });
  await insertDocFields(dFuel, [
    { name: 'Struk / Bon BBM',                type: 'image',    required: true,  desc: 'Foto struk resmi dari SPBU' },
    { name: 'Foto Odometer',                  type: 'image',    required: false, desc: 'Foto odometer kendaraan' },
  ]);
  console.log('  ✓ Doc template: fuel_expense');

  // Tire issue doc
  const dTire = await insertDocTemplate({ intentCode: 'tire_issue', name: 'Dokumen Masalah Ban', category: 'Operasional', description: 'Foto bukti kondisi ban kendaraan' });
  await insertDocFields(dTire, [
    { name: 'Foto Kondisi Ban',               type: 'image',    required: true,  desc: 'Foto ban yang bermasalah' },
    { name: 'Foto Plat Kendaraan',            type: 'image',    required: false, desc: 'Foto plat untuk verifikasi' },
  ]);
  console.log('  ✓ Doc template: tire_issue');

  // Warehousing doc
  const dWh = await insertDocTemplate({ intentCode: 'warehousing_request', name: 'Dokumen Permintaan Gudang', category: 'Logistik', description: 'Dokumen untuk pengajuan layanan gudang' });
  await insertDocFields(dWh, [
    { name: 'Company Profile',                type: 'document', required: false },
    { name: 'NIB / SIUP',                    type: 'document', required: false, desc: 'Untuk klien korporat' },
    { name: 'Daftar Barang yang Akan Disimpan', type: 'document', required: false },
  ]);
  console.log('  ✓ Doc template: warehousing_request');

  // ── PHASE F: Final Count ─────────────────────────────────────────────────────

  console.log('\n=== Phase F: Final Count ===');

  const [im, kr, sc, dt, dtf, doct, doctf] = await Promise.all([
    pool.query(`SELECT COUNT(*) as cnt FROM intent_master WHERE company_id=$1`, [C]),
    pool.query(`SELECT COUNT(*) as cnt FROM keyword_rules WHERE company_id=$1`, [C]),
    pool.query(`SELECT COUNT(*) as cnt FROM service_catalog WHERE company_id=$1`, [C]),
    pool.query(`SELECT COUNT(*) as cnt FROM data_templates WHERE company_id=$1`, [C]),
    pool.query(`SELECT COUNT(*) as cnt FROM data_template_fields dtf JOIN data_templates dt ON dt.id=dtf.template_id WHERE dt.company_id=$1`, [C]),
    pool.query(`SELECT COUNT(*) as cnt FROM document_templates WHERE company_id=$1`, [C]),
    pool.query(`SELECT COUNT(*) as cnt FROM document_template_fields dtf JOIN document_templates dt ON dt.id=dtf.template_id WHERE dt.company_id=$1`, [C]),
  ]);

  console.log(`intent_master:           ${im.rows[0].cnt} (was 30, target ≥48)`);
  console.log(`keyword_rules:           ${kr.rows[0].cnt} (was 220)`);
  console.log(`service_catalog:         ${sc.rows[0].cnt} (was 14)`);
  console.log(`data_templates:          ${dt.rows[0].cnt} (was 6, target ≥24)`);
  console.log(`data_template_fields:    ${dtf.rows[0].cnt} (was 35)`);
  console.log(`document_templates:      ${doct.rows[0].cnt} (was 5, target ≥18)`);
  console.log(`document_template_fields: ${doctf.rows[0].cnt} (was 18)`);

  // Compute coverage per target service
  const targetServices = [
    'trucking_inquiry', 'air_freight_inquiry', 'sea_freight_inquiry',
    'customs_clearance', 'ppjk_service', 'warehousing_request',
    'import_inquiry', 'export_inquiry', 'dg_cargo', 'live_animal_cargo',
    'cold_chain', 'project_cargo', 'fleet_repair', 'fuel_expense',
    'tire_issue', 'permintaan_kasbon', 'damaged_goods_complaint',
    'delivery_delay_complaint', 'pertanyaan_tagihan', 'konfirmasi_pembayaran',
    'permintaan_vendor', 'customer_data_update', 'daftar_tenant', 'booking_lapangan',
  ];

  const { rows: intentCodes } = await pool.query(`SELECT intent_code FROM intent_master WHERE company_id=$1`, [C]);
  const { rows: templateCodes } = await pool.query(`SELECT intent_code FROM data_templates WHERE company_id=$1`, [C]);
  const { rows: docCodes } = await pool.query(`SELECT intent_code FROM document_templates WHERE company_id=$1`, [C]);

  const intentSet = new Set(intentCodes.map(r => r.intent_code));
  const templateSet = new Set(templateCodes.map(r => r.intent_code));
  const docSet = new Set(docCodes.map(r => r.intent_code));

  console.log('\nService Coverage per Target:');
  let totalScore = 0;
  for (const svc of targetServices) {
    const hasIntent = intentSet.has(svc);
    const hasTemplate = templateSet.has(svc);
    const hasDoc = docSet.has(svc);
    const score = (hasIntent ? 34 : 0) + (hasTemplate ? 33 : 0) + (hasDoc ? 33 : 0);
    totalScore += score;
    const status = score >= 67 ? '✅' : score >= 34 ? '⚠️' : '❌';
    console.log(`  ${status} ${svc.padEnd(35)} intent:${hasIntent?'✓':'✗'} template:${hasTemplate?'✓':'✗'} doc:${hasDoc?'✓':'✗'} → ${score}%`);
  }

  const overallCoverage = Math.round(totalScore / targetServices.length);
  console.log(`\n📊 Overall Service Coverage: ${overallCoverage}% (was ~23%, target ≥80%)`);
  console.log(`${overallCoverage >= 80 ? '✅ TARGET MET' : '⚠️ TARGET NOT YET MET — check gaps above'}`);
}

run().catch(console.error).finally(() => pool.end());
