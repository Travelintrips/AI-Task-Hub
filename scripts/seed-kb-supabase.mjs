/**
 * Seed KB (Knowledge Base) lengkap ke Supabase
 * Mencakup 3 vertikal: Sport Center, Logistik, Tenant + General
 *
 * Run: node scripts/seed-kb-supabase.mjs
 *
 * Idempotent: DELETE + INSERT per intent_code/company_id
 * WAJIB menggunakan SUPABASE_DATABASE_URL_DEV — tidak memakai heliumdb
 */

import pkg from "pg";
const { Pool } = pkg;

const CONN = process.env.SUPABASE_DATABASE_URL_DEV || process.env.SUPABASE_DATABASE_URL;
if (!CONN) {
  console.error("❌ SUPABASE_DATABASE_URL_DEV tidak tersedia. Set env var dulu.");
  process.exit(1);
}

const pool = new Pool({ connectionString: CONN, ssl: { rejectUnauthorized: false } });
const COMPANY = "default";

// ─── INTENT MASTER ────────────────────────────────────────────────────────────

const INTENTS = [
  // ── Sport Center ──────────────────────────────────────────────────────────
  { code: "sport_center_booking",         name: "Booking Lapangan Olahraga",      category: "Sport Center", div: "Sport Center", priority: "medium", sla: 2 },
  { code: "sport_center_cancel",          name: "Pembatalan Booking Lapangan",    category: "Sport Center", div: "Sport Center", priority: "high",   sla: 1 },
  { code: "sport_center_inquiry",         name: "Informasi Lapangan & Jadwal",    category: "Sport Center", div: "Sport Center", priority: "low",    sla: 4 },
  { code: "daftar_membership",            name: "Pendaftaran Membership",         category: "Sport Center", div: "Sport Center", priority: "medium", sla: 4 },
  { code: "perpanjang_membership",        name: "Perpanjangan Membership",        category: "Sport Center", div: "Sport Center", priority: "medium", sla: 4 },
  { code: "konfirmasi_pembayaran_sport",  name: "Konfirmasi Pembayaran Lapangan", category: "Sport Center", div: "Finance",      priority: "medium", sla: 2 },
  { code: "laporan_masalah_sport",        name: "Laporan Masalah Fasilitas",      category: "Sport Center", div: "Operations",  priority: "high",   sla: 2 },

  // ── Logistik & Freight ─────────────────────────────────────────────────────
  { code: "permintaan_penawaran",         name: "Permintaan Penawaran Harga",     category: "Logistik",    div: "Sales",        priority: "medium", sla: 4 },
  { code: "cek_status_pengiriman",        name: "Cek Status Pengiriman",          category: "Logistik",    div: "Operations",   priority: "medium", sla: 2 },
  { code: "trucking_inquiry",             name: "Permintaan Trucking / Angkutan", category: "Logistik",    div: "Trucking",     priority: "medium", sla: 4 },
  { code: "air_freight_inquiry",          name: "Permintaan Air Freight",         category: "Logistik",    div: "Air Freight",  priority: "medium", sla: 4 },
  { code: "sea_freight_inquiry",          name: "Permintaan Sea Freight",         category: "Logistik",    div: "Sea Freight",  priority: "medium", sla: 8 },
  { code: "import_inquiry",              name: "Permintaan Import",              category: "Logistik",    div: "Import",       priority: "medium", sla: 8 },
  { code: "export_inquiry",              name: "Permintaan Export",              category: "Logistik",    div: "Export",       priority: "medium", sla: 8 },
  { code: "customs_clearance",           name: "Customs Clearance / Bea Cukai",  category: "Customs",     div: "Customs",      priority: "high",   sla: 4 },
  { code: "damaged_goods_complaint",     name: "Komplain Barang Rusak",          category: "Logistik",    div: "Operations",   priority: "high",   sla: 2 },
  { code: "delivery_delay_complaint",    name: "Komplain Keterlambatan Pengiriman", category: "Logistik", div: "Operations",   priority: "high",   sla: 2 },
  { code: "permintaan_kasbon",           name: "Permintaan Kasbon / Cash Advance", category: "Finance",   div: "Finance",      priority: "medium", sla: 8 },
  { code: "permintaan_vendor",           name: "Permintaan / Registrasi Vendor", category: "Logistik",    div: "Procurement",  priority: "low",    sla: 24 },
  { code: "fleet_repair",               name: "Perbaikan / Service Kendaraan",  category: "Fleet",        div: "Fleet",        priority: "high",   sla: 4 },
  { code: "fuel_expense",               name: "Klaim BBM / Bahan Bakar",        category: "Fleet",        div: "Fleet",        priority: "medium", sla: 8 },
  { code: "tire_issue",                 name: "Masalah Ban Kendaraan",          category: "Fleet",        div: "Fleet",        priority: "high",   sla: 2 },

  // ── Tenant / Kios ─────────────────────────────────────────────────────────
  { code: "daftar_tenant",              name: "Pendaftaran Tenant / Kios Baru", category: "Tenant",       div: "Tenant",       priority: "medium", sla: 8 },
  { code: "info_sewa_tenant",           name: "Informasi Sewa Kios / Tenant",   category: "Tenant",       div: "Tenant",       priority: "low",    sla: 8 },
  { code: "konfirmasi_pembayaran_tenant","name": "Konfirmasi Pembayaran Sewa",  category: "Tenant",       div: "Finance",      priority: "medium", sla: 4 },
  { code: "laporan_masalah_tenant",     name: "Laporan Masalah Tenant",         category: "Tenant",       div: "Operations",   priority: "high",   sla: 4 },
  { code: "perpanjang_kontrak_tenant",  name: "Perpanjangan Kontrak Sewa",      category: "Tenant",       div: "Tenant",       priority: "medium", sla: 24 },

  // ── Finance & General ─────────────────────────────────────────────────────
  { code: "konfirmasi_pembayaran",      name: "Konfirmasi Pembayaran",          category: "Finance",      div: "Finance",      priority: "medium", sla: 4 },
  { code: "pertanyaan_tagihan",         name: "Pertanyaan Tagihan / Invoice",   category: "Finance",      div: "Finance",      priority: "medium", sla: 8 },
  { code: "general_inquiry",            name: "Pertanyaan Umum",                category: "Umum",         div: null,           priority: "low",    sla: 24 },
];

