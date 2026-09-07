/**
 * Export / Backup Route
 * GET /api/export/ai-tasks      → Excel (.xlsx) semua AI Tasks
 * GET /api/export/messages      → Excel semua pesan WA masuk
 * GET /api/export/wa-notifications → Excel log notifikasi WA keluar
 * GET /api/export/all           → Excel multi-sheet (semua data)
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { desc } from "drizzle-orm";
import * as XLSX from "xlsx";
import {
  db,
  aiTasksTable,
  whatsappMessagesTable,
  whatsappNotificationsTable,
  auditLogsTable,
} from "@workspace/db";
import { requireAuth, getCompanyId } from "../middleware/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(v: Date | string | null | undefined): string {
  if (!v) return "";
  try {
    return new Date(v).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
  } catch {
    return String(v);
  }
}

function sendXlsx(res: Response, wb: XLSX.WorkBook, filename: string): void {
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", buf.length);
  res.end(buf);
}

function autoWidth(ws: XLSX.WorkSheet): void {
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  const colWidths: number[] = [];
  for (let C = range.s.c; C <= range.e.c; C++) {
    let max = 10;
    for (let R = range.s.r; R <= range.e.r; R++) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      if (cell && cell.v != null) {
        const len = String(cell.v).length;
        if (len > max) max = len;
      }
    }
    colWidths[C] = Math.min(max + 2, 60);
  }
  ws["!cols"] = colWidths.map((w) => ({ wch: w }));
}

// ─── Sheet builders ───────────────────────────────────────────────────────────

async function buildAiTasksSheet(companyId: string | null) {
  const rows = await db
    .select()
    .from(aiTasksTable)
    .where(companyId !== null
      ? (await import("drizzle-orm")).eq(aiTasksTable.companyId, companyId)
      : undefined)
    .orderBy(desc(aiTasksTable.createdAt))
    .limit(5000);

  const data = [
    ["No", "Task Number", "Sumber", "Nama Customer", "No. WA Customer",
     "Judul", "Deskripsi", "Kategori", "Divisi", "Prioritas", "Status",
     "Ditugaskan Ke", "Role", "Divisi Tugasan",
     "Estimasi (Rp)", "Catatan Kuotasi",
     "Jatuh Tempo", "AI Summary", "AI Intent", "Data Kurang",
     "Catatan Admin", "Company ID", "Dibuat", "Diperbarui"],
    ...rows.map((r, i) => [
      i + 1,
      r.taskNumber ?? "",
      r.source ?? "",
      r.customerName ?? "",
      r.customerPhone ?? "",
      r.title,
      r.description ?? "",
      r.category ?? "",
      r.division ?? "",
      r.priority ?? "",
      r.status,
      r.assignedTo ?? "",
      r.assignedRole ?? "",
      r.assignedDivision ?? "",
      r.quotationAmount ? Number(r.quotationAmount) : "",
      r.quotationNotes ?? "",
      r.dueDate ? formatDate(r.dueDate) : "",
      r.aiSummary ?? "",
      r.aiIntent ?? "",
      Array.isArray(r.missingData) ? (r.missingData as string[]).join(", ") : "",
      r.adminNotes ?? "",
      r.companyId,
      formatDate(r.createdAt),
      formatDate(r.updatedAt),
    ]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(data);
  autoWidth(ws);
  return ws;
}

async function buildMessagesSheet(companyId: string | null) {
  const rows = await db
    .select()
    .from(whatsappMessagesTable)
    .where(companyId !== null
      ? (await import("drizzle-orm")).eq(whatsappMessagesTable.companyId, companyId)
      : undefined)
    .orderBy(desc(whatsappMessagesTable.createdAt))
    .limit(5000);

  const data = [
    ["No", "Dari (Nomor)", "Nama Pengirim", "Isi Pesan", "Tipe Pesan",
     "Arah", "Intent Terdeteksi", "Diproses AI", "Diproses Manual",
     "Task ID Terkait", "URL Lampiran", "Waktu Pesan", "Disimpan"],
    ...rows.map((r, i) => [
      i + 1,
      r.from ?? r.senderPhone ?? "",
      r.senderName ?? "",
      r.body ?? "",
      r.messageType ?? "",
      r.direction ?? "inbound",
      r.detectedIntent ?? "",
      r.aiProcessed ? "Ya" : "Tidak",
      r.processed ? "Ya" : "Tidak",
      r.taskId ?? "",
      r.attachmentUrl ?? "",
      r.timestamp ? formatDate(new Date(Number(r.timestamp) * 1000)) : "",
      formatDate(r.createdAt),
    ]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(data);
  autoWidth(ws);
  return ws;
}

async function buildNotificationsSheet(companyId: string | null) {
  const rows = await db
    .select()
    .from(whatsappNotificationsTable)
    .where(companyId !== null
      ? (await import("drizzle-orm")).eq(whatsappNotificationsTable.companyId, companyId)
      : undefined)
    .orderBy(desc(whatsappNotificationsTable.createdAt))
    .limit(5000);

  const data = [
    ["No", "Task ID", "Nomor Tujuan", "Tipe Penerima", "Template",
     "Isi Pesan", "Status", "Message ID", "Pesan Error", "Dikirim", "Dibuat"],
    ...rows.map((r, i) => [
      i + 1,
      r.taskId ?? "",
      r.recipientPhone,
      r.recipientType ?? "",
      r.templateName ?? "",
      r.messageText ?? "",
      r.status,
      r.externalMessageId ?? "",
      r.errorMessage ?? "",
      r.sentAt ? formatDate(r.sentAt) : "",
      formatDate(r.createdAt),
    ]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(data);
  autoWidth(ws);
  return ws;
}

async function buildActivitySheet(companyId: string | null) {
  void companyId;
  const rows = await db
    .select()
    .from(auditLogsTable)
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(2000);

  const data = [
    ["No", "Aksi", "Detail", "Entity ID", "Waktu"],
    ...rows.map((r, i) => [
      i + 1,
      r.action,
      r.before ?? "",
      r.entityId ?? "",
      formatDate(r.createdAt),
    ]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(data);
  autoWidth(ws);
  return ws;
}

// ─── GET /export/ai-tasks ─────────────────────────────────────────────────────

router.get("/export/ai-tasks", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req);
    const ws = await buildAiTasksSheet(companyId);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "AI Tasks");
    const date = new Date().toISOString().slice(0, 10);
    sendXlsx(res, wb, `ai-tasks_${date}.xlsx`);
    logger.info({ companyId, rows: ws["!ref"] }, "Exported ai-tasks to Excel");
  } catch (err) {
    logger.error({ err }, "GET /export/ai-tasks failed");
    res.status(500).json({ error: "Export gagal" });
  }
});

// ─── GET /export/messages ─────────────────────────────────────────────────────

router.get("/export/messages", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req);
    const ws = await buildMessagesSheet(companyId);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Pesan WA Masuk");
    const date = new Date().toISOString().slice(0, 10);
    sendXlsx(res, wb, `wa-messages_${date}.xlsx`);
    logger.info({ companyId }, "Exported messages to Excel");
  } catch (err) {
    logger.error({ err }, "GET /export/messages failed");
    res.status(500).json({ error: "Export gagal" });
  }
});

// ─── GET /export/wa-notifications ────────────────────────────────────────────

router.get("/export/wa-notifications", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req);
    const ws = await buildNotificationsSheet(companyId);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Notifikasi WA Keluar");
    const date = new Date().toISOString().slice(0, 10);
    sendXlsx(res, wb, `wa-notifications_${date}.xlsx`);
    logger.info({ companyId }, "Exported wa-notifications to Excel");
  } catch (err) {
    logger.error({ err }, "GET /export/wa-notifications failed");
    res.status(500).json({ error: "Export gagal" });
  }
});

// ─── GET /export/all ──────────────────────────────────────────────────────────
// Multi-sheet workbook: AI Tasks + Pesan Masuk + Notif WA + Aktivitas

router.get("/export/all", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req);

    const [wsAiTasks, wsMessages, wsNotifs, wsActivity] = await Promise.all([
      buildAiTasksSheet(companyId),
      buildMessagesSheet(companyId),
      buildNotificationsSheet(companyId),
      buildActivitySheet(companyId),
    ]);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsAiTasks,  "AI Tasks");
    XLSX.utils.book_append_sheet(wb, wsMessages,  "Pesan WA Masuk");
    XLSX.utils.book_append_sheet(wb, wsNotifs,    "Notifikasi WA Keluar");
    XLSX.utils.book_append_sheet(wb, wsActivity,  "Aktivitas");

    const date = new Date().toISOString().slice(0, 10);
    sendXlsx(res, wb, `backup-lengkap_${date}.xlsx`);
    logger.info({ companyId }, "Exported full backup to Excel");
  } catch (err) {
    logger.error({ err }, "GET /export/all failed");
    res.status(500).json({ error: "Export gagal" });
  }
});

export default router;
