/**
 * Sprint 10A-1 — WhatsApp Command Router
 *
 * Entry point for all incoming WA messages.
 * Returns true if the message was handled as a command (AI detection should be skipped).
 * Returns false if no command matched (fall through to normal AI pipeline).
 *
 * Command syntax:
 *   Single-word:  STATUS CST-001 | BBM B1234XYZ 40 125000
 *   Two-word:     DAFTAR VENDOR | STATUS VENDOR | HELP DRIVER | DOKUMEN VENDOR
 *
 * Role-to-command mapping:
 *   customer         → STATUS, DOCS, HELP, MENU
 *   driver           → BBM, RUSAK, POSISI, HELP DRIVER, MENU
 *   vendor           → DAFTAR VENDOR, STATUS VENDOR, DOKUMEN VENDOR, MENU
 *   staff            → same as customer (limited ops)
 *   supervisor       → APPROVAL, APPROVE, KONFIRMASI, REJECT, + customer cmds
 *   company_admin    → all supervisor + executive
 *   owner/super_admin → all commands
 *   unknown          → DAFTAR VENDOR only + MENU
 */

import { resolveWaRole, isSupervisorOrAbove, isAdminOrAbove } from "./wa-role-resolver";
import { handleCustomerCommand } from "./wa-commands/customer";
import { handleDriverCommand } from "./wa-commands/driver";
import { handleVendorCommand } from "./wa-commands/vendor";
import { handleSupervisorCommand } from "./wa-commands/supervisor";
import { handleExecutiveCommand } from "./wa-commands/executive";
import { sendFonnte } from "./fonnte";
import { db, whatsappCommandLogsTable, whatsappUsageMetricsTable } from "@workspace/db";
import { logger } from "./logger";
import type { WaCommandContext } from "./wa-commands/types";

// ── Command parsing ─────────────────────────────────────────────────────────────

const TWO_WORD_COMMANDS = new Set([
  "DAFTAR VENDOR",
  "STATUS VENDOR",
  "DOKUMEN VENDOR",
  "HELP DRIVER",
]);

const ALL_COMMANDS = new Set([
  // Single-word
  "STATUS", "DOCS", "HELP", "MENU",
  "BBM", "RUSAK", "POSISI",
  "APPROVAL", "APPROVE", "KONFIRMASI", "REJECT",
  "DASHBOARD", "RISK", "BRIEFING",
  // Two-word handled via set above
]);

function parseCommand(raw: string): { command: string; args: string[]; rawArgs: string } | null {
  const text = raw.trim().toUpperCase();
  const parts = text.split(/\s+/);

  // Try two-word commands first
  const twoWord = parts.slice(0, 2).join(" ");
  if (TWO_WORD_COMMANDS.has(twoWord)) {
    const rawArgs = raw.trim().slice(twoWord.length).trim();
    return { command: twoWord, args: rawArgs ? rawArgs.split(/\s+/) : [], rawArgs };
  }

  // Try single-word
  const oneWord = parts[0] ?? "";
  if (ALL_COMMANDS.has(oneWord)) {
    const rawArgs = raw.trim().slice(oneWord.length).trim();
    return { command: oneWord, args: rawArgs ? rawArgs.split(/\s+/) : [], rawArgs };
  }

  return null;
}

// ── MENU reply by role ──────────────────────────────────────────────────────────

function buildMenuReply(role: string, name: string | null): string {
  const greeting = `Halo${name ? ` *${name}*` : ""}! 👋`;

  if (role === "customer" || role === "staff") {
    return (
      `${greeting}\n\n📱 *Menu WhatsApp*\n\n` +
      `📦 *STATUS [NOMOR]* — status pesanan\n` +
      `📂 *DOCS [NOMOR]* — dokumen pesanan\n` +
      `❓ *HELP* — panduan lengkap\n\n` +
      `_Ketik perintah di atas untuk mulai._`
    );
  }
  if (role === "driver") {
    return (
      `${greeting}\n\n🚛 *Menu Driver*\n\n` +
      `⛽ *BBM [PLAT] [LITER] [KM]*\n` +
      `🔧 *RUSAK [PLAT] [DESKRIPSI]*\n` +
      `📍 *POSISI [PLAT] [LOKASI]*\n` +
      `❓ *HELP DRIVER* — panduan lengkap\n\n` +
      `_Ketik perintah di atas untuk mulai._`
    );
  }
  if (role === "vendor") {
    return (
      `${greeting}\n\n🏢 *Menu Vendor*\n\n` +
      `🏢 *DAFTAR VENDOR* — daftar sebagai vendor\n` +
      `📊 *STATUS VENDOR* — status akun vendor\n` +
      `📂 *DOKUMEN VENDOR* — cek dokumen vendor\n\n` +
      `_Ketik perintah di atas untuk mulai._`
    );
  }
  if (role === "supervisor") {
    return (
      `${greeting}\n\n👔 *Menu Supervisor*\n\n` +
      `📋 *APPROVAL* — daftar approval menunggu\n` +
      `✅ *APPROVE [ID]* — setujui purchase request\n` +
      `❌ *REJECT [ID] [ALASAN]* — tolak PR\n` +
      `📦 *STATUS [NOMOR]* — status task\n\n` +
      `_Ketik perintah di atas untuk mulai._`
    );
  }
  if (role === "company_admin" || role === "owner" || role === "super_admin") {
    return (
      `${greeting}\n\n🏢 *Menu Admin/Executive*\n\n` +
      `📊 *DASHBOARD* — ringkasan KPI\n` +
      `⚠️ *RISK* — top risiko hari ini\n` +
      `🧠 *BRIEFING* — AI executive summary\n` +
      `📋 *APPROVAL* — approval menunggu\n` +
      `✅ *APPROVE [ID]* — setujui PR\n` +
      `❌ *REJECT [ID] [ALASAN]* — tolak PR\n` +
      `📦 *STATUS [NOMOR]* — status task\n\n` +
      `_Ketik perintah di atas untuk mulai._`
    );
  }
  // Unknown
  return (
    `${greeting}\n\n📱 *Menu WhatsApp*\n\n` +
    `Nomor Anda belum terdaftar di sistem kami.\n\n` +
    `🏢 *DAFTAR VENDOR* — daftar sebagai vendor\n\n` +
    `_Untuk pertanyaan, hubungi admin kami._`
  );
}

