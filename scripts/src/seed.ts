/**
 * Seed script — isi database dengan data contoh
 * Jalankan: pnpm --filter @workspace/scripts run seed
 *
 * Script ini idempoten: tidak akan menambah data jika sudah ada.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import {
  aiTasksTable,
  teamMembersTable,
  whatsappMessagesTable,
  documentsTable,
  auditLogsTable,
} from "@workspace/db";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL harus diset");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

async function seed() {
  console.log("🌱 Memulai seed database...\n");

  // ── 1. Cek apakah data sudah ada ────────────────────────────────────────────
  const existingTasks = await db.select({ id: aiTasksTable.id }).from(aiTasksTable).limit(1);
  if (existingTasks.length > 0) {
    console.log("⚠️  Data sudah ada. Seed dilewati (idempoten).");
    console.log("   Hapus data terlebih dahulu jika ingin seed ulang.\n");
    await pool.end();
    return;
  }

  // Seed tidak membuat akun admin — gunakan halaman /setup untuk buat akun Anda sendiri

  // ── 3. Anggota Tim ───────────────────────────────────────────────────────────
  const [budi, sari, reza, tono, maya] = await db.insert(teamMembersTable).values([
    {
      name: "Budi Santoso",
      role: "supervisor",
      division: "Operasional",
      phone: "081234567001",
      email: "budi@example.com",
    },
    {
      name: "Sari Indah",
      role: "staff",
      division: "Logistik",
      phone: "081234567002",
      email: "sari@example.com",
    },
    {
      name: "Reza Pratama",
      role: "staff",
      division: "Keuangan",
      phone: "081234567003",
      email: "reza@example.com",
    },
    {
      name: "Tono Wijaya",
      role: "vendor",
      division: "Pengiriman",
      phone: "081234567004",
      email: "tono@example.com",
      isVendor: "true",
    },
    {
      name: "Maya Putri",
      role: "staff",
      division: "Pelanggan",
      phone: "081234567005",
      email: "maya@example.com",
    },
  ]).returning({ id: teamMembersTable.id, name: teamMembersTable.name });
  console.log("✅ 5 anggota tim ditambahkan");

  // ── 4. Pesan WhatsApp ────────────────────────────────────────────────────────
  const now = Date.now();
  const msgs = await db.insert(whatsappMessagesTable).values([
    {
      from: "6281298765001",
      senderPhone: "6281298765001",
      senderName: "PT Maju Jaya",
      body: "Halo, kami ingin pesan pengiriman 500 kardus elektronik dari Jakarta ke Surabaya. Bisa diproses minggu ini?",
      timestamp: String(Math.floor((now - 3600000 * 2) / 1000)),
      processed: false,
      detectedIntent: "order_request",
      companyId: "default",
    },
    {
      from: "6281298765002",
      senderPhone: "6281298765002",
      senderName: "CV Berkah Abadi",
      body: "Minta update status pengiriman order no. SO-2024-0125. Katanya sudah dikirim kemarin tapi belum sampai.",
      timestamp: String(Math.floor((now - 3600000 * 5) / 1000)),
      processed: true,
      detectedIntent: "delivery_inquiry",
      companyId: "default",
    },
    {
      from: "6281298765003",
      senderPhone: "6281298765003",
      senderName: "Bapak Hendra",
      body: "Tolong kirimkan invoice untuk transaksi bulan lalu. Kami perlu untuk proses pembayaran.",
      timestamp: String(Math.floor((now - 3600000 * 8) / 1000)),
      processed: false,
      detectedIntent: "invoice_request",
      companyId: "default",
    },
    {
      from: "6281298765004",
      senderPhone: "6281298765004",
      senderName: "Ibu Dewi Kusuma",
      body: "Ada keluhan soal barang yang diterima rusak. Mohon segera ditangani karena ini sudah kedua kalinya.",
      timestamp: String(Math.floor((now - 3600000 * 24) / 1000)),
      processed: false,
      detectedIntent: "complaint",
      companyId: "default",
    },
    {
      from: "6281298765005",
      senderPhone: "6281298765005",
      senderName: "PT Sumber Rezeki",
      body: "Konfirmasi pembayaran DP 50% untuk order minggu depan sudah kami transfer. Silakan dicek.",
      timestamp: String(Math.floor((now - 3600000 * 30) / 1000)),
      processed: true,
      detectedIntent: "payment_confirmation",
      companyId: "default",
    },
  ]).returning({ id: whatsappMessagesTable.id });
  console.log("✅ 5 pesan WhatsApp ditambahkan");

  // ── 5. AI Tasks ───────────────────────────────────────────────────────────────
  const tasks = await db.insert(aiTasksTable).values([
    {
      companyId: "default",
      taskNumber: "WA-2501-0001",
      source: "whatsapp",
      title: "Pengiriman 500 Kardus Elektronik — Jakarta → Surabaya",
      description: "PT Maju Jaya minta pengiriman 500 kardus elektronik. Koordinasi dengan vendor pengiriman.",
      status: "new_inquiry",
      priority: "high",
      assignedTo: budi.name,
      assignedRole: "supervisor",
      assignedDivision: "Operasional",
      customerName: "PT Maju Jaya",
      customerPhone: "6281298765001",
      category: "Trucking",
      dueDate: new Date(now + 3600000 * 48),
    },
    {
      companyId: "default",
      taskNumber: "WA-2501-0002",
      source: "whatsapp",
      title: "Investigasi Keterlambatan Pengiriman SO-2024-0125",
      description: "CV Berkah Abadi melaporkan pengiriman belum tiba meski sudah dikirim kemarin.",
      status: "in_progress",
      priority: "urgent",
      assignedTo: sari.name,
      assignedRole: "staff",
      assignedDivision: "Logistik",
      customerName: "CV Berkah Abadi",
      customerPhone: "6281298765002",
      category: "Complaint",
      dueDate: new Date(now + 3600000 * 4),
    },
    {
      companyId: "default",
      taskNumber: "WA-2501-0003",
      source: "whatsapp",
      title: "Kirim Invoice Bulan Lalu — Bapak Hendra",
      description: "Pelanggan meminta invoice untuk transaksi bulan lalu guna proses pembayaran.",
      status: "new_inquiry",
      priority: "medium",
      assignedTo: reza.name,
      assignedRole: "staff",
      assignedDivision: "Keuangan",
      customerName: "Bapak Hendra",
      customerPhone: "6281298765003",
      category: "Finance",
      dueDate: new Date(now + 3600000 * 24),
    },
    {
      companyId: "default",
      taskNumber: "WA-2501-0004",
      source: "whatsapp",
      title: "Penanganan Keluhan Barang Rusak — Ibu Dewi Kusuma",
      description: "Pelanggan melaporkan barang rusak untuk kedua kalinya. Perlu investigasi dan penggantian barang.",
      status: "new_inquiry",
      priority: "urgent",
      assignedTo: maya.name,
      assignedRole: "staff",
      assignedDivision: "Pelanggan",
      customerName: "Ibu Dewi Kusuma",
      customerPhone: "6281298765004",
      category: "Complaint",
      dueDate: new Date(now + 3600000 * 12),
    },
    {
      companyId: "default",
      taskNumber: "WA-2501-0005",
      source: "whatsapp",
      title: "Konfirmasi & Proses DP PT Sumber Rezeki",
      description: "DP 50% sudah ditransfer. Verifikasi pembayaran dan siapkan order untuk minggu depan.",
      status: "completed",
      priority: "medium",
      assignedTo: reza.name,
      assignedRole: "staff",
      assignedDivision: "Keuangan",
      customerName: "PT Sumber Rezeki",
      customerPhone: "6281298765005",
      category: "Finance",
      completedAt: new Date(),
    },
    {
      companyId: "default",
      taskNumber: "WA-2501-0006",
      source: "manual",
      title: "Audit Stok Gudang Q1 2025",
      description: "Audit stok kuartal pertama 2025. Pastikan semua item tercatat dengan benar di sistem.",
      status: "in_progress",
      priority: "medium",
      assignedTo: tono.name,
      assignedRole: "vendor",
      assignedDivision: "Pengiriman",
      category: "Warehouse",
      dueDate: new Date(now + 3600000 * 72),
    },
    {
      companyId: "default",
      taskNumber: "WA-2501-0007",
      source: "manual",
      title: "Perpanjangan Kontrak Vendor Logistik 2025",
      description: "Kontrak vendor logistik utama berakhir bulan depan. Perlu negosiasi dan perpanjangan.",
      status: "new_inquiry",
      priority: "high",
      assignedTo: budi.name,
      assignedRole: "supervisor",
      assignedDivision: "Operasional",
      category: "Trucking",
      dueDate: new Date(now + 3600000 * 168),
    },
  ]).returning({ id: aiTasksTable.id });
  console.log("✅ 7 task ditambahkan");

  // ── 6. Dokumen ───────────────────────────────────────────────────────────────
  await db.insert(documentsTable).values([
    {
      filename: "Invoice_PT_Maju_Jaya_Jan2025.pdf",
      status: "audited",
      auditScore: 92,
      auditSummary: "Dokumen invoice lengkap dan valid. Format sesuai standar. Nomor invoice dan tanggal jelas.",
      auditIssues: [],
      taskId: tasks[0].id,
      uploadedBy: "admin",
    },
    {
      filename: "Surat_Jalan_SO-2024-0125.pdf",
      status: "audited",
      auditScore: 78,
      auditSummary: "Surat jalan valid namun ada beberapa informasi yang kurang lengkap.",
      auditIssues: ["Tanda tangan penerima tidak ada", "Tanggal pengiriman kurang jelas"],
      taskId: tasks[1].id,
      uploadedBy: "admin",
    },
    {
      filename: "Invoice_Hendra_Des2024.pdf",
      status: "pending",
      auditIssues: [],
      taskId: tasks[2].id,
      uploadedBy: "admin",
    },
    {
      filename: "Laporan_Kerusakan_Barang_Dewi.pdf",
      status: "audited",
      auditScore: 65,
      auditSummary: "Laporan kerusakan ada namun dokumentasi foto tidak lengkap.",
      auditIssues: ["Foto kerusakan tidak terlampir", "Estimasi nilai kerugian tidak ada"],
      taskId: tasks[3].id,
      uploadedBy: "admin",
    },
    {
      filename: "Bukti_Transfer_DP_Sumber_Rezeki.jpg",
      status: "audited",
      auditScore: 95,
      auditSummary: "Bukti transfer valid. Nominal sesuai dengan kesepakatan DP 50%.",
      auditIssues: [],
      taskId: tasks[4].id,
      uploadedBy: "admin",
    },
    {
      filename: "Laporan_Stok_Gudang_Q4_2024.xlsx",
      status: "pending",
      auditIssues: [],
      taskId: tasks[5].id,
      uploadedBy: "admin",
    },
  ]);
  console.log("✅ 6 dokumen ditambahkan");

  // ── 7. Audit Log (menggantikan activity feed) ─────────────────────────────────
  await db.insert(auditLogsTable).values([
    {
      action: "task_created",
      module: "tasks",
      before: "Task baru dibuat: Pengiriman 500 Kardus Elektronik dari pesan WhatsApp PT Maju Jaya",
      entityId: tasks[0].id,
    },
    {
      action: "task_assigned",
      module: "tasks",
      before: "Task investigasi keterlambatan SO-2024-0125 ditugaskan ke Sari Indah",
      entityId: tasks[1].id,
    },
    {
      action: "message_received",
      module: "messages",
      before: "Pesan WhatsApp masuk dari Ibu Dewi Kusuma — keluhan barang rusak",
      entityId: msgs[3].id,
    },
    {
      action: "document_audited",
      module: "documents",
      before: "Dokumen Invoice PT Maju Jaya diaudit AI — skor 92/100",
      entityId: tasks[0].id,
    },
    {
      action: "task_completed",
      module: "tasks",
      before: "Task konfirmasi DP PT Sumber Rezeki diselesaikan oleh Reza Pratama",
      entityId: tasks[4].id,
    },
    {
      action: "message_received",
      module: "messages",
      before: "Pesan WhatsApp masuk dari PT Sumber Rezeki — konfirmasi pembayaran DP",
      entityId: msgs[4].id,
    },
    {
      action: "task_created",
      module: "tasks",
      before: "Task penanganan keluhan barang rusak dibuat untuk Ibu Dewi Kusuma",
      entityId: tasks[3].id,
    },
    {
      action: "document_uploaded",
      module: "documents",
      before: "Dokumen Laporan Stok Gudang Q4 2024 diunggah",
      entityId: tasks[5].id,
    },
  ]);
  console.log("✅ 8 entri audit log ditambahkan");

  console.log("\n🎉 Seed selesai! Database sudah terisi data contoh.");
  console.log("\n📋 Ringkasan:");
  console.log("   • 5 anggota tim");
  console.log("   • 7 ai_tasks");
  console.log("   • 5 pesan WhatsApp");
  console.log("   • 6 dokumen");
  console.log("   • 8 audit log\n");

  await pool.end();
}

seed().catch(async (err) => {
  console.error("❌ Seed gagal:", err);
  await pool.end();
  process.exit(1);
});