// ─── KEYWORDS ─────────────────────────────────────────────────────────────────

const KEYWORDS = [
  // Sport Center — booking
  ...["booking lapangan","pesan lapangan","reservasi lapangan","sewa lapangan","lapangan futsal","lapangan badminton","lapangan tenis","lapangan basket","lapangan voli","lapangan bola","lapangan sepak bola","lapangan mini soccer","lapangan bulutangkis","lapangan olahraga","main futsal","main badminton","main basket","main voli","main bola","nge futsal","ngefutsal","nge-futsal","futsal dong","ingin pesan lapangan","mau pesan lapangan","slot lapangan","jadwal lapangan","sport center","konfirmasi booking","lanjutkan booking"].map(k=>({code:"sport_center_booking",kw:k,w:2.0})),

  // Sport Center — cancel
  ...["batal booking","batalkan booking","cancel booking","batal lapangan","batalin","tidak jadi","ga jadi","refund booking","kembalikan uang","cancel reservasi"].map(k=>({code:"sport_center_cancel",kw:k,w:2.0})),

  // Sport Center — inquiry
  ...["info lapangan","jadwal lapangan","jam buka","harga lapangan","tarif lapangan","tersedia tidak","ada slot","cek jadwal","informasi lapangan","fasilitas sport","berapa harga"].map(k=>({code:"sport_center_inquiry",kw:k,w:1.8})),

  // Membership
  ...["daftar member","daftar membership","daftar gym","bergabung member","join member","buat member","registrasi member"].map(k=>({code:"daftar_membership",kw:k,w:2.0})),
  ...["perpanjang member","renew member","perpanjangan membership","extend membership","lanjut member"].map(k=>({code:"perpanjang_membership",kw:k,w:2.0})),

  // Konfirmasi bayar sport
  ...["konfirmasi bayar lapangan","bukti transfer sport","sudah bayar lapangan","bayar booking","transfer lapangan","bukti pembayaran sport"].map(k=>({code:"konfirmasi_pembayaran_sport",kw:k,w:2.0})),

  // Laporan masalah sport
  ...["fasilitas rusak","lapangan rusak","AC rusak sport","toilet rusak","keluhan fasilitas","masalah lapangan","komplain sport center"].map(k=>({code:"laporan_masalah_sport",kw:k,w:2.0})),

  // Logistik — penawaran
  ...["minta penawaran","request quotation","butuh quotation","harga pengiriman","tarif pengiriman","biaya kirim","penawaran logistik","rate pengiriman","freight cost","shipping rate"].map(k=>({code:"permintaan_penawaran",kw:k,w:2.0})),

  // Logistik — cek status
  ...["cek status","tracking","lacak pengiriman","dimana barang","status pengiriman","barang sudah sampai","update pengiriman","nomor resi","nomor order"].map(k=>({code:"cek_status_pengiriman",kw:k,w:2.0})),

  // Trucking
  ...["trucking","truk","angkutan darat","sewa truk","kirim darat","cargo darat","ekspedisi darat","kendaraan pengiriman"].map(k=>({code:"trucking_inquiry",kw:k,w:2.0})),

  // Air freight
  ...["air freight","kirim via udara","cargo udara","pengiriman pesawat","express air","udara","by air"].map(k=>({code:"air_freight_inquiry",kw:k,w:2.0})),

  // Sea freight
  ...["sea freight","kirim via laut","cargo laut","kapal","pengiriman laut","by sea","container","FCL","LCL"].map(k=>({code:"sea_freight_inquiry",kw:k,w:2.0})),

  // Import
  ...["import","impor","barang dari luar","kirim dari china","dari korea","dari jepang","bea masuk","beli dari luar negeri","impor barang"].map(k=>({code:"import_inquiry",kw:k,w:2.0})),

  // Export
  ...["export","ekspor","kirim ke luar negeri","ekspor barang","kirim ke malaysia","kirim ke singapore","kirim ke australia"].map(k=>({code:"export_inquiry",kw:k,w:2.0})),

  // Customs
  ...["bea cukai","customs","clearance","PIB","PEB","dokumen pabean","SPPB","lartas","bea masuk","cukai","kepabeanan"].map(k=>({code:"customs_clearance",kw:k,w:2.0})),

  // Damaged goods
  ...["barang rusak","barang pecah","barang hilang","komplain barang","kerusakan barang","barang tidak sampai","barang kurang"].map(k=>({code:"damaged_goods_complaint",kw:k,w:2.0})),

  // Delay
  ...["terlambat","delay","pengiriman lambat","barang belum sampai","lama sekali","kapan sampai","sudah berapa hari"].map(k=>({code:"delivery_delay_complaint",kw:k,w:2.0})),

  // Kasbon
  ...["kasbon","cash advance","minta uang muka","pinjam dulu","dana operasional","talangan","advance payment"].map(k=>({code:"permintaan_kasbon",kw:k,w:2.0})),

  // Vendor
  ...["daftar vendor","registrasi vendor","jadi vendor","supplier baru","onboarding vendor","vendor kami"].map(k=>({code:"permintaan_vendor",kw:k,w:2.0})),

  // Fleet repair
  ...["mobil rusak","kendaraan rusak","service kendaraan","truk mogok","ban kempes","mesin rusak","derek","servis truk","perbaikan kendaraan"].map(k=>({code:"fleet_repair",kw:k,w:2.0})),

  // Fuel
  ...["klaim bbm","bahan bakar","bensin","solar","pertamini","isi bensin","biaya bbm","klaim solar"].map(k=>({code:"fuel_expense",kw:k,w:2.0})),

  // Tire
  ...["ban","ganti ban","ban bocor","ban kempes","ban kendaraan","masalah ban","ban habis"].map(k=>({code:"tire_issue",kw:k,w:2.0})),

  // Tenant — daftar
  ...["daftar tenant","sewa kios","buka kios","rent kios","mau sewa","daftar toko","buka toko","rent tenant","sewa tempat usaha"].map(k=>({code:"daftar_tenant",kw:k,w:2.0})),

  // Tenant — info sewa
  ...["info sewa","informasi kios","harga sewa kios","tarif sewa","ukuran kios","lokasi kios","tersedia kios","syarat sewa"].map(k=>({code:"info_sewa_tenant",kw:k,w:1.8})),

  // Tenant — konfirmasi bayar
  ...["konfirmasi sewa","bayar sewa","bukti transfer sewa","sudah bayar sewa","transfer kios","konfirmasi pembayaran tenant"].map(k=>({code:"konfirmasi_pembayaran_tenant",kw:k,w:2.0})),

  // Tenant — laporan masalah
  ...["masalah kios","kerusakan kios","lampu mati kios","air tidak mengalir","masalah tenant","keluhan kios","komplain kios"].map(k=>({code:"laporan_masalah_tenant",kw:k,w:2.0})),

  // Tenant — perpanjang kontrak
  ...["perpanjang kontrak","renew kontrak","lanjut sewa","extend kios","perpanjang sewa","mau lanjut sewa"].map(k=>({code:"perpanjang_kontrak_tenant",kw:k,w:2.0})),

  // Finance — konfirmasi bayar
  ...["konfirmasi pembayaran","sudah transfer","bukti bayar","kirim bukti transfer","bukti pembayaran","payment proof","sudah dibayar"].map(k=>({code:"konfirmasi_pembayaran",kw:k,w:1.8})),

  // Finance — tagihan
  ...["tagihan","invoice","berapa tagihan","minta invoice","rekening tagihan","total bayar","berapa yang harus dibayar"].map(k=>({code:"pertanyaan_tagihan",kw:k,w:1.8})),

  // General
  ...["halo","hai","hello","selamat pagi","selamat siang","selamat sore","hi","assalamu","permisi","tanya","info","bantuan"].map(k=>({code:"general_inquiry",kw:k,w:0.5})),
];