// ── Audit log + usage metrics ───────────────────────────────────────────────────

async function logCommandExecution(
  ctx: WaCommandContext,
  result: "ok" | "error" | "unauthorized",
  replyPreview: string,
  durationMs: number,
): Promise<void> {
  try {
    await db.insert(whatsappCommandLogsTable).values({
      companyId: ctx.companyId,
      phone: ctx.phone,
      role: ctx.user.role,
      command: ctx.command,
      args: ctx.rawArgs || null,
      result,
      replyPreview: replyPreview.slice(0, 200),
      durationMs,
    });
  } catch (err) {
    logger.warn({ err }, "wa-command-router: failed to write command log");
  }

  // Track daily usage metrics (insert-only append — aggregated at query time)
  try {
    const today = new Date().toISOString().split("T")[0];
    await db.insert(whatsappUsageMetricsTable).values({
      companyId: ctx.companyId,
      metricDate: today,
      role: ctx.user.role,
      command: ctx.command,
      execCount: 1,
      uniquePhones: 1,
      successCount: result === "ok" ? 1 : 0,
      errorCount: result === "error" ? 1 : 0,
      avgDurationMs: durationMs,
    });
  } catch { /* metrics are non-critical */ }
}

// ── Main router ────────────────────────────────────────────────────────────────

export async function routeWaCommand(
  phone: string,
  text: string,
  companyId: string,
): Promise<boolean> {
  // 1. Parse command
  const parsed = parseCommand(text);
  if (!parsed) return false;

  const { command, args, rawArgs } = parsed;
  const startTime = Date.now();

  // 2. Resolve role
  const user = await resolveWaRole(phone, companyId);

  const ctx: WaCommandContext = {
    rawText: text,
    command,
    args,
    rawArgs,
    phone,
    user,
    companyId,
  };

  logger.info({ phone, command, role: user.role, companyId }, "wa-command: dispatching");

  try {
    // 3. MENU — always allowed
    if (command === "MENU") {
      const reply = buildMenuReply(user.role, user.name);
      await sendFonnte(phone, reply);
      await logCommandExecution(ctx, "ok", reply, Date.now() - startTime);
      return true;
    }

    // 4. Dispatch by role
    let result = null;

    // Customer commands (STATUS, DOCS, HELP) — customer, staff, and above
    if (["STATUS", "DOCS", "HELP"].includes(command)) {
      if (user.role === "unknown") {
        const reply = "❌ Nomor Anda belum terdaftar. Balas *MENU* untuk informasi lebih lanjut.";
        await sendFonnte(phone, reply);
        await logCommandExecution(ctx, "unauthorized", reply, Date.now() - startTime);
        return true;
      }
      result = await handleCustomerCommand(ctx);
    }

    // Driver commands
    if (!result && ["BBM", "RUSAK", "POSISI", "HELP DRIVER"].includes(command)) {
      if (user.role !== "driver" && !isAdminOrAbove(user.role)) {
        const reply = "❌ Perintah ini hanya untuk driver terdaftar.";
        await sendFonnte(phone, reply);
        await logCommandExecution(ctx, "unauthorized", reply, Date.now() - startTime);
        return true;
      }
      result = await handleDriverCommand(ctx);
    }

    // Vendor commands
    if (!result && ["DAFTAR VENDOR", "STATUS VENDOR", "DOKUMEN VENDOR"].includes(command)) {
      result = await handleVendorCommand(ctx);
    }

    // Supervisor commands
    if (!result && ["APPROVAL", "APPROVE", "KONFIRMASI", "REJECT"].includes(command)) {
      if (!isSupervisorOrAbove(user.role)) {
        const reply = "❌ Perintah ini hanya untuk supervisor atau lebih tinggi.";
        await sendFonnte(phone, reply);
        await logCommandExecution(ctx, "unauthorized", reply, Date.now() - startTime);
        return true;
      }
      result = await handleSupervisorCommand(ctx);
    }

    // Executive commands
    if (!result && ["DASHBOARD", "RISK", "BRIEFING"].includes(command)) {
      if (!isAdminOrAbove(user.role)) {
        const reply = "❌ Perintah ini hanya untuk admin/executive.";
        await sendFonnte(phone, reply);
        await logCommandExecution(ctx, "unauthorized", reply, Date.now() - startTime);
        return true;
      }
      result = await handleExecutiveCommand(ctx);
    }

    if (result?.handled && result.reply) {
      await sendFonnte(phone, result.reply);
      await logCommandExecution(ctx, "ok", result.reply, Date.now() - startTime);
      return true;
    }

    // Command parsed but no handler matched (shouldn't happen normally)
    return false;
  } catch (err) {
    logger.error({ err, phone, command }, "wa-command-router: handler threw");
    const errReply = "⚠️ Terjadi kesalahan saat memproses perintah. Coba lagi atau hubungi admin.";
    await sendFonnte(phone, errReply).catch(() => {});
    await logCommandExecution(ctx, "error", errReply, Date.now() - startTime);
    return true; // Return true to prevent double-processing via AI
  }
}
