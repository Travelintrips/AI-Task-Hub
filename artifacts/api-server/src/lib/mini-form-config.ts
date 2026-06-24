/**
 * Mini Form Config — Sprint 9B
 * Defines the 5 standard form types and their fields.
 * Used by both the public form API and the admin config page.
 */

export interface MiniFormFieldDef {
  name: string;
  label: string;
  type: "text" | "number" | "date" | "textarea" | "select" | "file";
  required: boolean;
  options?: string[];
  helpText?: string;
  placeholder?: string;
}

export interface MiniFormConfig {
  type: string;
  title: string;
  description: string;
  waMessageTemplate: string;
  urgentWaMessage?: string;
  fields: MiniFormFieldDef[];
}

export const MINI_FORM_CONFIGS: Record<string, MiniFormConfig> = {
  trucking: {
    type: "trucking",
    title: "Form Permintaan Trucking",
    description: "Isi data pengiriman untuk kami proses segera",
    waMessageTemplate:
      "Baik, untuk mempercepat proses, mohon isi form berikut:\n\n{mini_form_url}\n\nSetelah form dikirim, sistem akan otomatis meneruskan pengajuan ke tim terkait.",
    fields: [
      { name: "pickup_address",   label: "Alamat Pickup",       type: "text",     required: true,  placeholder: "Jl. Raya No. 1, Jakarta" },
      { name: "delivery_address", label: "Alamat Tujuan",       type: "text",     required: true,  placeholder: "Jl. Sudirman No. 5, Surabaya" },
      { name: "cargo_type",       label: "Jenis Muatan",        type: "text",     required: true,  placeholder: "Elektronik, Pakaian, dll" },
      { name: "cargo_weight",     label: "Berat Muatan (kg)",   type: "number",   required: true,  placeholder: "500" },
      { name: "cargo_volume",     label: "Volume (m³)",         type: "number",   required: false, placeholder: "2.5" },
      { name: "vehicle_type",     label: "Jenis Kendaraan",     type: "select",   required: false, options: ["CDD", "CDE", "Fuso", "Trailer", "Engkel", "Pickup"] },
      { name: "pickup_date",      label: "Tanggal Pickup",      type: "date",     required: true },
      { name: "contact_person",   label: "Nama Kontak",         type: "text",     required: true,  placeholder: "Budi Santoso" },
      { name: "notes",            label: "Catatan Tambahan",    type: "textarea", required: false, placeholder: "Muatan fragile, perlu wrap tambahan" },
    ],
  },

  freight: {
    type: "freight",
    title: "Form Permintaan Freight / Import",
    description: "Isi data pengiriman internasional Anda",
    waMessageTemplate:
      "Baik, untuk mempercepat proses, mohon isi form berikut:\n\n{mini_form_url}\n\nSetelah form dikirim, sistem akan otomatis meneruskan pengajuan ke tim terkait.",
    fields: [
      { name: "origin_country",       label: "Negara Asal",          type: "text",   required: true,  placeholder: "China" },
      { name: "destination_country",  label: "Negara Tujuan",        type: "text",   required: true,  placeholder: "Indonesia" },
      { name: "port_origin",          label: "Pelabuhan Asal",       type: "text",   required: false, placeholder: "Shanghai Port" },
      { name: "port_destination",     label: "Pelabuhan Tujuan",     type: "text",   required: false, placeholder: "Tanjung Priok" },
      { name: "commodity",            label: "Jenis Komoditi",       type: "text",   required: true,  placeholder: "Elektronik, Tekstil, dll" },
      { name: "hs_code",              label: "HS Code",              type: "text",   required: false, placeholder: "8517.12" },
      { name: "gross_weight",         label: "Berat Kotor (kg)",     type: "number", required: true,  placeholder: "1000" },
      { name: "volume",               label: "Volume (m³ / CBM)",    type: "number", required: true,  placeholder: "5" },
      { name: "incoterm",             label: "Incoterm",             type: "select", required: false, options: ["FOB", "CIF", "EXW", "DDP", "CFR", "DAP"] },
      { name: "shipment_mode",        label: "Moda Pengiriman",      type: "select", required: true,  options: ["Sea Freight FCL", "Sea Freight LCL", "Air Freight", "Land Transport"] },
      { name: "commercial_invoice",   label: "Commercial Invoice",   type: "file",   required: false, helpText: "Upload dokumen CI (PDF/JPG)" },
      { name: "packing_list",         label: "Packing List",         type: "file",   required: false, helpText: "Upload packing list (PDF/JPG)" },
    ],
  },

  complaint: {
    type: "complaint",
    title: "Form Komplain Barang Rusak",
    description: "Laporkan kerusakan barang agar segera kami tindaklanjuti",
    waMessageTemplate:
      "Baik, kami bantu proses komplainnya. Mohon isi form berikut dan upload foto pendukung:\n\n{mini_form_url}\n\nSetelah lengkap, tim kami akan segera menindaklanjuti.",
    urgentWaMessage:
      "Baik, kami bantu proses komplainnya. Mohon isi form berikut dan upload foto pendukung:\n\n{mini_form_url}\n\nSetelah lengkap, tim kami akan segera menindaklanjuti.",
    fields: [
      { name: "order_number",       label: "Nomor Order / Resi",      type: "text",     required: true,  placeholder: "ORD-2024-001" },
      { name: "item_name",          label: "Nama Barang",             type: "text",     required: true,  placeholder: "Laptop Asus Vivobook" },
      { name: "damage_description", label: "Deskripsi Kerusakan",     type: "textarea", required: true,  placeholder: "Layar pecah, sudut kotak penyok" },
      { name: "damage_quantity",    label: "Jumlah Barang Rusak",     type: "number",   required: true,  placeholder: "2" },
      { name: "received_date",      label: "Tanggal Terima Barang",   type: "date",     required: true },
      { name: "photo_damage",       label: "Foto Kerusakan",          type: "file",     required: false, helpText: "Upload foto kerusakan (JPG/PNG)" },
      { name: "requested_solution", label: "Solusi yang Diharapkan",  type: "select",   required: true,  options: ["Ganti Barang Baru", "Refund", "Perbaikan", "Kompensasi", "Lainnya"] },
    ],
  },

  "fleet-repair": {
    type: "fleet-repair",
    title: "Form Permintaan Perbaikan Armada",
    description: "Laporkan kerusakan kendaraan untuk ditangani segera",
    waMessageTemplate:
      "Baik, untuk mempercepat proses, mohon isi form berikut:\n\n{mini_form_url}\n\nSetelah form dikirim, sistem akan otomatis meneruskan pengajuan ke tim terkait.",
    fields: [
      { name: "plate_number",       label: "Nomor Plat Kendaraan",    type: "text",     required: true,  placeholder: "B 1234 ABC" },
      { name: "location",           label: "Lokasi Kendaraan",        type: "text",     required: true,  placeholder: "Gudang Cibitung, Bekasi" },
      { name: "issue_type",         label: "Jenis Kerusakan",         type: "select",   required: true,  options: ["Mesin", "Ban", "Rem", "Kelistrikan", "Body/Karoseri", "AC", "Lainnya"] },
      { name: "issue_description",  label: "Deskripsi Kerusakan",     type: "textarea", required: true,  placeholder: "Mesin overheat, coolant bocor" },
      { name: "photo",              label: "Foto Kerusakan",          type: "file",     required: false, helpText: "Upload foto kondisi kendaraan" },
      { name: "urgent",             label: "Urgensi",                 type: "select",   required: true,  options: ["Darurat (perlu segera)", "Tinggi (hari ini)", "Normal (bisa besok)", "Rendah (jadwalkan)"] },
      { name: "estimated_cost",     label: "Estimasi Biaya (Rp)",     type: "number",   required: false, placeholder: "500000" },
    ],
  },

  "cash-advance": {
    type: "cash-advance",
    title: "Form Pengajuan Kasbon",
    description: "Ajukan kasbon / uang muka untuk kebutuhan operasional",
    waMessageTemplate:
      "Baik, untuk mempercepat proses, mohon isi form berikut:\n\n{mini_form_url}\n\nSetelah form dikirim, sistem akan otomatis meneruskan pengajuan ke tim terkait.",
    fields: [
      { name: "amount",         label: "Jumlah Kasbon (Rp)",    type: "number",   required: true,  placeholder: "2000000" },
      { name: "purpose",        label: "Keperluan",             type: "textarea", required: true,  placeholder: "Bahan bakar perjalanan Surabaya-Semarang" },
      { name: "needed_date",    label: "Tanggal Dibutuhkan",    type: "date",     required: true },
      { name: "project_code",   label: "Kode Proyek / Trip",    type: "text",     required: false, placeholder: "TRP-001" },
      { name: "attachment",     label: "Dokumen Pendukung",     type: "file",     required: false, helpText: "Upload surat tugas / referensi (opsional)" },
      { name: "notes",          label: "Catatan Tambahan",      type: "textarea", required: false },
    ],
  },

  "field-booking": {
    type: "field-booking",
    title: "Form Pemesanan Lapangan",
    description: "Isi data pemesanan lapangan olahraga Anda",
    waMessageTemplate:
      "Halo! Untuk mempercepat proses booking lapangan, mohon isi form berikut:\n\n{mini_form_url}\n\nSetelah form dikirim, tim kami akan segera mengkonfirmasi ketersediaan lapangan. Terima kasih!",
    fields: [
      { name: "booker_name",    label: "Nama Pemesan",          type: "text",     required: true,  placeholder: "Budi Santoso" },
      { name: "phone",          label: "Nomor WhatsApp",        type: "text",     required: true,  placeholder: "08123456789" },
      { name: "field_type",     label: "Jenis Lapangan",        type: "select",   required: true,  options: ["Futsal", "Badminton", "Basket", "Tenis", "Voli", "Sepak Bola", "Lainnya"] },
      { name: "booking_date",   label: "Tanggal Main",          type: "date",     required: true },
      { name: "start_time",     label: "Jam Mulai",             type: "select",   required: true,  options: ["07:00", "08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00", "22:00"] },
      { name: "duration",       label: "Durasi Sewa",           type: "select",   required: true,  options: ["1 jam", "1,5 jam", "2 jam", "3 jam", "Full Day"] },
      { name: "players_count",  label: "Jumlah Pemain",         type: "number",   required: false, placeholder: "10" },
      { name: "payment_method", label: "Metode Pembayaran",     type: "select",   required: true,  options: ["Transfer Bank", "Cash", "QRIS / E-Wallet"] },
      { name: "notes",          label: "Catatan Tambahan",      type: "textarea", required: false, placeholder: "Butuh perlengkapan tambahan, dll." },
    ],
  },
};