// ─── DATA TEMPLATES + FIELDS ──────────────────────────────────────────────────

const TEMPLATES = [
  {
    code: "sport_center_booking",
    name: "Template Booking Lapangan",
    category: "Sport Center",
    intakeMode: "conversational",
    useMiniForm: true,
    miniFormType: "field-booking",
    fields: [
      { name: "field_name",    label: "Nama Lapangan / Jenis Olahraga", type: "text",   req: true,  sort: 1, help: "Contoh: Futsal, Badminton, Tenis, Basket", sample: "Futsal" },
      { name: "booking_date",  label: "Tanggal Booking",                type: "date",   req: true,  sort: 2, help: "Format: DD-MM-YYYY", sample: "28-06-2026" },
      { name: "start_time",    label: "Jam Mulai",                      type: "time",   req: true,  sort: 3, help: "Format: HH:MM", sample: "15:00" },
      { name: "end_time",      label: "Jam Selesai",                    type: "time",   req: true,  sort: 4, help: "Format: HH:MM", sample: "17:00" },
      { name: "booker_name",   label: "Nama Pemesan",                   type: "text",   req: true,  sort: 5, help: "Nama lengkap", sample: "Budi Santoso" },
      { name: "phone",         label: "Nomor HP",                       type: "phone",  req: true,  sort: 6, help: "Nomor WhatsApp aktif", sample: "08123456789" },
      { name: "jumlah_pemain", label: "Jumlah Pemain",                  type: "number", req: false, sort: 7, help: "Perkiraan jumlah pemain", sample: "10" },
    ],
  },
  {
    code: "sport_center_cancel",
    name: "Template Pembatalan Booking",
    category: "Sport Center",
    intakeMode: "conversational",
    useMiniForm: false,
    fields: [
      { name: "booking_id",    label: "Nomor Booking / Kode Reservasi", type: "text", req: true,  sort: 1, help: "Nomor booking yang akan dibatalkan", sample: "BK-001" },
      { name: "cancel_reason", label: "Alasan Pembatalan",              type: "text", req: true,  sort: 2, help: "Alasan membatalkan booking", sample: "Mendadak ada acara lain" },
      { name: "booker_name",   label: "Nama Pemesan",                   type: "text", req: true,  sort: 3, help: "Nama yang tertera saat booking", sample: "Budi Santoso" },
    ],
  },
  {
    code: "sport_center_inquiry",
    name: "Template Info Lapangan",
    category: "Sport Center",
    intakeMode: "conversational",
    useMiniForm: false,
    fields: [
      { name: "inquiry_type",  label: "Informasi yang Dicari",          type: "text", req: true,  sort: 1, help: "Contoh: harga, jadwal, fasilitas, ketersediaan", sample: "harga lapangan futsal" },
      { name: "preferred_date",label: "Tanggal yang Diinginkan",        type: "date", req: false, sort: 2, help: "Jika ingin cek ketersediaan di tanggal tertentu", sample: "28-06-2026" },
    ],
  },
  {
    code: "daftar_membership",
    name: "Template Pendaftaran Membership",
    category: "Sport Center",
    intakeMode: "conversational",
    useMiniForm: false,
    fields: [
      { name: "member_name",   label: "Nama Lengkap",                   type: "text",   req: true,  sort: 1, sample: "Andi Wijaya" },
      { name: "phone",         label: "Nomor HP / WhatsApp",            type: "phone",  req: true,  sort: 2, sample: "08123456789" },
      { name: "email",         label: "Email",                          type: "text",   req: false, sort: 3, sample: "andi@email.com" },
      { name: "package_type",  label: "Paket Membership yang Diinginkan", type: "text", req: true,  sort: 4, help: "Contoh: Bulanan, 3 Bulan, Tahunan", sample: "Bulanan" },
      { name: "start_date",    label: "Tanggal Mulai Membership",       type: "date",   req: false, sort: 5, sample: "01-07-2026" },
    ],
  },
  {
    code: "perpanjang_membership",
    name: "Template Perpanjangan Membership",
    category: "Sport Center",
    intakeMode: "conversational",
    useMiniForm: false,
    fields: [
      { name: "member_id",     label: "Nomor Member / ID Member",       type: "text",   req: true,  sort: 1, sample: "MBR-001" },
      { name: "member_name",   label: "Nama Member",                    type: "text",   req: true,  sort: 2, sample: "Andi Wijaya" },
      { name: "extend_period", label: "Durasi Perpanjangan",            type: "text",   req: true,  sort: 3, help: "Contoh: 1 bulan, 3 bulan, 1 tahun", sample: "1 bulan" },
    ],
  },
  {
    code: "konfirmasi_pembayaran_sport",
    name: "Template Konfirmasi Bayar Lapangan",
    category: "Sport Center",
    intakeMode: "document_upload",
    useMiniForm: false,
    fields: [
      { name: "booking_id",    label: "Nomor Booking",                  type: "text",   req: true,  sort: 1, sample: "BK-001" },
      { name: "payment_amount",label: "Jumlah yang Dibayar",            type: "number", req: true,  sort: 2, sample: "200000" },
      { name: "payment_proof", label: "Bukti Transfer / Screenshot",    type: "file",   req: true,  sort: 3, help: "Upload foto bukti transfer" },
    ],
  },
  {
    code: "laporan_masalah_sport",
    name: "Template Laporan Masalah Fasilitas",
    category: "Sport Center",
    intakeMode: "conversational",
    useMiniForm: false,
    fields: [
      { name: "problem_location", label: "Lokasi / Lapangan Bermasalah", type: "text", req: true,  sort: 1, sample: "Lapangan Futsal A" },
      { name: "problem_desc",     label: "Deskripsi Masalah",            type: "text", req: true,  sort: 2, sample: "AC tidak berfungsi" },
      { name: "reporter_name",    label: "Nama Pelapor",                 type: "text", req: true,  sort: 3, sample: "Budi" },
    ],
  },
  // ── Logistik ────────────────────────────────────────────────────────────────
  {
    code: "permintaan_penawaran",
    name: "Template Permintaan Penawaran",
    category: "Logistik",
    intakeMode: "conversational",
    useMiniForm: false,
    fields: [
      { name: "commodity",      label: "Jenis Barang / Komoditi",       type: "text",   req: true,  sort: 1, sample: "Elektronik" },
      { name: "origin",         label: "Kota / Pelabuhan Asal",         type: "text",   req: true,  sort: 2, sample: "Surabaya" },
      { name: "destination",    label: "Kota / Negara Tujuan",          type: "text",   req: true,  sort: 3, sample: "Jakarta" },
      { name: "shipment_type",  label: "Jenis Pengiriman",              type: "text",   req: true,  sort: 4, help: "Darat / Udara / Laut / FCL / LCL", sample: "Darat" },
      { name: "weight_volume",  label: "Berat / Volume",                type: "text",   req: false, sort: 5, sample: "500 kg" },
      { name: "target_date",    label: "Tanggal Pengiriman Target",     type: "date",   req: false, sort: 6, sample: "30-06-2026" },
    ],
  },
  {
    code: "cek_status_pengiriman",
    name: "Template Cek Status Pengiriman",
    category: "Logistik",
    intakeMode: "conversational",
    useMiniForm: false,
    fields: [
      { name: "order_number",   label: "Nomor Order / Resi",            type: "text",   req: true,  sort: 1, sample: "ORD-20260001" },
      { name: "shipper_name",   label: "Nama Pengirim",                 type: "text",   req: false, sort: 2, sample: "PT Maju Bersama" },
    ],
  },
  {
    code: "trucking_inquiry",
    name: "Template Permintaan Trucking",
    category: "Logistik",
    intakeMode: "conversational",
    useMiniForm: false,
    fields: [
      { name: "commodity",      label: "Jenis Barang",                  type: "text",   req: true,  sort: 1, sample: "Sembako" },
      { name: "origin",         label: "Kota Asal",                     type: "text",   req: true,  sort: 2, sample: "Surabaya" },
      { name: "destination",    label: "Kota Tujuan",                   type: "text",   req: true,  sort: 3, sample: "Malang" },
      { name: "truck_type",     label: "Jenis Kendaraan",               type: "text",   req: false, sort: 4, help: "Truk bak / Box / CDD / CDE", sample: "CDD" },
      { name: "weight_volume",  label: "Berat / Muatan",                type: "text",   req: false, sort: 5, sample: "2 ton" },
      { name: "pickup_date",    label: "Tanggal Pickup",                type: "date",   req: false, sort: 6, sample: "30-06-2026" },
    ],
  },
  {
    code: "air_freight_inquiry",
    name: "Template Permintaan Air Freight",
    category: "Logistik",
    intakeMode: "conversational",
    useMiniForm: false,
    fields: [
      { name: "commodity",      label: "Jenis Barang / Komoditi",       type: "text",   req: true,  sort: 1, sample: "Dokumen penting" },
      { name: "origin",         label: "Bandara / Kota Asal",           type: "text",   req: true,  sort: 2, sample: "Jakarta (CGK)" },
      { name: "destination",    label: "Bandara / Kota Tujuan",         type: "text",   req: true,  sort: 3, sample: "Singapore (SIN)" },
      { name: "weight_volume",  label: "Berat / Volume",                type: "text",   req: false, sort: 4, sample: "10 kg" },
      { name: "target_date",    label: "Tanggal Pengiriman",            type: "date",   req: false, sort: 5, sample: "30-06-2026" },
    ],
  },
  {
    code: "sea_freight_inquiry",
    name: "Template Permintaan Sea Freight",
    category: "Logistik",
    intakeMode: "conversational",
    useMiniForm: false,
    fields: [
      { name: "commodity",      label: "Jenis Barang / Komoditi",       type: "text",   req: true,  sort: 1, sample: "Bahan baku plastik" },
      { name: "origin",         label: "Pelabuhan / Kota Asal",         type: "text",   req: true,  sort: 2, sample: "Surabaya (TANJUNG PERAK)" },
      { name: "destination",    label: "Pelabuhan / Kota Tujuan",       type: "text",   req: true,  sort: 3, sample: "Makassar (SOEKARNO HATTA)" },
      { name: "container_type", label: "Tipe Container",                type: "text",   req: false, sort: 4, help: "FCL 20ft / FCL 40ft / LCL", sample: "FCL 20ft" },
      { name: "weight_volume",  label: "Berat / CBM",                   type: "text",   req: false, sort: 5, sample: "10 CBM" },
    ],
  },
  {
    code: "import_inquiry",
    name: "Template Permintaan Import",
    category: "Logistik",
    intakeMode: "conversational",
    useMiniForm: false,
    fields: [
      { name: "commodity",      label: "Jenis Barang / Komoditi",       type: "text",   req: true,  sort: 1, sample: "Mesin industri" },
      { name: "origin_country", label: "Negara Asal Barang",            type: "text",   req: true,  sort: 2, sample: "China" },
      { name: "hs_code",        label: "HS Code (jika tahu)",           type: "text",   req: false, sort: 3, sample: "8477.10.00" },
      { name: "shipment_type",  label: "Jalur Pengiriman",              type: "text",   req: false, sort: 4, help: "Udara / Laut", sample: "Laut" },
      { name: "weight_volume",  label: "Berat / Volume Estimasi",       type: "text",   req: false, sort: 5, sample: "500 kg" },
    ],
  },
  {
    code: "export_inquiry",
    name: "Template Permintaan Export",
    category: "Logistik",
    intakeMode: "conversational",
    useMiniForm: false,
    fields: [
      { name: "commodity",         label: "Jenis Barang Ekspor",        type: "text",   req: true,  sort: 1, sample: "Furnitur rotan" },
      { name: "destination_country",label: "Negara Tujuan",            type: "text",   req: true,  sort: 2, sample: "Belanda" },
      { name: "shipment_type",     label: "Jalur Pengiriman",           type: "text",   req: false, sort: 3, help: "Udara / Laut", sample: "Laut" },
      { name: "weight_volume",     label: "Berat / Volume",             type: "text",   req: false, sort: 4, sample: "200 kg" },
      { name: "export_license",    label: "Punya Izin Ekspor?",         type: "text",   req: false, sort: 5, help: "Ya / Tidak / Dalam Proses", sample: "Ya" },
    ],
  },
  {
    code: "customs_clearance",
    name: "Template Customs Clearance",
    category: "Customs",
    intakeMode: "document_upload",
    useMiniForm: false,
    fields: [
      { name: "document_type",  label: "Jenis Dokumen (BL/AWB/Invoice)", type: "text", req: true,  sort: 1, sample: "Bill of Lading" },
      { name: "commodity",      label: "Jenis Barang",                   type: "text", req: true,  sort: 2, sample: "Elektronik" },
      { name: "origin_country", label: "Negara Asal",                    type: "text", req: true,  sort: 3, sample: "China" },
      { name: "invoice_value",  label: "Nilai Invoice (USD)",            type: "text", req: false, sort: 4, sample: "5000" },
    ],
  },
  {
    code: "damaged_goods_complaint",
    name: "Template Komplain Barang Rusak",
    category: "Logistik",
    intakeMode: "conversational",
    useMiniForm: false,
    fields: [
      { name: "order_number",   label: "Nomor Order / Resi",            type: "text",   req: true,  sort: 1, sample: "ORD-20260001" },
      { name: "damage_desc",    label: "Deskripsi Kerusakan",           type: "text",   req: true,  sort: 2, sample: "Box penyok, isi pecah" },
      { name: "damage_photo",   label: "Foto Kerusakan (opsional)",     type: "file",   req: false, sort: 3, help: "Upload foto kondisi barang" },
      { name: "claim_amount",   label: "Nilai Klaim (estimasi)",        type: "number", req: false, sort: 4, sample: "500000" },
    ],
  },
  {
    code: "delivery_delay_complaint",
    name: "Template Komplain Keterlambatan",
    category: "Logistik",
    intakeMode: "conversational",
    useMiniForm: false,
    fields: [
      { name: "order_number",   label: "Nomor Order / Resi",            type: "text",   req: true,  sort: 1, sample: "ORD-20260001" },
      { name: "expected_date",  label: "Tanggal Seharusnya Tiba",       type: "date",   req: true,  sort: 2, sample: "25-06-2026" },
      { name: "current_status", label: "Status Terakhir yang Diketahui",type: "text",   req: false, sort: 3, sample: "Masih di gudang transit" },
    ],
  },
  {
    code: "permintaan_kasbon",
    name: "Template Kasbon / Cash Advance",
    category: "Finance",
    intakeMode: "conversational",
    useMiniForm: false,
    fields: [
      { name: "requester_name", label: "Nama Pemohon",                  type: "text",   req: true,  sort: 1, sample: "Budi Santoso" },
      { name: "amount",         label: "Jumlah yang Diminta (Rp)",      type: "number", req: true,  sort: 2, sample: "2000000" },
      { name: "purpose",        label: "Keperluan / Tujuan Kasbon",     type: "text",   req: true,  sort: 3, sample: "Biaya operasional lapangan" },
      { name: "repayment_date", label: "Rencana Pengembalian",          type: "date",   req: false, sort: 4, sample: "30-06-2026" },
    ],
  },
  {
    code: "permintaan_vendor",
    name: "Template Registrasi Vendor",
    category: "Logistik",
    intakeMode: "conversational",
    useMiniForm: false,
    fields: [
      { name: "company_name",   label: "Nama Perusahaan / Vendor",      type: "text",   req: true,  sort: 1, sample: "PT Supplier Maju" },
      { name: "contact_name",   label: "Nama PIC",                      type: "text",   req: true,  sort: 2, sample: "Andi" },
      { name: "contact_phone",  label: "Nomor HP / WhatsApp",           type: "phone",  req: true,  sort: 3, sample: "08123456789" },
      { name: "service_type",   label: "Jenis Layanan / Produk",        type: "text",   req: true,  sort: 4, sample: "Penyedia ban truk" },
      { name: "npwp",           label: "NPWP Perusahaan",               type: "text",   req: false, sort: 5, sample: "01.234.567.8-901.000" },
    ],
  },
  {
    code: "fleet_repair",
    name: "Template Perbaikan Kendaraan",
    category: "Fleet",
    intakeMode: "conversational",
    useMiniForm: false,
    fields: [
      { name: "plate_number",   label: "Nomor Polisi Kendaraan",        type: "text",   req: true,  sort: 1, sample: "B 1234 ABC" },
      { name: "damage_desc",    label: "Kerusakan / Masalah",           type: "text",   req: true,  sort: 2, sample: "Mesin tidak mau menyala" },
      { name: "location",       label: "Lokasi Kendaraan Sekarang",     type: "text",   req: true,  sort: 3, sample: "Gudang Surabaya" },
      { name: "driver_name",    label: "Nama Sopir",                    type: "text",   req: false, sort: 4, sample: "Pak Joko" },
      { name: "urgency",        label: "Tingkat Urgensi",               type: "text",   req: false, sort: 5, help: "Normal / Urgent / Darurat", sample: "Urgent" },
    ],
  },
  {
    code: "fuel_expense",
    name: "Template Klaim BBM",
    category: "Fleet",
    intakeMode: "document_upload",
    useMiniForm: false,
    fields: [
      { name: "plate_number",   label: "Nomor Polisi Kendaraan",        type: "text",   req: true,  sort: 1, sample: "B 1234 ABC" },
      { name: "fuel_amount",    label: "Jumlah Liter",                  type: "number", req: true,  sort: 2, sample: "50" },
      { name: "total_cost",     label: "Total Biaya (Rp)",              type: "number", req: true,  sort: 3, sample: "450000" },
      { name: "receipt_photo",  label: "Struk / Bukti Pengisian",       type: "file",   req: true,  sort: 4, help: "Upload foto struk BBM" },
      { name: "trip_route",     label: "Rute Perjalanan",               type: "text",   req: false, sort: 5, sample: "Surabaya - Malang" },
    ],
  },
  {
    code: "tire_issue",
    name: "Template Masalah Ban",
    category: "Fleet",
    intakeMode: "conversational",
    useMiniForm: false,
    fields: [
      { name: "plate_number",   label: "Nomor Polisi Kendaraan",        type: "text",   req: true,  sort: 1, sample: "B 1234 ABC" },
      { name: "tire_position",  label: "Posisi Ban Bermasalah",         type: "text",   req: true,  sort: 2, help: "Depan kiri/kanan, belakang kiri/kanan", sample: "Belakang kiri" },
      { name: "issue_type",     label: "Jenis Masalah",                 type: "text",   req: true,  sort: 3, help: "Bocor / Gundul / Pecah / Ganti rutin", sample: "Bocor" },
      { name: "location",       label: "Lokasi Kendaraan",              type: "text",   req: false, sort: 4, sample: "Tol Cipali KM 72" },
    ],
  },
  // ── Tenant ─────────────────────────────────────────────────────────────────
  {
    code: "daftar_tenant",
    name: "Template Pendaftaran Tenant Baru",
    category: "Tenant",
    intakeMode: "conversational",
    useMiniForm: false,
    fields: [
      { name: "business_name",    label: "Nama Usaha / Toko",           type: "text",   req: true,  sort: 1, sample: "Warung Makan Pak Joko" },
      { name: "owner_name",       label: "Nama Pemilik",                type: "text",   req: true,  sort: 2, sample: "Pak Joko" },
      { name: "contact_phone",    label: "Nomor HP / WhatsApp",         type: "phone",  req: true,  sort: 3, sample: "08123456789" },
      { name: "business_category",label: "Jenis Usaha",                 type: "text",   req: true,  sort: 4, help: "Contoh: F&B, Fashion, Elektronik, Jasa", sample: "F&B" },
      { name: "desired_area",     label: "Luas Kios yang Diinginkan (m²)", type: "text",req: false, sort: 5, sample: "12 m²" },
      { name: "desired_location", label: "Preferensi Lokasi",           type: "text",   req: false, sort: 6, help: "Lantai / Zona yang diinginkan", sample: "Lantai 1 dekat pintu masuk" },
    ],
  },
  {
    code: "info_sewa_tenant",
    name: "Template Info Sewa Kios",
    category: "Tenant",
    intakeMode: "conversational",
    useMiniForm: false,
    fields: [
      { name: "business_type",  label: "Jenis Usaha yang Akan Dibuka",  type: "text",   req: true,  sort: 1, sample: "Kedai kopi" },
      { name: "desired_area",   label: "Luas Kios yang Diinginkan (m²)",type: "text",   req: false, sort: 2, sample: "10–15 m²" },
    ],
  },
  {
    code: "konfirmasi_pembayaran_tenant",
    name: "Template Konfirmasi Bayar Sewa",
    category: "Tenant",
    intakeMode: "document_upload",
    useMiniForm: false,
    fields: [
      { name: "tenant_name",    label: "Nama Tenant / Usaha",           type: "text",   req: true,  sort: 1, sample: "Warung Makan Pak Joko" },
      { name: "invoice_number", label: "Nomor Invoice / Tagihan",       type: "text",   req: false, sort: 2, sample: "INV-2026-001" },
      { name: "payment_amount", label: "Jumlah yang Dibayar (Rp)",      type: "number", req: true,  sort: 3, sample: "5000000" },
      { name: "payment_proof",  label: "Bukti Transfer / Kwitansi",     type: "file",   req: true,  sort: 4, help: "Upload foto bukti pembayaran" },
    ],
  },
  {
    code: "laporan_masalah_tenant",
    name: "Template Laporan Masalah Tenant",
    category: "Tenant",
    intakeMode: "conversational",
    useMiniForm: false,
    fields: [
      { name: "tenant_name",    label: "Nama Tenant / Kios",            type: "text",   req: true,  sort: 1, sample: "Kios A-12" },
      { name: "problem_desc",   label: "Deskripsi Masalah",             type: "text",   req: true,  sort: 2, sample: "Lampu di kios tidak menyala" },
      { name: "urgency",        label: "Tingkat Urgensi",               type: "text",   req: false, sort: 3, help: "Normal / Mendesak", sample: "Mendesak" },
    ],
  },
  {
    code: "perpanjang_kontrak_tenant",
    name: "Template Perpanjangan Kontrak Sewa",
    category: "Tenant",
    intakeMode: "conversational",
    useMiniForm: false,
    fields: [
      { name: "tenant_name",    label: "Nama Tenant / Usaha",           type: "text",   req: true,  sort: 1, sample: "Warung Makan Pak Joko" },
      { name: "kios_number",    label: "Nomor / Lokasi Kios",           type: "text",   req: true,  sort: 2, sample: "Kios A-12" },
      { name: "extend_period",  label: "Durasi Perpanjangan",           type: "text",   req: true,  sort: 3, help: "Contoh: 6 bulan, 1 tahun", sample: "1 tahun" },
      { name: "contact_phone",  label: "Nomor HP Penanggung Jawab",     type: "phone",  req: false, sort: 4, sample: "08123456789" },
    ],
  },
  // ── Finance & General ──────────────────────────────────────────────────────
  {
    code: "konfirmasi_pembayaran",
    name: "Template Konfirmasi Pembayaran Umum",
    category: "Finance",
    intakeMode: "document_upload",
    useMiniForm: false,
    fields: [
      { name: "reference_number",label: "Nomor Referensi / Invoice",    type: "text",   req: false, sort: 1, sample: "INV-2026-001" },
      { name: "payment_amount",  label: "Jumlah yang Dibayar (Rp)",     type: "number", req: true,  sort: 2, sample: "1000000" },
      { name: "payment_proof",   label: "Bukti Transfer",               type: "file",   req: true,  sort: 3, help: "Upload foto / screenshot bukti transfer" },
    ],
  },
  {
    code: "pertanyaan_tagihan",
    name: "Template Pertanyaan Tagihan",
    category: "Finance",
    intakeMode: "conversational",
    useMiniForm: false,
    fields: [
      { name: "invoice_number",  label: "Nomor Invoice / Tagihan",      type: "text",   req: false, sort: 1, sample: "INV-2026-001" },
      { name: "period",          label: "Periode Tagihan",              type: "text",   req: false, sort: 2, sample: "Juni 2026" },
      { name: "payer_name",      label: "Nama Penyewa / Pelanggan",     type: "text",   req: true,  sort: 3, sample: "PT Maju Bersama" },
    ],
  },
];

