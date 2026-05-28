/**
 * Seed script — isi database dengan data contoh
 * Jalankan: pnpm --filter @workspace/scripts run seed
 *
 * Script ini idempoten: tidak akan menambah data jika sudah ada.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import bcrypt from "bcryptjs";
import {
  tasksTable,
  teamMembersTable,
  whatsappMessagesTable,
  documentsTable,
  activityTable,
  usersTable,
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
  const existingTasks = await db.select({ id: tasksTable.id }).from(tasksTable).limit(1);
  if (existingTasks.length > 0) {
    console.log("⚠️  Data sudah ada. Seed dilewati (idempoten).");
    console.log("   Hapus data terlebih dahulu jika ingin seed ulang.\n");
    await pool.end();
    return;
  }

  // ── 2. Buat akun admin (jika belum ada) ─────────────────────────────────────
  const existingUsers = await db.select({ id: usersTable.id }).from(usersTable).limit(1);
  let adminId = 0;
  if (existingUsers.length === 0) {
    const passwordHash = await bcrypt.hash("admin123!", 12);
    const [admin] = await db.insert(usersTable).values({
      name: "Admin Utama",
      email: "admin@example.com",
      passwordHash,
      role: "super_admin",
      companyId: "default",
      isActive: true,
    }).returning({ id: usersTable.id });
    adminId = admin.id;
    console.log("✅ Akun admin dibuat: admin@example.com / admin123!");
  } else {
    adminId = existingUsers[0].id;
    console.log("ℹ️  Akun admin sudah ada, dilewati.");
  }

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
  ]).returning({ id: teamMembersTable.id });
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

  // ── 5. Tasks ─────────────────────────────────────────────────────────────────
  const tasks = await db.insert(tasksTable).values([
    {
      title: "Pengiriman 500 Kardus Elektronik — Jakarta → Surabaya",
      description: "PT Maju Jaya minta pengiriman 500 kardus elektronik. Koordinasi dengan vendor pengiriman.",
      status: "pending",
      priority: "high",
      assigneeId: budi.id,
      assignedRole: "supervisor",
      assignedDivision: "Operasional",
      customerName: "PT Maju Jaya",
      sourceMessageId: msgs[0].id,
      dueDate: new Date(now + 3600000 * 48).toISOString(),
      tags: ["pengiriman", "elektronik", "prioritas"],
    },
    {
      title: "Investigasi Keterlambatan Pengiriman SO-2024-0125",
      description: "CV Berkah Abadi melaporkan pengiriman belum tiba meski sudah dikirim kemarin. Cek status dengan kurir.",
      status: "in_progress",
      priority: "urgent",
      assigneeId: sari.id,
      assignedRole: "staff",
      assignedDivision: "Logistik",
      customerName: "CV Berkah Abadi",
      sourceMessageId: msgs[1].id,
      dueDate: new Date(now + 3600000 * 4).toISOString(),
      tags: ["keterlambatan", "investigasi"],
    },
    {
      title: "Kirim Invoice Bulan Lalu — Bapak Hendra",
      description: "Pelanggan meminta invoice untuk transaksi bulan lalu guna proses pembayaran.",
      status: "pending",
      priority: "medium",
      assigneeId: reza.id,
      assignedRole: "staff",
      assignedDivision: "Keuangan",
      customerName: "Bapak Hendra",
      sourceMessageId: msgs[2].id,
      dueDate: new Date(now + 3600000 * 24).toISOString(),
      tags: ["invoice", "keuangan"],
    },
    {
      title: "Penanganan Keluhan Barang Rusak — Ibu Dewi Kusuma",
      description: "Pelanggan melaporkan barang rusak untuk kedua kalinya. Perlu investigasi dan penggantian barang.",
      status: "pending",
      priority: "urgent",
      assigneeId: maya.id,
      assignedRole: "staff",
      assignedDivision: "Pelanggan",
      customerName: "Ibu Dewi Kusuma",
      sourceMessageId: msgs[3].id,
      dueDate: new Date(now + 3600000 * 12).toISOString(),
      tags: ["keluhan", "penggantian", "prioritas"],
    },
    {
      title: "Konfirmasi & Proses DP PT Sumber Rezeki",
      description: "DP 50% sudah ditransfer. Verifikasi pembayaran dan siapkan order untuk minggu depan.",
      status: "completed",
      priority: "medium",
      assigneeId: reza.id,
      assignedRole: "staff",
      assignedDivision: "Keuangan",
      customerName: "PT Sumber Rezeki",
      sourceMessageId: msgs[4].id,
      tags: ["pembayaran", "dp", "selesai"],
    },
    {
      title: "Audit Stok Gudang Q1 2025",
      description: "Audit stok kuartal pertama 2025. Pastikan semua item tercatat dengan benar di sistem.",
      status: "in_progress",
      priority: "medium",
      assigneeId: tono.id,
      assignedRole: "vendor",
      assignedDivision: "Pengiriman",
      dueDate: new Date(now + 3600000 * 72).toISOString(),
      tags: ["audit", "stok", "gudang"],
    },
    {
      title: "Perpanjangan Kontrak Vendor Logistik 2025",
      description: "Kontrak vendor logistik utama berakhir bulan depan. Perlu negosiasi dan perpanjangan.",
      status: "pending",
      priority: "high",
      assigneeId: budi.id,
      assignedRole: "supervisor",
      assignedDivision: "Operasional",
      dueDate: new Date(now + 3600000 * 168).toISOString(),
      tags: ["kontrak", "vendor", "logistik"],
    },
  ]).returning({ id: tasksTable.id });
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

  // ── 7. Activity Feed ─────────────────────────────────────────────────────────
  await db.insert(activityTable).values([
    {
      type: "task_created",
      description: "Task baru dibuat: Pengiriman 500 Kardus Elektronik dari pesan WhatsApp PT Maju Jaya",
      entityId: tasks[0].id,
    },
    {
      type: "task_assigned",
      description: "Task investigasi keterlambatan SO-2024-0125 ditugaskan ke Sari Indah",
      entityId: tasks[1].id,
    },
    {
      type: "message_received",
      description: "Pesan WhatsApp masuk dari Ibu Dewi Kusuma — keluhan barang rusak",
      entityId: msgs[3].id,
    },
    {
      type: "document_audited",
      description: "Dokumen Invoice PT Maju Jaya diaudit AI — skor 92/100",
      entityId: tasks[0].id,
    },
    {
      type: "task_completed",
      description: "Task konfirmasi DP PT Sumber Rezeki diselesaikan oleh Reza Pratama",
      entityId: tasks[4].id,
    },
    {
      type: "message_received",
      description: "Pesan WhatsApp masuk dari PT Sumber Rezeki — konfirmasi pembayaran DP",
      entityId: msgs[4].id,
    },
    {
      type: "task_created",
      description: "Task penanganan keluhan barang rusak dibuat untuk Ibu Dewi Kusuma",
      entityId: tasks[3].id,
    },
    {
      type: "document_uploaded",
      description: "Dokumen Laporan Stok Gudang Q4 2024 diunggah",
      entityId: tasks[5].id,
    },
  ]);
  console.log("✅ 8 entri activity ditambahkan");

  console.log("\n🎉 Seed selesai! Database sudah terisi data contoh.");
  console.log("\n📋 Ringkasan:");
  console.log("   • 1 akun admin (admin@example.com / admin123!)");
  console.log("   • 5 anggota tim");
  console.log("   • 7 tasks");
  console.log("   • 5 pesan WhatsApp");
  console.log("   • 6 dokumen");
  console.log("   • 8 activity feed\n");

  await pool.end();
}

seed().catch(async (err) => {
  console.error("❌ Seed gagal:", err);
  await pool.end();
  process.exit(1);
});
