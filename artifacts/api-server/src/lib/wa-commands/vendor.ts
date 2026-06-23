/**
 * Sprint 10A-3 — Vendor WhatsApp Commands (updated)
 *
 * Commands:
 *   DAFTAR VENDOR    — generate token → kirim link registrasi portal
 *   STATUS VENDOR    — status vendor + link portal
 *   DOKUMEN VENDOR   — daftar dokumen vendor + link portal
 */

import { eq, and } from "drizzle-orm";
import {
  db, vendorRiskAssessmentsTable, vendorCapabilitiesTable,
  vendorPerformanceSnapshotsTable,
} from "@workspace/db";
import { sql } from "drizzle-orm";
import { supabasePool } from "../supabase-db";
import { logger } from "../logger";
import type { WaCommandContext, WaCommandResult } from "./types";

const BASE_URL = process.env["BASE_URL"]
  ?? `https://${process.env["REPL_SLUG"] ?? "app"}.replit.app`;

function generateToken(): string {
  const { randomBytes } = require("crypto") as typeof import("crypto");
  return randomBytes(24).toString("hex");
}

async function createPortalToken(
  phone: string,
  purpose: "register" | "status" | "documents",
  vendorId?: number,
  expiryHours = 168,
): Promise<string> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + expiryHours * 3600 * 1000);
  await db.execute(sql`
    INSERT INTO vendor_portal_tokens (token, vendor_id, phone, token_purpose, expires_at)
    VALUES (${token}, ${vendorId ?? null}, ${phone}, ${purpose}, ${expiresAt.toISOString()})
  `);
  return token;
}

async function findSupplierByPhone(phone: string): Promise<{ id: number; name: string; registration_status: string } | null> {
  try {
    const rows = await db.execute(sql`
      SELECT id, name, registration_status
      FROM suppliers
      WHERE portal_phone = ${phone} OR phone = ${phone}
      LIMIT 1
    `);
    const row = (rows.rows as Record<string, unknown>[])[0];
    if (!row) return null;
    return {
      id: row["id"] as number,
      name: row["name"] as string,
      registration_status: row["registration_status"] as string,
    };
  } catch {
    return null;
  }
}