// ─── SEED FUNCTIONS ───────────────────────────────────────────────────────────

async function seedIntents() {
  console.log("\n📌 Seeding intent_master...");
  let inserted = 0, skipped = 0;
  for (const i of INTENTS) {
    // Delete existing and re-insert (idempotent)
    await pool.query(
      `DELETE FROM intent_master WHERE company_id=$1 AND intent_code=$2`,
      [COMPANY, i.code]
    );
    await pool.query(
      `INSERT INTO intent_master (company_id, intent_code, intent_name, category, suggested_category, suggested_division, suggested_priority, sla_hours, is_active, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,NOW(),NOW())`,
      [COMPANY, i.code, i.name, i.category, i.category, i.div, i.priority, i.sla]
    );
    inserted++;
    process.stdout.write(`  ✅ ${i.code}\n`);
  }
  console.log(`  → ${inserted} intents di-seed.`);
}

async function seedKeywords() {
  console.log("\n🔑 Seeding keyword_rules...");
  // Delete all existing keywords for this company
  const { rowCount } = await pool.query(
    `DELETE FROM keyword_rules WHERE company_id=$1`,
    [COMPANY]
  );
  console.log(`  🗑️  Hapus ${rowCount} keyword lama`);

  let inserted = 0;
  // Batch insert
  for (const kw of KEYWORDS) {
    await pool.query(
      `INSERT INTO keyword_rules (company_id, intent_code, keyword, weight, is_active, created_at)
       VALUES ($1,$2,$3,$4,true,NOW())`,
      [COMPANY, kw.code, kw.kw, kw.w]
    );
    inserted++;
  }
  console.log(`  ✅ ${inserted} keywords di-seed.`);
}

