/**
 * Sprint 10A-1 — Customer WhatsApp Commands
 *
 * Commands:
 *   STATUS [ORDER]  — status pesanan
 *   DOCS [ORDER]    — daftar dokumen pesanan
 *   HELP            — daftar perintah
 */

import { eq, and, or, ilike } from "drizzle-orm";
import { db, aiTasksTable, taskAttachmentsTable, customersTable } from "@workspace/db";
import type { WaCommandContext, WaCommandResult } from "./types";

export async function handleCustomerCommand(
  ctx: WaCommandContext,
): Promise<WaCommandResult | null> {
  const { command, args, phone, user, companyId } = ctx;

  // ── STATUS [ORDER] ──────────────────────────────────────────────────────────
  if (command === "STATUS") {
    if (!args[0]) {
      return {
        reply:
          "❓ *Format Salah*\n\nGunakan: *STATUS [NOMOR ORDER]*\n\nContoh: STATUS CST-2026-001",
        handled: true,
      };
    }

    const orderNo = args[0].toUpperCase();
    const task = await db
      .select()
      .from(aiTasksTable)
      .where(
        and(
          eq(aiTasksTable.companyId, companyId),
          ilike(aiTasksTable.taskNumber, orderNo),
        ),
      )
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!task) {
      return {
        reply: `❌ Order *${orderNo}* tidak ditemukan.\n\nPastikan nomor order benar atau hubungi admin kami.`,
        handled: true,
      };
    }

    const statusEmoji: Record<string, string> = {
      new_inquiry: "🆕",
      waiting_documents: "📄",
      in_progress: "⚙️",
      completed: "✅",
      cancelled: "❌",
      on_hold: "⏸️",
    };
    const emoji = statusEmoji[task.status ?? ""] ?? "📋";
    const statusLabel: Record<string, string> = {
      new_inquiry: "Permohonan Baru",
      waiting_documents: "Menunggu Dokumen",
      in_progress: "Sedang Diproses",
      completed: "Selesai",
      cancelled: "Dibatalkan",
      on_hold: "Ditahan",
    };

    const updatedAt = task.updatedAt
      ? new Date(task.updatedAt).toLocaleDateString("id-ID", {
          day: "2-digit", month: "short", year: "numeric",
        })
      : "-";

    const reply =
      `📦 *Status Order ${task.taskNumber}*\n\n` +
      `${emoji} Status: *${statusLabel[task.status ?? ""] ?? task.status}*\n` +
      `📝 Layanan: ${task.title ?? task.category ?? "-"}\n` +
      `🕐 Update Terakhir: ${updatedAt}\n` +
      `👤 PIC: ${task.assignedTo ?? "Belum ditugaskan"}\n` +
      `💰 Invoice: ${task.quotationAmount ? `Rp ${Number(task.quotationAmount).toLocaleString("id-ID")}` : "Belum ada"}\n` +
      (task.slaStatus === "overdue"
        ? `\n⚠️ _Pesanan ini melewati batas waktu. Hubungi admin segera._`
        : "") +
      `\n\n_Balas *DOCS ${task.taskNumber}* untuk cek dokumen._`;

    return { reply, handled: true };
  }

  // ── DOCS [ORDER] ────────────────────────────────────────────────────────────
  if (command === "DOCS") {
    if (!args[0]) {
      return {
        reply: "❓ Format: *DOCS [NOMOR ORDER]*\n\nContoh: DOCS CST-2026-001",
        handled: true,
      };
    }

    const orderNo = args[0].toUpperCase();
    const task = await db
      .select()
      .from(aiTasksTable)
      .where(
        and(
          eq(aiTasksTable.companyId, companyId),
          ilike(aiTasksTable.taskNumber, orderNo),
        ),
      )
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!task) {
      return {
        reply: `❌ Order *${orderNo}* tidak ditemukan.`,
        handled: true,
      };
    }

    let missingDocs: string[] = [];
    try {
      missingDocs = Array.isArray(task.missingData)
        ? (task.missingData as string[])
        : typeof task.missingData === "string"
        ? JSON.parse(task.missingData || "[]")
        : [];
    } catch { missingDocs = []; }

    const attachments = await db
      .select()
      .from(taskAttachmentsTable)
      .where(eq(taskAttachmentsTable.taskId, task.id))
      .limit(20);

    const uploadedList = attachments.length > 0
      ? attachments.map((a, i) => `${i + 1}. ✅ ${a.fileName ?? a.fileType}`).join("\n")
      : "  _(belum ada dokumen diupload)_";

    const missingList = missingDocs.length > 0
      ? missingDocs.map((d, i) => `${i + 1}. ❌ ${d}`).join("\n")
      : "  _(semua dokumen sudah lengkap)_";

    const reply =
      `📂 *Dokumen Order ${task.taskNumber}*\n\n` +
      `✅ *Sudah Diupload:*\n${uploadedList}\n\n` +
      `❌ *Masih Kurang:*\n${missingList}\n\n` +
      `_Untuk upload dokumen, hubungi admin atau akses portal kami._`;

    return { reply, handled: true };
  }

  // ── HELP ────────────────────────────────────────────────────────────────────
  if (command === "HELP" && args.length === 0) {
    const reply =
      `🙏 Halo${user.name ? ` *${user.name}*` : ""}!\n\n` +
      `Berikut perintah yang tersedia:\n\n` +
      `📦 *STATUS [NOMOR]*\n  Cek status pesanan\n  _Contoh: STATUS CST-2026-001_\n\n` +
      `📂 *DOCS [NOMOR]*\n  Cek dokumen pesanan\n  _Contoh: DOCS CST-2026-001_\n\n` +
      `📋 *MENU*\n  Tampilkan menu utama\n\n` +
      `_Butuh bantuan? Hubungi admin kami._`;
    return { reply, handled: true };
  }

  return null;
}
