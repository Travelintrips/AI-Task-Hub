/**
 * Seed script: data_templates + data_template_fields
 * Covers ALL intents in both DEV and PRODUCTION databases.
 *
 * Usage:
 *   node scripts/seed-templates.mjs dev
 *   node scripts/seed-templates.mjs prod
 *   node scripts/seed-templates.mjs all
 */

import pg from "pg";
const { Pool } = pg;

const DB = {
  dev:  process.env.SUPABASE_DATABASE_URL_DEV,
  prod: process.env.SUPABASE_DATABASE_URL,
};

// ─── Form-type field definitions ─────────────────────────────────────────────

const FIELDS = {
  trucking: [
    { field_name: "pickup_address",   field_label: "Alamat Pickup",       field_type: "text",     is_required: true,  sort_order: 1, sample_value: "Jl. Raya No.1, Jakarta" },
    { field_name: "delivery_address", field_label: "Alamat Tujuan",       field_type: "text",     is_required: true,  sort_order: 2, sample_value: "Jl. Sudirman No.5, Surabaya" },
    { field_name: "cargo_type",       field_label: "Jenis Muatan",        field_type: "text",     is_required: true,  sort_order: 3, sample_value: "Elektronik" },
    { field_name: "cargo_weight",     field_label: "Berat Muatan (kg)",   field_type: "number",   is_required: true,  sort_order: 4, sample_value: "500" },
    { field_name: "cargo_volume",     field_label: "Volume (m³)",         field_type: "number",   is_required: false, sort_order: 5, sample_value: "2.5" },
    { field_name: "vehicle_type",     field_label: "Jenis Kendaraan",     field_type: "select",   is_required: false, sort_order: 6, sample_value: "CDD", help_text: "CDD, CDE, Fuso, Trailer, Engkel, Pickup" },
    { field_name: "pickup_date",      field_label: "Tanggal Pickup",      field_type: "date",     is_required: true,  sort_order: 7 },
    { field_name: "contact_person",   field_label: "Nama Kontak",         field_type: "text",     is_required: true,  sort_order: 8, sample_value: "Budi Santoso" },
    { field_name: "phone",            field_label: "No. HP Kontak",       field_type: "text",     is_required: true,  sort_order: 9, sample_value: "08123456789" },
    { field_name: "notes",            field_label: "Catatan Tambahan",    field_type: "textarea", is_required: false, sort_order: 10 },
  ],
  freight: [
    { field_name: "origin_country",      field_label: "Negara Asal",          field_type: "text",   is_required: true,  sort_order: 1, sample_value: "China" },
    { field_name: "destination_country", field_label: "Negara Tujuan",        field_type: "text",   is_required: true,  sort_order: 2, sample_value: "Indonesia" },
    { field_name: "port_origin",         field_label: "Pelabuhan Asal",       field_type: "text",   is_required: false, sort_order: 3, sample_value: "Shanghai Port" },
    { field_name: "port_destination",    field_label: "Pelabuhan Tujuan",     field_type: "text",   is_required: false, sort_order: 4, sample_value: "Tanjung Priok" },
    { field_name: "commodity",           field_label: "Jenis Komoditi",       field_type: "text",   is_required: true,  sort_order: 5, sample_value: "Elektronik" },
    { field_name: "hs_code",             field_label: "HS Code",              field_type: "text",   is_required: false, sort_order: 6, sample_value: "8517.12" },
    { field_name: "gross_weight",        field_label: "Berat Kotor (kg)",     field_type: "number", is_required: true,  sort_order: 7, sample_value: "1000" },
    { field_name: "volume",              field_label: "Volume (m³/CBM)",      field_type: "number", is_required: true,  sort_order: 8, sample_value: "5" },
    { field_name: "shipment_type",       field_label: "Jenis Pengiriman",     field_type: "select", is_required: true,  sort_order: 9, sample_value: "FCL", help_text: "FCL, LCL, Air Freight" },
    { field_name: "ready_date",          field_label: "Tanggal Kargo Siap",   field_type: "date",   is_required: true,  sort_order: 10 },
    { field_name: "consignee_name",      field_label: "Nama Consignee",       field_type: "text",   is_required: true,  sort_order: 11, sample_value: "PT Maju Bersama" },
    { field_name: "contact_person",      field_label: "Nama Kontak",          field_type: "text",   is_required: true,  sort_order: 12, sample_value: "Andi Wijaya" },
    { field_name: "notes",               field_label: "Catatan Tambahan",     field_type: "textarea", is_required: false, sort_order: 13 },
  ],
  complaint: [
    { field_name: "order_number",    field_label: "Nomor Order/DO",         field_type: "text",     is_required: true,  sort_order: 1, sample_value: "DO-2024-001" },
    { field_name: "complaint_type",  field_label: "Jenis Komplain",         field_type: "select",   is_required: true,  sort_order: 2, sample_value: "Kerusakan Barang", help_text: "Kerusakan Barang, Keterlambatan, Kekurangan Barang, Lainnya" },
    { field_name: "incident_date",   field_label: "Tanggal Kejadian",       field_type: "date",     is_required: true,  sort_order: 3 },
    { field_name: "description",     field_label: "Deskripsi Masalah",      field_type: "textarea", is_required: true,  sort_order: 4, sample_value: "Barang tiba dalam kondisi rusak pada bagian sudut kiri" },
    { field_name: "estimated_loss",  field_label: "Estimasi Kerugian (Rp)", field_type: "number",   is_required: false, sort_order: 5, sample_value: "5000000" },
    { field_name: "evidence_photo",  field_label: "Foto Bukti",             field_type: "file",     is_required: false, sort_order: 6, help_text: "Upload foto kerusakan/bukti komplain" },
    { field_name: "contact_person",  field_label: "Nama Pelapor",           field_type: "text",     is_required: true,  sort_order: 7, sample_value: "Sari Dewi" },
    { field_name: "phone",           field_label: "No. HP",                 field_type: "text",     is_required: true,  sort_order: 8, sample_value: "08123456789" },
  ],
  "fleet-repair": [
    { field_name: "vehicle_number",  field_label: "Nomor Kendaraan/Plat",   field_type: "text",     is_required: true,  sort_order: 1, sample_value: "B 1234 CD" },
    { field_name: "vehicle_type",    field_label: "Jenis Kendaraan",        field_type: "text",     is_required: true,  sort_order: 2, sample_value: "Truk CDD" },
    { field_name: "damage_type",     field_label: "Jenis Kerusakan",        field_type: "select",   is_required: true,  sort_order: 3, sample_value: "Mesin", help_text: "Mesin, Ban, Rem, Transmisi, Body, Elektrikal, Lainnya" },
    { field_name: "damage_detail",   field_label: "Detail Kerusakan",       field_type: "textarea", is_required: true,  sort_order: 4, sample_value: "Mesin mati mendadak saat perjalanan" },
    { field_name: "current_location",field_label: "Lokasi Kendaraan Saat Ini", field_type: "text",  is_required: true,  sort_order: 5, sample_value: "Tol Cipularang KM 72" },
    { field_name: "incident_date",   field_label: "Tanggal/Jam Kejadian",   field_type: "date",     is_required: true,  sort_order: 6 },
    { field_name: "driver_name",     field_label: "Nama Pengemudi",         field_type: "text",     is_required: true,  sort_order: 7, sample_value: "Wahyu Hidayat" },
    { field_name: "driver_phone",    field_label: "No. HP Pengemudi",       field_type: "text",     is_required: true,  sort_order: 8, sample_value: "08123456789" },
    { field_name: "urgency",         field_label: "Tingkat Urgensi",        field_type: "select",   is_required: true,  sort_order: 9, sample_value: "Darurat", help_text: "Darurat (mogok di jalan), Segera (besok), Normal" },
    { field_name: "photo",           field_label: "Foto Kerusakan",         field_type: "file",     is_required: false, sort_order: 10 },
  ],
  "cash-advance": [
    { field_name: "requester_name",  field_label: "Nama Pemohon",           field_type: "text",     is_required: true,  sort_order: 1, sample_value: "Ahmad Fauzi" },
    { field_name: "department",      field_label: "Divisi/Departemen",      field_type: "text",     is_required: true,  sort_order: 2, sample_value: "Operasional" },
    { field_name: "amount",          field_label: "Jumlah Yang Diminta (Rp)", field_type: "number", is_required: true,  sort_order: 3, sample_value: "2000000" },
    { field_name: "purpose",         field_label: "Keperluan/Tujuan",       field_type: "textarea", is_required: true,  sort_order: 4, sample_value: "Pembelian suku cadang ban darurat" },
    { field_name: "needed_date",     field_label: "Tanggal Dibutuhkan",     field_type: "date",     is_required: true,  sort_order: 5 },
    { field_name: "reference_doc",   field_label: "Nomor DO/Order Terkait", field_type: "text",     is_required: false, sort_order: 6, sample_value: "DO-2024-055" },
    { field_name: "bank_account",    field_label: "No. Rekening",           field_type: "text",     is_required: false, sort_order: 7, sample_value: "BCA 1234567890 a.n Ahmad Fauzi" },
    { field_name: "approval_note",   field_label: "Keterangan Tambahan",    field_type: "textarea", is_required: false, sort_order: 8 },
  ],
  "field-booking": [
    { field_name: "field_name",      field_label: "Nama/Jenis Lapangan",    field_type: "select",   is_required: true,  sort_order: 1, sample_value: "Lapangan Badminton", help_text: "Badminton, Futsal, Basket, Tenis, Voli" },
    { field_name: "booking_date",    field_label: "Tanggal Booking",        field_type: "date",     is_required: true,  sort_order: 2 },
    { field_name: "start_time",      field_label: "Jam Mulai",              field_type: "text",     is_required: true,  sort_order: 3, sample_value: "08:00", help_text: "Format: HH:MM, contoh 08:00" },
    { field_name: "end_time",        field_label: "Jam Selesai",            field_type: "text",     is_required: true,  sort_order: 4, sample_value: "10:00" },
    { field_name: "duration_hours",  field_label: "Durasi (jam)",           field_type: "number",   is_required: false, sort_order: 5, sample_value: "2" },
    { field_name: "player_count",    field_label: "Jumlah Pemain",          field_type: "number",   is_required: false, sort_order: 6, sample_value: "4" },
    { field_name: "booker_name",     field_label: "Nama Pemesan",           field_type: "text",     is_required: true,  sort_order: 7, sample_value: "Rina Kusuma" },
    { field_name: "phone",           field_label: "No. HP",                 field_type: "text",     is_required: true,  sort_order: 8, sample_value: "08123456789" },
    { field_name: "is_member",       field_label: "Member?",               field_type: "select",   is_required: false, sort_order: 9, sample_value: "Ya", help_text: "Ya / Tidak" },
    { field_name: "member_id",       field_label: "Nomor Member",           field_type: "text",     is_required: false, sort_order: 10 },
    { field_name: "notes",           field_label: "Catatan Tambahan",       field_type: "textarea", is_required: false, sort_order: 11 },
  ],
};