async function seedTemplates() {
  console.log("\n📋 Seeding data_templates + fields...");
  let tInserted = 0, fInserted = 0;
  for (const t of TEMPLATES) {
    // Delete existing template + fields (cascade)
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
      `INSERT INTO data_templates (company_id, intent_code, name, category, description, is_active, use_mini_form, mini_form_type, intake_mode, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,true,$6,$7,$8,NOW(),NOW()) RETURNING id`,
      [
        COMPANY, t.code, t.name, t.category,
        `Template untuk intent ${t.code}`,
        t.useMiniForm ?? false,
        t.miniFormType ?? null,
        t.intakeMode ?? "conversational",
      ]
    );
    const templateId = rows[0].id;
    tInserted++;

    for (const f of t.fields) {
      await pool.query(
        `INSERT INTO data_template_fields (template_id, field_name, field_label, field_type, is_required, sort_order, help_text, sample_value, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
        [templateId, f.name, f.label, f.type, f.req, f.sort, f.help ?? null, f.sample ?? null]
      );
      fInserted++;
    }
    console.log(`  ✅ [${t.category}] ${t.code} — ${t.fields.length} fields`);
  }
  console.log(`  → ${tInserted} templates, ${fInserted} fields di-seed.`);
}

// ─── RUN ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🚀 KB Seed Script — Target: Supabase");
  console.log(`   DB: ${CONN.replace(/:([^:@]+)@/, ":***@")}`);

  try {
    await seedIntents();
    await seedKeywords();
    await seedTemplates();

    // Final count
    const [r1, r2, r3, r4] = await Promise.all([
      pool.query("SELECT COUNT(*) as cnt FROM intent_master WHERE is_active=true AND company_id=$1", [COMPANY]),
      pool.query("SELECT COUNT(*) as cnt FROM keyword_rules WHERE is_active=true AND company_id=$1", [COMPANY]),
      pool.query("SELECT COUNT(*) as cnt FROM data_templates WHERE is_active=true AND company_id=$1", [COMPANY]),
      pool.query("SELECT COUNT(*) as cnt FROM data_template_fields dtf JOIN data_templates dt ON dt.id=dtf.template_id WHERE dt.company_id=$1", [COMPANY]),
    ]);
    console.log("\n✅ SELESAI — Statistik Supabase:");
    console.log(`   Intent aktif    : ${r1.rows[0].cnt}`);
    console.log(`   Keywords aktif  : ${r2.rows[0].cnt}`);
    console.log(`   Data templates  : ${r3.rows[0].cnt}`);
    console.log(`   Template fields : ${r4.rows[0].cnt}`);
  } catch (err) {
    console.error("❌ Error:", err.message);
    throw err;
  } finally {
    await pool.end();
  }
}

main();
