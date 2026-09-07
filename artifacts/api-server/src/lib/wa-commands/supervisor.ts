/**
 * Sprint 10A-1 — Supervisor WhatsApp Commands
 *
 * Commands:
 *   APPROVAL           — list pending approvals
 *   APPROVE [ID]       — approve dengan konfirmasi (APPROVE [ID] → KONFIRMASI [ID])
 *   KONFIRMASI [ID]    — konfirmasi approval
 *   REJECT [ID] [...]  — tolak dengan alasan inline
 */

import { eq, and, or } from "drizzle-orm";
import {
  db, logisticPurchaseRequestsTable, teamMembersTable, aiTasksTable,
} from "@workspace/db";
import { sendFonnte } from "../fonnte";
import { logger } from "../logger";
import type { WaCommandContext, WaCommandResult } from "./types";

// In-memory pending confirmations (phone → {action, id, expiry})
// TTL: 5 minutes
const pendingApprovals = new Map<string, {
  action: "approve" | "reject";
  requestId: number;
  requestNumber: string;
  expiry: number;
}>();

function cleanExpired() {
  const now = Date.now();
  for (const [key, val] of pendingApprovals) {
    if (val.expiry < now) pendingApprovals.delete(key);
  }
}

export async function handleSupervisorCommand(
  ctx: WaCommandContext,
): Promise<WaCommandResult | null> {
  const { command, args, phone, user, companyId } = ctx;

  cleanExpired();

  // ── APPROVAL ────────────────────────────────────────────────────────────────
  if (command === "APPROVAL") {
    const pending = await db
      .select({
        id: logisticPurchaseRequestsTable.id,
        requestNumber: logisticPurchaseRequestsTable.requestNumber,
        serviceCategory: logisticPurchaseRequestsTable.serviceCategory,
        estimatedAmount: logisticPurchaseRequestsTable.estimatedAmount,
        aiRiskTier: logisticPurchaseRequestsTable.aiRiskTier,
        requestedBy: logisticPurchaseRequestsTable.requestedBy,
      })
      .from(logisticPurchaseRequestsTable)
      .where(
        and(
          eq(logisticPurchaseRequestsTable.companyId, companyId),
          eq(logisticPurchaseRequestsTable.status, "submitted_for_approval"),
        ),
      )
      .orderBy(logisticPurchaseRequestsTable.id)
      .limit(10);

    if (pending.length === 0) {
      return {
        reply: `✅ *Tidak ada persetujuan yang menunggu.*\n\n_Semua purchase request sudah ditangani._`,
        handled: true,
      };
    }

    const riskEmoji: Record<string, string> = {
      low: "🟢", medium: "🟡", high: "🟠", critical: "🔴",
    };

    const list = pending
      .map((p, i) => {
        const risk = riskEmoji[p.aiRiskTier ?? "medium"] ?? "⚪";
        const amount = p.estimatedAmount
          ? `Rp ${Number(p.estimatedAmount).toLocaleString("id-ID")}`
          : "-";
        return (
          `${i + 1}. ${risk} *${p.requestNumber}*\n` +
          `   Layanan: ${p.serviceCategory ?? "-"}\n` +
          `   Nilai: ${amount}\n` +
          `   Oleh: ${p.requestedBy ?? "-"}`
        );
      })
      .join("\n\n");

    return {
      reply:
        `📋 *${pending.length} Approval Menunggu*\n\n` +
        `${list}\n\n` +
        `_Balas *APPROVE [ID]* atau *REJECT [ID] [ALASAN]* untuk memproses._\n` +
        `_Contoh: APPROVE ${pending[0]?.requestNumber ?? "PR-001"}_`,
      handled: true,
    };
  }

  // ── KONFIRMASI [ID] — confirm pending approval ──────────────────────────────
  if (command === "KONFIRMASI") {
    const requestNumber = args[0]?.toUpperCase();
    const pending = pendingApprovals.get(phone);

    if (!pending || pending.action !== "approve") {
      return {
        reply: `❓ Tidak ada approval yang menunggu konfirmasi.\n\nGunakan *APPROVE [ID]* terlebih dahulu.`,
        handled: true,
      };
    }

    // Check if request number matches
    if (requestNumber && !pending.requestNumber.toUpperCase().includes(requestNumber)) {
      return {
        reply: `❓ ID tidak cocok. Konfirmasi untuk: *${pending.requestNumber}*\n\nBalas: KONFIRMASI ${pending.requestNumber}`,
        handled: true,
      };
    }

    pendingApprovals.delete(phone);

    const [updated] = await db
      .update(logisticPurchaseRequestsTable)
      .set({
        status: "approved",
        approvedBy: user.name ?? phone,
        approvedAt: new Date(),
        notes: `Disetujui via WhatsApp oleh ${user.name ?? phone}`,
      })
      .where(eq(logisticPurchaseRequestsTable.id, pending.requestId))
      .returning();

    if (!updated) {
      return { reply: `❌ Gagal memproses approval. Coba lagi atau gunakan dashboard.`, handled: true };
    }

    // Notify requester if phone available
    const requesterRows = await db
      .select({ phone: teamMembersTable.phone })
      .from(teamMembersTable)
      .where(
        and(
          eq(teamMembersTable.companyId, companyId),
          eq(teamMembersTable.name, updated.requestedBy ?? ""),
        ),
      )
      .limit(1);

    if (requesterRows[0]?.phone) {
      sendFonnte(
        requesterRows[0].phone,
        `✅ *Purchase Request Disetujui!*\n\nNo: ${pending.requestNumber}\nDisetujui oleh: ${user.name ?? "Supervisor"}\n\nRequest Anda sudah dapat diproses.`,
      ).catch(() => {});
    }

    return {
      reply:
        `✅ *${pending.requestNumber} Disetujui!*\n\n` +
        `Approval berhasil dicatat.\nDisetujui oleh: ${user.name ?? phone}\n\n` +
        `_Pemohon akan mendapat notifikasi._`,
      handled: true,
    };
  }

  // ── APPROVE [ID] — first step: confirm ─────────────────────────────────────
  if (command === "APPROVE") {
    const requestNumber = args[0]?.toUpperCase();
    if (!requestNumber) {
      return {
        reply: `❓ Format: *APPROVE [ID]*\n\nContoh: APPROVE PR-2026-001\n\nLihat daftar: *APPROVAL*`,
        handled: true,
      };
    }

    const request = await db
      .select()
      .from(logisticPurchaseRequestsTable)
      .where(
        and(
          eq(logisticPurchaseRequestsTable.companyId, companyId),
          eq(logisticPurchaseRequestsTable.requestNumber, requestNumber),
        ),
      )
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!request) {
      return {
        reply: `❌ Request *${requestNumber}* tidak ditemukan.\n\nLihat daftar approval: *APPROVAL*`,
        handled: true,
      };
    }

    if (request.status !== "submitted_for_approval") {
      return {
        reply: `⚠️ Request *${requestNumber}* tidak dalam status menunggu approval.\nStatus saat ini: ${request.status}`,
        handled: true,
      };
    }

    const amount = request.estimatedAmount
      ? `Rp ${Number(request.estimatedAmount).toLocaleString("id-ID")}`
      : "-";
    const riskEmoji: Record<string, string> = { low: "🟢", medium: "🟡", high: "🟠", critical: "🔴" };
    const risk = riskEmoji[request.aiRiskTier ?? "medium"] ?? "⚪";

    // Save pending confirmation
    pendingApprovals.set(phone, {
      action: "approve",
      requestId: request.id,
      requestNumber,
      expiry: Date.now() + 5 * 60 * 1000, // 5 min TTL
    });

    return {
      reply:
        `📋 *Konfirmasi Approval*\n\n` +
        `No: *${requestNumber}*\n` +
        `Layanan: ${request.serviceCategory ?? "-"}\n` +
        `Nilai: ${amount}\n` +
        `${risk} Risiko: ${request.aiRiskTier?.toUpperCase() ?? "-"}\n` +
        `Oleh: ${request.requestedBy ?? "-"}\n\n` +
        `⚠️ Untuk menyetujui, balas:\n*KONFIRMASI ${requestNumber}*\n\n` +
        `_Konfirmasi berlaku 5 menit._`,
      handled: true,
    };
  }

  // ── REJECT [ID] [ALASAN...] ─────────────────────────────────────────────────
  if (command === "REJECT") {
    const requestNumber = args[0]?.toUpperCase();
    const reason = args.slice(1).join(" ").trim();

    if (!requestNumber) {
      return {
        reply:
          `❓ Format: *REJECT [ID] [ALASAN]*\n\n` +
          `Contoh: REJECT PR-2026-001 Harga terlalu tinggi\n\nLihat daftar: *APPROVAL*`,
        handled: true,
      };
    }

    if (!reason) {
      return {
        reply:
          `❓ Sertakan alasan penolakan:\n\n` +
          `Format: *REJECT ${requestNumber} [ALASAN]*\n` +
          `Contoh: REJECT ${requestNumber} Harga tidak sesuai kontrak`,
        handled: true,
      };
    }

    const request = await db
      .select()
      .from(logisticPurchaseRequestsTable)
      .where(
        and(
          eq(logisticPurchaseRequestsTable.companyId, companyId),
          eq(logisticPurchaseRequestsTable.requestNumber, requestNumber),
        ),
      )
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!request) {
      return {
        reply: `❌ Request *${requestNumber}* tidak ditemukan.`,
        handled: true,
      };
    }

    await db
      .update(logisticPurchaseRequestsTable)
      .set({
        status: "rejected",
        rejectedBy: user.name ?? phone,
        rejectedAt: new Date(),
        rejectedReason: reason,
        notes: `Ditolak via WhatsApp oleh ${user.name ?? phone}: ${reason}`,
      })
      .where(eq(logisticPurchaseRequestsTable.id, request.id));

    // Notify requester
    const requesterRows = await db
      .select({ phone: teamMembersTable.phone })
      .from(teamMembersTable)
      .where(
        and(
          eq(teamMembersTable.companyId, companyId),
          eq(teamMembersTable.name, request.requestedBy ?? ""),
        ),
      )
      .limit(1);

    if (requesterRows[0]?.phone) {
      sendFonnte(
        requesterRows[0].phone,
        `❌ *Purchase Request Ditolak*\n\nNo: ${requestNumber}\nAlasan: ${reason}\nOleh: ${user.name ?? "Supervisor"}\n\nSilakan revisi dan ajukan ulang jika diperlukan.`,
      ).catch(() => {});
    }

    return {
      reply:
        `❌ *${requestNumber} Ditolak*\n\n` +
        `Alasan: ${reason}\n` +
        `Ditolak oleh: ${user.name ?? phone}\n\n` +
        `_Pemohon sudah diberitahu._`,
      handled: true,
    };
  }

  return null;
}