// ─── Intent → template mapping ────────────────────────────────────────────────

const INTENT_TEMPLATES = [
  // ── Logistik ──────────────────────────────────────────────────────────────
  { intent_code: "trucking_inquiry",       name: "Template Permintaan Trucking",          category: "Logistik",       intake_mode: "mini_form",    use_mini_form: true,  mini_form_type: "trucking",      mini_form_route: "trucking",      description: "Form permintaan layanan trucking domestik" },
  { intent_code: "permintaan_pickup",      name: "Template Permintaan Pickup",            category: "Logistik",       intake_mode: "mini_form",    use_mini_form: true,  mini_form_type: "trucking",      mini_form_route: "trucking",      description: "Form permintaan penjemputan/pickup barang" },
  { intent_code: "sea_freight_inquiry",    name: "Template Pengiriman Laut",              category: "Logistik",       intake_mode: "mini_form",    use_mini_form: true,  mini_form_type: "freight",       mini_form_route: "freight",       description: "Form permintaan pengiriman via laut (sea freight)" },
  { intent_code: "air_freight_inquiry",    name: "Template Pengiriman Udara",             category: "Logistik",       intake_mode: "mini_form",    use_mini_form: true,  mini_form_type: "freight",       mini_form_route: "freight",       description: "Form permintaan pengiriman via udara (air freight)" },
  { intent_code: "import_inquiry",         name: "Template Layanan Import",               category: "Logistik",       intake_mode: "mini_form",    use_mini_form: true,  mini_form_type: "freight",       mini_form_route: "freight",       description: "Form permintaan layanan import barang" },
  { intent_code: "export_inquiry",         name: "Template Layanan Export",               category: "Logistik",       intake_mode: "mini_form",    use_mini_form: true,  mini_form_type: "freight",       mini_form_route: "freight",       description: "Form permintaan layanan export barang" },
  { intent_code: "customs_clearance",      name: "Template Customs Clearance",            category: "Logistik",       intake_mode: "mini_form",    use_mini_form: true,  mini_form_type: "freight",       mini_form_route: "freight",       description: "Form permintaan bea cukai / customs clearance" },
  { intent_code: "cold_chain",             name: "Template Cold Chain",                   category: "Logistik",       intake_mode: "mini_form",    use_mini_form: true,  mini_form_type: "freight",       mini_form_route: "freight",       description: "Form permintaan pengiriman cold chain / rantai dingin" },
  { intent_code: "dg_cargo",              name: "Template DG Cargo",                     category: "Logistik",       intake_mode: "mini_form",    use_mini_form: true,  mini_form_type: "freight",       mini_form_route: "freight",       description: "Form pengiriman barang berbahaya (dangerous goods)" },
  { intent_code: "project_cargo",          name: "Template Project Cargo",                category: "Logistik",       intake_mode: "mini_form",    use_mini_form: true,  mini_form_type: "freight",       mini_form_route: "freight",       description: "Form pengiriman project cargo / alat berat" },
  { intent_code: "live_animal_cargo",      name: "Template Pengiriman Hewan Hidup",       category: "Logistik",       intake_mode: "mini_form",    use_mini_form: true,  mini_form_type: "freight",       mini_form_route: "freight",       description: "Form pengiriman hewan hidup" },
  { intent_code: "ppjk_service",           name: "Template Layanan PPJK",                 category: "Logistik",       intake_mode: "mini_form",    use_mini_form: true,  mini_form_type: "freight",       mini_form_route: "freight",       description: "Form permintaan layanan PPJK" },
  { intent_code: "warehousing_request",    name: "Template Layanan Gudang",               category: "Logistik",       intake_mode: "hybrid",       use_mini_form: false, mini_form_type: null,            mini_form_route: null,            description: "Form permintaan layanan gudang / warehousing" },

  // ── Operasional ──────────────────────────────────────────────────────────
  { intent_code: "fleet_repair",           name: "Template Perbaikan Kendaraan",          category: "Operasional",    intake_mode: "mini_form",    use_mini_form: true,  mini_form_type: "fleet-repair",  mini_form_route: "fleet-repair",  description: "Form laporan dan permintaan perbaikan kendaraan" },
  { intent_code: "tire_issue",             name: "Template Masalah Ban",                  category: "Operasional",    intake_mode: "mini_form",    use_mini_form: true,  mini_form_type: "fleet-repair",  mini_form_route: "fleet-repair",  description: "Form laporan masalah ban kendaraan" },
  { intent_code: "fuel_expense",           name: "Template Pengeluaran BBM",              category: "Operasional",    intake_mode: "mini_form",    use_mini_form: true,  mini_form_type: "cash-advance",  mini_form_route: "cash-advance",  description: "Form laporan pengeluaran bahan bakar minyak" },
  { intent_code: "cek_status_pengiriman",  name: "Template Cek Status Pengiriman",        category: "Operasional",    intake_mode: "conversation", use_mini_form: false, mini_form_type: null,            mini_form_route: null,            description: "AI akan menelusuri status pengiriman secara otomatis" },
  { intent_code: "jadwal_pengiriman",      name: "Template Jadwal Pengiriman",            category: "Operasional",    intake_mode: "conversation", use_mini_form: false, mini_form_type: null,            mini_form_route: null,            description: "AI akan menjawab pertanyaan jadwal pengiriman" },

  // ── Komplain ─────────────────────────────────────────────────────────────
  { intent_code: "damaged_goods_complaint",  name: "Template Komplain Kerusakan Barang",      category: "Komplain",   intake_mode: "mini_form",    use_mini_form: true,  mini_form_type: "complaint",     mini_form_route: "complaint",     description: "Form komplain kerusakan barang saat pengiriman" },
  { intent_code: "delivery_delay_complaint", name: "Template Komplain Keterlambatan",          category: "Komplain",   intake_mode: "mini_form",    use_mini_form: true,  mini_form_type: "complaint",     mini_form_route: "complaint",     description: "Form komplain keterlambatan pengiriman" },
  { intent_code: "komplain_pengiriman",      name: "Template Komplain Pengiriman",             category: "Komplain",   intake_mode: "mini_form",    use_mini_form: true,  mini_form_type: "complaint",     mini_form_route: "complaint",     description: "Form komplain umum terkait pengiriman" },

  // ── Finance / Keuangan ────────────────────────────────────────────────────
  { intent_code: "permintaan_kasbon",      name: "Template Permintaan Kasbon",            category: "Finance",        intake_mode: "mini_form",    use_mini_form: true,  mini_form_type: "cash-advance",  mini_form_route: "cash-advance",  description: "Form permintaan kasbon / uang muka" },
  { intent_code: "klaim_asuransi",         name: "Template Klaim Asuransi",               category: "Keuangan",       intake_mode: "mini_form",    use_mini_form: true,  mini_form_type: "complaint",     mini_form_route: "complaint",     description: "Form pengajuan klaim asuransi / ganti rugi" },
  { intent_code: "konfirmasi_pembayaran",  name: "Template Konfirmasi Pembayaran",        category: "Keuangan",       intake_mode: "conversation", use_mini_form: false, mini_form_type: null,            mini_form_route: null,            description: "AI membantu proses konfirmasi pembayaran" },
  { intent_code: "pertanyaan_tagihan",     name: "Template Pertanyaan Tagihan",           category: "Keuangan",       intake_mode: "conversation", use_mini_form: false, mini_form_type: null,            mini_form_route: null,            description: "AI menjawab pertanyaan tagihan dan invoice" },

  // ── Komersial ─────────────────────────────────────────────────────────────
  { intent_code: "permintaan_penawaran",   name: "Template Permintaan Penawaran Harga",   category: "Komersial",      intake_mode: "mini_form",    use_mini_form: true,  mini_form_type: "freight",       mini_form_route: "freight",       description: "Form permintaan quotation / penawaran harga layanan" },
  { intent_code: "pendaftaran_pelanggan",  name: "Template Pendaftaran Pelanggan",        category: "Komersial",      intake_mode: "hybrid",       use_mini_form: false, mini_form_type: null,            mini_form_route: null,            description: "Pendaftaran pelanggan baru dengan bantuan AI" },
  { intent_code: "permintaan_vendor",      name: "Template Kerjasama Vendor",             category: "Komersial",      intake_mode: "hybrid",       use_mini_form: false, mini_form_type: null,            mini_form_route: null,            description: "Form pengajuan kerjasama vendor / mitra" },

  // ── Administrasi ──────────────────────────────────────────────────────────
  { intent_code: "customer_data_update",   name: "Template Perbarui Data Pelanggan",      category: "Administrasi",   intake_mode: "conversation", use_mini_form: false, mini_form_type: null,            mini_form_route: null,            description: "AI membantu proses update data pelanggan" },
  { intent_code: "permintaan_dokumen",     name: "Template Permintaan Dokumen",           category: "Administrasi",   intake_mode: "hybrid",       use_mini_form: false, mini_form_type: null,            mini_form_route: null,            description: "Form permintaan dokumen resmi perusahaan" },

  // ── Layanan ───────────────────────────────────────────────────────────────
  { intent_code: "feedback_positif",       name: "Template Feedback Positif",             category: "Layanan",        intake_mode: "conversation", use_mini_form: false, mini_form_type: null,            mini_form_route: null,            description: "AI merespons dan mencatat apresiasi pelanggan" },
  { intent_code: "pertanyaan_layanan",     name: "Template Informasi Layanan",            category: "Layanan",        intake_mode: "conversation", use_mini_form: false, mini_form_type: null,            mini_form_route: null,            description: "AI menjawab pertanyaan seputar layanan" },

  // ── Sport Center ──────────────────────────────────────────────────────────
  { intent_code: "sport_center_booking",     name: "Template Booking Lapangan",           category: "Sport Center",   intake_mode: "mini_form",    use_mini_form: true,  mini_form_type: "field-booking", mini_form_route: "field-booking", description: "Form booking lapangan olahraga" },
  { intent_code: "booking_lapangan",         name: "Template Booking Lapangan Olahraga",  category: "Sport Center",   intake_mode: "mini_form",    use_mini_form: true,  mini_form_type: "field-booking", mini_form_route: "field-booking", description: "Form pemesanan lapangan olahraga" },
  { intent_code: "sport_center_cancel",      name: "Template Pembatalan Booking",         category: "Sport Center",   intake_mode: "conversation", use_mini_form: false, mini_form_type: null,            mini_form_route: null,            description: "AI membantu proses pembatalan booking lapangan" },
  { intent_code: "cancel_booking",           name: "Template Pembatalan Booking",         category: "Sport Center",   intake_mode: "conversation", use_mini_form: false, mini_form_type: null,            mini_form_route: null,            description: "AI membantu proses pembatalan booking lapangan" },
  { intent_code: "sport_center_inquiry",     name: "Template Info Lapangan",              category: "Sport Center",   intake_mode: "conversation", use_mini_form: false, mini_form_type: null,            mini_form_route: null,            description: "AI menjawab pertanyaan info lapangan & jadwal" },
  { intent_code: "cek_jadwal_lapangan",      name: "Template Cek Jadwal Lapangan",        category: "Sport Center",   intake_mode: "conversation", use_mini_form: false, mini_form_type: null,            mini_form_route: null,            description: "AI mengecek ketersediaan jadwal lapangan" },
  { intent_code: "daftar_membership",        name: "Template Pendaftaran Member",         category: "Sport Center",   intake_mode: "hybrid",       use_mini_form: false, mini_form_type: null,            mini_form_route: null,            description: "Form pendaftaran membership sport center" },
  { intent_code: "perpanjang_membership",    name: "Template Perpanjang Membership",      category: "Sport Center",   intake_mode: "hybrid",       use_mini_form: false, mini_form_type: null,            mini_form_route: null,            description: "Form perpanjangan masa membership" },
  { intent_code: "cek_membership",           name: "Template Cek Status Membership",      category: "Sport Center",   intake_mode: "conversation", use_mini_form: false, mini_form_type: null,            mini_form_route: null,            description: "AI mengecek status membership pelanggan" },
  { intent_code: "reschedule_booking",       name: "Template Reschedule Booking",         category: "Sport Center",   intake_mode: "conversation", use_mini_form: false, mini_form_type: null,            mini_form_route: null,            description: "AI membantu proses reschedule booking lapangan" },
  { intent_code: "komplain_fasilitas",       name: "Template Komplain Fasilitas",         category: "Sport Center",   intake_mode: "mini_form",    use_mini_form: true,  mini_form_type: "complaint",     mini_form_route: "complaint",     description: "Form laporan masalah / komplain fasilitas sport center" },
  { intent_code: "konfirmasi_pembayaran_sport", name: "Template Konfirmasi Pembayaran Sport", category: "Sport Center", intake_mode: "conversation", use_mini_form: false, mini_form_type: null,           mini_form_route: null,            description: "AI membantu konfirmasi pembayaran booking sport" },

  // ── Tenant ────────────────────────────────────────────────────────────────
  { intent_code: "daftar_tenant",              name: "Template Pendaftaran Tenant",        category: "Tenant",         intake_mode: "hybrid",       use_mini_form: false, mini_form_type: null,            mini_form_route: null,            description: "Form pendaftaran sewa tenant / kios baru" },
  { intent_code: "info_sewa_tenant",           name: "Template Info Sewa Tenant",          category: "Tenant",         intake_mode: "conversation", use_mini_form: false, mini_form_type: null,            mini_form_route: null,            description: "AI menjawab pertanyaan info sewa tenant" },
  { intent_code: "cek_tagihan_tenant",         name: "Template Cek Tagihan Tenant",        category: "Tenant",         intake_mode: "conversation", use_mini_form: false, mini_form_type: null,            mini_form_route: null,            description: "AI mengecek tagihan / status pembayaran sewa" },
  { intent_code: "konfirmasi_pembayaran_tenant", name: "Template Konfirmasi Pembayaran Tenant", category: "Tenant",    intake_mode: "conversation", use_mini_form: false, mini_form_type: null,            mini_form_route: null,            description: "AI membantu konfirmasi pembayaran sewa tenant" },
  { intent_code: "laporan_masalah_tenant",     name: "Template Laporan Masalah Tenant",    category: "Tenant",         intake_mode: "mini_form",    use_mini_form: true,  mini_form_type: "complaint",     mini_form_route: "complaint",     description: "Form laporan masalah / komplain tenant" },
  { intent_code: "perpanjang_sewa",            name: "Template Perpanjang Sewa",           category: "Tenant",         intake_mode: "hybrid",       use_mini_form: false, mini_form_type: null,            mini_form_route: null,            description: "Form perpanjangan masa sewa tenant" },

  // ── Umum ──────────────────────────────────────────────────────────────────
  { intent_code: "general_inquiry",         name: "Template Pertanyaan Umum",             category: "Umum",           intake_mode: "conversation", use_mini_form: false, mini_form_type: null,            mini_form_route: null,            description: "AI menjawab pertanyaan umum pelanggan" },
];