export async function handleVendorCommand(
  ctx: WaCommandContext,
): Promise<WaCommandResult | null> {
  const { command, user } = ctx;
  const phone = user.phone ?? "";

  // ── DAFTAR VENDOR ───────────────────────────────────────────────────────────
  if (command === "DAFTAR VENDOR") {
    // Check if already registered
    const existing = await findSupplierByPhone(phone);

    if (existing) {
      const statusLabels: Record<string, string> = {
        pending_review: "🕐 Menunggu Review",
        approved: "✅ Disetujui",
        rejected: "❌ Ditolak",
        needs_revision: "📝 Perlu Revisi",
        unregistered: "📋 Belum Lengkap",
      };
      const label = statusLabels[existing.registration_status] ?? "📋 Terdaftar";

      try {
        const token = await createPortalToken(phone, "register", existing.id, 168);
        const url = `${BASE_URL}/vendor/register/${token}`;
        return {
          reply:
            `🏢 *Update Data Vendor*\n\n` +
            `Anda sudah terdaftar sebagai *${existing.name}*\n` +
            `Status: ${label}\n\n` +
            `Klik tautan berikut untuk memperbarui data pendaftaran:\n${url}\n\n` +
            `_Tautan berlaku 7 hari._`,
          handled: true,
        };
      } catch (err) {
        logger.warn({ err }, "Failed to create update token");
        return {
          reply:
            `🏢 Data vendor Anda sudah terdaftar (*${existing.name}*).\n` +
            `Status: ${statusLabels[existing.registration_status] ?? "-"}\n\n` +
            `Balas *STATUS VENDOR* untuk melihat status lengkap.`,
          handled: true,
        };
      }
    }

    // New vendor — generate registration token
    try {
      const token = await createPortalToken(phone, "register", undefined, 168);
      const url = `${BASE_URL}/vendor/register/${token}`;
      return {
        reply:
          `🏢 *Pendaftaran Vendor Baru*\n\n` +
          `Klik tautan di bawah untuk mengisi formulir pendaftaran vendor:\n\n` +
          `📋 ${url}\n\n` +
          `Siapkan informasi:\n` +
          `• Nama perusahaan & PIC\n` +
          `• Jenis layanan & area operasional\n` +
          `• NPWP & NIB (jika ada)\n\n` +
          `_Tautan berlaku 7 hari. Tim kami akan mereview dalam 1-2 hari kerja._`,
        handled: true,
      };
    } catch (err) {
      logger.error({ err }, "Failed to create vendor registration token");
      return {
        reply:
          `🏢 *Pendaftaran Vendor Baru*\n\n` +
          `Terima kasih atas minat bergabung sebagai vendor!\n\n` +
          `Mohon maaf, terjadi kendala saat membuat tautan pendaftaran. Silakan coba lagi dalam beberapa menit atau hubungi admin kami langsung.\n\n` +
          `_Jika terus bermasalah, balas *MENU* untuk melihat opsi lain._`,
        handled: true,
      };
    }
  }

  // ── STATUS VENDOR ──────────────────────────────────────────────────────────
  if (command === "STATUS VENDOR") {
    const existing = await findSupplierByPhone(phone);

    if (!existing) {
      // Check user.entityId (existing vendor linked via team_members)
      if (!user.entityId) {
        return {
          reply:
            `ℹ️ *Status Vendor*\n\n` +
            `Nomor WhatsApp Anda belum terdaftar sebagai vendor.\n\n` +
            `Untuk mendaftar sebagai vendor, balas: *DAFTAR VENDOR*`,
          handled: true,
        };
      }
    }

    const vendorId = existing?.id ?? user.entityId;
    if (!vendorId) {
      return { reply: `Balas *DAFTAR VENDOR* untuk mendaftar sebagai vendor.`, handled: true };
    }

    // Get vendor base info
    let vendorName = existing?.name ?? "";
    let registrationStatus = existing?.registration_status ?? "unregistered";

    if (!existing && user.entityId) {
      try {
        const rows = await db.execute(sql`
          SELECT name, registration_status FROM suppliers WHERE id = ${user.entityId} LIMIT 1
        `);
        const r = (rows.rows as Record<string, unknown>[])[0];
        if (r) { vendorName = String(r["name"] ?? ""); registrationStatus = String(r["registration_status"] ?? "unregistered"); }
      } catch { /* ignore */ }
    }

    // Get risk assessment
    const risk = await db
      .select()
      .from(vendorRiskAssessmentsTable)
      .where(and(
        eq(vendorRiskAssessmentsTable.vendorId, vendorId),
        eq(vendorRiskAssessmentsTable.isActive, true),
      ))
      .limit(1)
      .then((r) => r[0] ?? null);

    // Get performance
    const perf = await db
      .select()
      .from(vendorPerformanceSnapshotsTable)
      .where(eq(vendorPerformanceSnapshotsTable.vendorId, vendorId))
      .orderBy(vendorPerformanceSnapshotsTable.snapshotDate)
      .limit(1)
      .then((r) => r[0] ?? null);

    const statusLabels: Record<string, string> = {
      unregistered: "📋 Belum Terdaftar",
      pending_review: "🕐 Menunggu Review",
      approved: "✅ Aktif / Disetujui",
      rejected: "❌ Ditolak",
      needs_revision: "📝 Perlu Revisi",
    };

    const riskEmoji: Record<string, string> = { low: "🟢", medium: "🟡", high: "🟠", critical: "🔴" };

    // Generate status portal link
    let portalLine = "";
    try {
      const statusToken = await createPortalToken(phone, "status", vendorId as number, 24);
      const url = `${BASE_URL}/vendor/status/${statusToken}`;
      portalLine = `\n🔗 Detail lengkap: ${url}`;
    } catch { /* non-critical */ }

    const reply =
      `🏢 *Status Vendor — ${vendorName || "Anda"}*\n\n` +
      `📊 Status: *${statusLabels[registrationStatus] ?? registrationStatus}*\n` +
      `${risk ? `${riskEmoji[risk.tier ?? "medium"] ?? "⚪"} Risk Tier: *${risk.tier?.toUpperCase() ?? "-"}*\n` : ""}` +
      `${perf ? `⭐ Grade: *${perf.performanceGrade ?? "-"}* (${Number(perf.performanceScore ?? 0).toFixed(0)}/100)\n` : ""}` +
      `📄 Balas *DOKUMEN VENDOR* untuk cek status dokumen.` +
      portalLine;

    return { reply, handled: true };
  }

  // ── DOKUMEN VENDOR ──────────────────────────────────────────────────────────
  if (command === "DOKUMEN VENDOR") {
    const existing = await findSupplierByPhone(phone);
    const vendorId = existing?.id ?? user.entityId;

    if (!vendorId) {
      return {
        reply:
          `📂 Nomor WhatsApp Anda belum terdaftar sebagai vendor.\n\nUntuk mendaftar: balas *DAFTAR VENDOR*`,
        handled: true,
      };
    }

    const today = new Date().toISOString().split("T")[0]!;
    const in30days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]!;

    let docRows: Array<{ document_type: string; file_name: string; expiry_date: string | null; status: string }> = [];
    try {
      if (supabasePool) {
        const result = await supabasePool.query(
          `SELECT document_type, file_name, expiry_date, status
           FROM vendor_document_registry
           WHERE vendor_id = $1
           ORDER BY expiry_date ASC NULLS LAST
           LIMIT 20`,
          [vendorId],
        );
        docRows = result.rows;
      } else {
        const rows = await db.execute(sql`
          SELECT document_type, file_name, expiry_date, status
          FROM vendor_document_registry
          WHERE vendor_id = ${vendorId}
          ORDER BY expiry_date ASC NULLS LAST
          LIMIT 20
        `);
        docRows = rows.rows as typeof docRows;
      }
    } catch (err) {
      logger.warn({ err }, "wa-vendor: vendor_document_registry query failed");
    }

    // Generate document portal link
    let portalLine = "";
    try {
      const docToken = await createPortalToken(phone, "documents", vendorId as number, 24);
      const url = `${BASE_URL}/vendor/documents/${docToken}`;
      portalLine = `\n\n🔗 Portal Dokumen: ${url}\n_(upload dokumen via tautan di atas)_`;
    } catch { /* non-critical */ }

    if (docRows.length === 0) {
      return {
        reply:
          `📂 *Dokumen Vendor*\n\n` +
          `Belum ada dokumen yang terdaftar untuk akun Anda.` +
          portalLine,
        handled: true,
      };
    }

    const expired = docRows.filter((d) => d.expiry_date && d.expiry_date < today);
    const expiringSoon = docRows.filter(
      (d) => d.expiry_date && d.expiry_date >= today && d.expiry_date <= in30days,
    );
    const valid = docRows.filter((d) => !d.expiry_date || d.expiry_date > in30days);

    const fmtDocs = (rows: typeof docRows, prefix: string) =>
      rows.map((d) => `${prefix} ${d.document_type}${d.expiry_date ? ` (exp: ${d.expiry_date})` : ""}`).join("\n");

    let reply = `📂 *Status Dokumen Vendor*\n\n`;
    if (expired.length > 0) reply += `❌ *Kedaluwarsa (${expired.length}):*\n${fmtDocs(expired, "❌")}\n\n`;
    if (expiringSoon.length > 0) reply += `⚠️ *Segera Kadaluarsa (${expiringSoon.length}):*\n${fmtDocs(expiringSoon, "⚠️")}\n\n`;
    if (valid.length > 0) reply += `✅ *Aktif (${valid.length}):*\n${fmtDocs(valid, "✅")}`;
    reply += portalLine;

    return { reply, handled: true };
  }

  return null;
}
