/**
 * Sprint 10A-1 — Executive WhatsApp Commands
 *
 * Commands:
 *   DASHBOARD  — executive KPI summary
 *   RISK       — top 10 risks today
 *   BRIEFING   — AI executive summary
 */

import { eq, and, desc, sql } from "drizzle-orm";
import {
  db, aiTasksTable, logisticPurchaseRequestsTable, fleetUnitsTable,
  customersTable,
} from "@workspace/db";
import { logger } from "../logger";
import { generateBriefingMessage } from "../executive-briefing";
import type { WaCommandContext, WaCommandResult } from "./types";

export async function handleExecutiveCommand(
  ctx: WaCommandContext,
): Promise<WaCommandResult | null> {
  const { command, user, companyId } = ctx;

  // ── DASHBOARD ───────────────────────────────────────────────────────────────
  if (command === "DASHBOARD") {
    const [
      activeTasks,
      pendingApprovals,
      highRiskCustomers,
      fleetIssues,
    ] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)` })
        .from(aiTasksTable)
        .where(
          and(
            eq(aiTasksTable.companyId, companyId),
            sql`${aiTasksTable.status} NOT IN ('completed', 'cancelled')`,
          ),
        )
        .then((r) => Number(r[0]?.count ?? 0)),

      db
        .select({ count: sql<number>`count(*)` })
        .from(logisticPurchaseRequestsTable)
        .where(
          and(
            eq(logisticPurchaseRequestsTable.companyId, companyId),
            eq(logisticPurchaseRequestsTable.status, "submitted_for_approval"),
          ),
        )
        .then((r) => Number(r[0]?.count ?? 0)),

      // customers.company_id is INTEGER — cannot filter with text companyId;
      // use a raw count of high/blocked risk customers across all companies
      db
        .select({ count: sql<number>`count(*)` })
        .from(customersTable)
        .where(sql`${customersTable.riskTier} IN ('high', 'blocked')`)
        .then((r) => Number(r[0]?.count ?? 0)),

      db
        .select({ count: sql<number>`count(*)` })
        .from(fleetUnitsTable)
        .where(
          and(
            eq(fleetUnitsTable.companyId, companyId),
            sql`${fleetUnitsTable.status} IN ('maintenance', 'inactive')`,
          ),
        )
        .then((r) => Number(r[0]?.count ?? 0)),
    ]);

    const now = new Date().toLocaleString("id-ID", {
      weekday: "long", day: "2-digit", month: "short", year: "numeric",
    });

    return {
      reply:
        `📊 *Executive Dashboard*\n${now}\n\n` +
        `📋 Task Aktif: *${activeTasks}*\n` +
        `⏳ Menunggu Approval: *${pendingApprovals}*\n` +
        `⚠️ Customer Risiko Tinggi: *${highRiskCustomers}*\n` +
        `🚛 Armada Bermasalah: *${fleetIssues}*\n\n` +
        (pendingApprovals > 0
          ? `🔴 *${pendingApprovals} approval menunggu keputusan Anda.*\nBalas *APPROVAL* untuk rincian.\n\n`
          : "") +
        `_Balas *RISK* untuk top risiko hari ini._\n` +
        `_Balas *BRIEFING* untuk ringkasan AI._`,
      handled: true,
    };
  }

  // ── RISK ────────────────────────────────────────────────────────────────────
  if (command === "RISK") {
    const risks: Array<{ label: string; severity: "high" | "critical" | "medium"; detail: string }> = [];

    // High-risk purchase requests
    const highRiskPR = await db
      .select({
        requestNumber: logisticPurchaseRequestsTable.requestNumber,
        aiRiskTier: logisticPurchaseRequestsTable.aiRiskTier,
        estimatedAmount: logisticPurchaseRequestsTable.estimatedAmount,
        serviceCategory: logisticPurchaseRequestsTable.serviceCategory,
      })
      .from(logisticPurchaseRequestsTable)
      .where(
        and(
          eq(logisticPurchaseRequestsTable.companyId, companyId),
          sql`${logisticPurchaseRequestsTable.aiRiskTier} IN ('high', 'critical')`,
          sql`${logisticPurchaseRequestsTable.status} NOT IN ('approved', 'rejected', 'cancelled')`,
        ),
      )
      .orderBy(desc(logisticPurchaseRequestsTable.id))
      .limit(4);

    for (const pr of highRiskPR) {
      risks.push({
        label: `PR ${pr.requestNumber}`,
        severity: (pr.aiRiskTier as "high" | "critical") ?? "high",
        detail: `${pr.serviceCategory ?? "-"} — Rp ${Number(pr.estimatedAmount ?? 0).toLocaleString("id-ID")}`,
      });
    }

    // Overdue tasks
    const overdueTasks = await db
      .select({
        taskNumber: aiTasksTable.taskNumber,
        title: aiTasksTable.title,
      })
      .from(aiTasksTable)
      .where(
        and(
          eq(aiTasksTable.companyId, companyId),
          eq(aiTasksTable.slaStatus, "overdue"),
          sql`${aiTasksTable.status} NOT IN ('completed', 'cancelled')`,
        ),
      )
      .limit(3);

    for (const t of overdueTasks) {
      risks.push({
        label: `Task ${t.taskNumber}`,
        severity: "high",
        detail: (t.title ?? "-").slice(0, 60),
      });
    }

    // Fleet maintenance issues
    const fleetIssues = await db
      .select({
        plateNumber: fleetUnitsTable.plateNumber,
        status: fleetUnitsTable.status,
      })
      .from(fleetUnitsTable)
      .where(
        and(
          eq(fleetUnitsTable.companyId, companyId),
          eq(fleetUnitsTable.status, "maintenance"),
        ),
      )
      .limit(3);

    for (const f of fleetIssues) {
      risks.push({
        label: `Armada ${f.plateNumber}`,
        severity: "medium",
        detail: "Status: Dalam Perbaikan",
      });
    }

    if (risks.length === 0) {
      return {
        reply: `✅ *Tidak ada risiko signifikan hari ini.*\n\nSemua operasional berjalan normal.`,
        handled: true,
      };
    }

    const sevEmoji: Record<string, string> = {
      critical: "🔴", high: "🟠", medium: "🟡",
    };

    const riskList = risks
      .slice(0, 10)
      .map((r, i) => `${i + 1}. ${sevEmoji[r.severity]} *${r.label}*\n   ${r.detail}`)
      .join("\n\n");

    return {
      reply:
        `⚠️ *Top Risiko Hari Ini (${risks.length})*\n\n` +
        `${riskList}\n\n` +
        `_Balas *BRIEFING* untuk ringkasan AI lengkap._`,
      handled: true,
    };
  }

  // ── BRIEFING ────────────────────────────────────────────────────────────────
  if (command === "BRIEFING") {
    try {
      const message = await generateBriefingMessage(companyId);
      return { reply: message, handled: true };
    } catch (err) {
      logger.error({ err }, "wa-executive: generateBriefingMessage failed");
      return {
        reply: "⚠️ Gagal membuat briefing. Coba lagi atau buka Executive Command Center di dashboard.",
        handled: true,
      };
    }
  }

  return null;
}