// ─── Seeder ──────────────────────────────────────────────────────────────────

async function seed(label, url) {
  if (!url) { console.log(`⚠️  ${label}: connection string tidak tersedia, skip.`); return; }

  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });
  console.log(`\n🌱 Seeding ${label}...`);

  try {
    // Fetch existing intents so we only seed for what exists
    const { rows: existingIntents } = await pool.query(
      "SELECT intent_code FROM intent_master WHERE company_id = 'default'"
    );
    const existingCodes = new Set(existingIntents.map(r => r.intent_code));
    console.log(`   Intent tersedia: ${existingCodes.size} (${[...existingCodes].join(", ")})`);

    // Delete existing templates to avoid duplicates (fresh seed)
    await pool.query("DELETE FROM data_template_fields WHERE template_id IN (SELECT id FROM data_templates WHERE company_id = 'default')");
    await pool.query("DELETE FROM data_templates WHERE company_id = 'default'");
    console.log(`   ✅ Data lama dibersihkan`);

    let inserted = 0;
    let skipped = 0;

    for (const tpl of INTENT_TEMPLATES) {
      if (!existingCodes.has(tpl.intent_code)) { skipped++; continue; }

      // Insert template
      const { rows: [row] } = await pool.query(
        `INSERT INTO data_templates
           (company_id, intent_code, name, category, description, is_active,
            use_mini_form, mini_form_type, mini_form_route, intake_mode)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING id`,
        [
          "default",
          tpl.intent_code,
          tpl.name,
          tpl.category,
          tpl.description,
          true,
          tpl.use_mini_form,
          tpl.mini_form_type,
          tpl.mini_form_route,
          tpl.intake_mode,
        ]
      );

      // Insert fields if mini_form type has defined fields
      const fields = tpl.mini_form_type ? FIELDS[tpl.mini_form_type] : null;
      if (fields) {
        for (const f of fields) {
          await pool.query(
            `INSERT INTO data_template_fields
               (template_id, field_name, field_label, field_type, is_required, sort_order, help_text, sample_value)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [row.id, f.field_name, f.field_label, f.field_type, f.is_required, f.sort_order, f.help_text ?? null, f.sample_value ?? null]
          );
        }
      }

      console.log(`   ✅ [${tpl.intake_mode.padEnd(12)}] ${tpl.intent_code} — ${tpl.name}`);
      inserted++;
    }

    console.log(`\n   📊 Summary ${label}:`);
    console.log(`      Inserted : ${inserted} templates`);
    console.log(`      Skipped  : ${skipped} (intent tidak ada di DB ini)`);

    // Final count
    const { rows: [cnt] } = await pool.query("SELECT count(*) FROM data_templates WHERE company_id='default'");
    const { rows: [fcnt] } = await pool.query("SELECT count(*) FROM data_template_fields WHERE template_id IN (SELECT id FROM data_templates WHERE company_id='default')");
    console.log(`      Total data_templates     : ${cnt.count}`);
    console.log(`      Total data_template_fields: ${fcnt.count}`);

  } catch (e) {
    console.error(`❌ ${label} error:`, e.message);
  } finally {
    await pool.end();
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

const target = process.argv[2] ?? "all";

if (target === "dev" || target === "all") await seed("DEV",  DB.dev);
if (target === "prod" || target === "all") await seed("PRODUCTION", DB.prod);

console.log("\n✅ Seeding selesai!");