export function getFormConfig(type: string): MiniFormConfig | null {
  return MINI_FORM_CONFIGS[type] ?? null;
}

/** Determine form type from intent code */
export function inferFormType(intentCode: string, category?: string | null): string {
  const code = intentCode.toLowerCase();
  const cat  = (category ?? "").toLowerCase();

  if (code.includes("trucking") || code.includes("truck") || cat.includes("trucking")) return "trucking";
  if (code.includes("freight") || code.includes("import") || code.includes("ekspor") || cat.includes("freight")) return "freight";
  if (code.includes("complaint") || code.includes("komplain") || code.includes("rusak") || cat.includes("komplain")) return "complaint";
  if (code.includes("fleet") || code.includes("repair") || code.includes("armada") || cat.includes("fleet")) return "fleet-repair";
  if (code.includes("kasbon") || code.includes("cash") || code.includes("advance") || cat.includes("kasbon")) return "cash-advance";
  if (
    code.includes("lapangan") || code.includes("booking") || code.includes("boking") ||
    code.includes("field") || code.includes("futsal") || code.includes("badminton") ||
    code.includes("basket") || code.includes("tenis") || code.includes("voli") ||
    code.includes("sport") || code.includes("sewa lapangan") || code.includes("pesan lapangan") ||
    cat.includes("sport") || cat.includes("lapangan") || cat.includes("booking")
  ) return "field-booking";

  return "trucking"; // default
}
