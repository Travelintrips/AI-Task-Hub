/**
 * Sprint 10A-1 — Vendor WhatsApp Commands
 *
 * Commands:
 *   DAFTAR VENDOR    — mulai onboarding vendor
 *   STATUS VENDOR    — status vendor (tier, risk, dokumen)
 *   DOKUMEN VENDOR   — daftar dokumen vendor
 */

import { eq, and, lt, lte, gte } from "drizzle-orm";
import {
  db, vendorRiskAssessmentsTable, vendorCapabilitiesTable,
  vendorPerformanceSnapshotsTable,
} from "@workspace/db";
import { supabasePool } from "../supabase-db";
import { logger } from "../logger";
import type { WaCommandContext, WaCommandResult } from "./types";

export async function handleVendorCommand(
  ctx: WaCommandContext,
): Promise<WaCommandResult | null> {
  const { command, user, companyId } = ctx;

  // ── DAFTAR VENDOR ───────────────────────────────────────────────────────────
  if (command === "DAFTAR VENDOR") {
    return {
      reply:
        `🏢 *Pendaftaran Vendor Baru*\n\n` +
        `Terima kasih atas minat Anda bergabung sebagai vendor!\n\n` +
        `Untuk mendaftar, silakan siapkan:\n` +
        `1. Nama perusahaan\n` +
        `2. NPWP/NIB perusahaan\n` +
        `3. Jenis layanan (trucking/freight/dll)\n` +
        `4. Kota asal operasional\n` +
        `5. Kontak PIC\n\n` +
        `📱 Tim kami akan menghubungi Anda dalam 1x24 jam kerja untuk proses verifikasi.\n\n` +
        `_Sudah terdaftar? Balas *STATUS VENDOR* untuk melihat status akun Anda._`,
      handled: true,
    };
  }

  // ── STATUS VENDOR ──────────────────────────────────────────────────────────
  if (command === "STATUS VENDOR") {
    if (!user.entityId) {
      return {
        reply:
          `ℹ️ *Status Vendor*\n\n` +
          `Nomor WhatsApp Anda belum terdaftar sebagai vendor.\n\n` +
          `Untuk mendaftar sebagai vendor, balas: *DAFTAR VENDOR*`,
        handled: true,
      };
    }

    const vendorId = user.entityId;

    // Get risk assessment
    const risk = await db
      .select()
      .from(vendorRiskAssessmentsTable)
      .where(
        and(
          eq(vendorRiskAssessmentsTable.vendorId, vendorId),
          eq(vendorRiskAssessmentsTable.isActive, true),
        ),
      )
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

    // Get capabilities
    const caps = await db
      .select()
      .from(vendorCapabilitiesTable)
      .where(eq(vendorCapabilitiesTable.vendorId, vendorId))
      .limit(5);

    const riskTierEmoji: Record<string, string> = {
      low: "🟢", medium: "🟡", high: "🟠", critical: "🔴",
    };
    const tierEmoji = riskTierEmoji[risk?.tier ?? "medium"] ?? "⚪";

    const capList = caps.length > 0
      ? caps.map((c) => `• ${c.serviceType}`).join("\n")
      : "_(belum ada kapabilitas terdaftar)_";

    const reply =
      `🏢 *Status Vendor Anda*\n\n` +
      `🆔 Vendor ID: ${vendorId}\n` +
      `${tierEmoji} Risk Tier: *${(risk?.tier ?? "Belum dinilai").toUpperCase()}*\n` +
      `📊 Risk Score: ${risk?.riskScore ?? "-"}/100\n` +
      `⭐ Performa: ${perf?.performanceGrade ?? "-"} (${perf?.performanceScore?.toFixed(0) ?? "-"}/100)\n` +
      `📦 Kapabilitas:\n${capList}\n\n` +
      `📄 Balas *DOKUMEN VENDOR* untuk cek status dokumen.`;

    return { reply, handled: true };
  }

  // ── DOKUMEN VENDOR ──────────────────────────────────────────────────────────
  if (command === "DOKUMEN VENDOR") {
    if (!user.entityId) {
      return {
        reply:
          `ℹ️ Nomor WhatsApp Anda belum terdaftar sebagai vendor.\n\nUntuk mendaftar: *DAFTAR VENDOR*`,
        handled: true,
      };
    }

    const vendorId = user.entityId;
    const today = new Date().toISOString().split("T")[0];
    const in30days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    // Query vendor document registry from Supabase
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
      }
    } catch (err) {
      logger.warn({ err }, "wa-vendor: vendor_document_registry query failed");
    }

    if (docRows.length === 0) {
      return {
        reply:
          `📂 *Dokumen Vendor*\n\n` +
          `Belum ada dokumen yang terdaftar untuk akun Anda.\n\n` +
          `Hubungi admin untuk mendaftarkan dokumen perusahaan Anda.`,
        handled: true,
      };
    }

    const expired = docRows.filter((d) => d.expiry_date && d.expiry_date < today);
    const expiringSoon = docRows.filter(
      (d) => d.expiry_date && d.expiry_date >= today && d.expiry_date <= in30days,
    );
    const valid = docRows.filter(
      (d) => !d.expiry_date || d.expiry_date > in30days,
    );

    const fmtDocs = (rows: typeof docRows, prefix: string) =>
      rows.map((d) => `${prefix} ${d.document_type} — ${d.file_name}${d.expiry_date ? ` (exp: ${d.expiry_date})` : ""}`).join("\n");

    let reply = `📂 *Status Dokumen Vendor*\n\n`;
    if (expired.length > 0) reply += `❌ *Kedaluwarsa (${expired.length}):*\n${fmtDocs(expired, "❌")}\n\n`;
    if (expiringSoon.length > 0) reply += `⚠️ *Segera Kadaluarsa (${expiringSoon.length}):*\n${fmtDocs(expiringSoon, "⚠️")}\n\n`;
    if (valid.length > 0) reply += `✅ *Aktif (${valid.length}):*\n${fmtDocs(valid, "✅")}\n`;

    if (expired.length > 0 || expiringSoon.length > 0) {
      reply += `\n_Segera perbarui dokumen yang kedaluwarsa agar akun tidak ditangguhkan._`;
    }

    return { reply, handled: true };
  }

  return null;
}
