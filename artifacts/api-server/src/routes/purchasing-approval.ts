/**
 * Sprint 6C — Approval Advisor (enhanced)
 *
 * GET  /api/purchasing/requests/:id/approval-advice
 * POST /api/purchasing/requests/:id/submit-for-approval
 * POST /api/purchasing/approval-requests/:approvalId/decide
 * GET  /api/purchasing/approval-requests
 *
 * Sprint 6C additions:
 * - decide: write purchasing_signals (feedback loop)
 * - decide: WA notification via Fonnte if requester phone available
 * - decide: support `notes` alias for `note`
 * - list: return enriched LPR data with more detail
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  logisticPurchaseRequestsTable,
  purchasingIntelSignalsTable,
  purchasingSignalsTable,
  auditLogsTable,
  teamMembersTable,
} from "@workspace/db/schema";
import { requireAuth, requireRole } from "../middleware/auth";
import { logger } from "../lib/logger";
import { eq, and, desc, ilike } from "drizzle-orm";
import { supabaseQuery } from "../lib/supabase-db";
import { sendFonnte } from "../lib/fonnte";

const router: IRouter = Router();
function cid(req: Request): string { return req.user?.companyId ?? "default"; }

// ── GET /api/purchasing/requests/:id/approval-advice ─────────────────────────

router.get("/purchasing/requests/:id/approval-advice", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const [lpr] = await db
      .select()
      .from(logisticPurchaseRequestsTable)
      .where(and(
        eq(logisticPurchaseRequestsTable.id, parseInt(req.params.id as string)),
        eq(logisticPurchaseRequestsTable.companyId, companyId),
      ));
    if (!lpr) return res.status(404).json({ error: "Request tidak ditemukan" });

    // Get composite intel signal
    const signals = await db
      .select()
      .from(purchasingIntelSignalsTable)
      .where(and(
        eq(purchasingIntelSignalsTable.purchaseRequestId, lpr.id),
        eq(purchasingIntelSignalsTable.signalType, "composite"),
      ))
      .orderBy(desc(purchasingIntelSignalsTable.createdAt))
      .limit(1);

    const latestComposite = signals[0];
    const riskTier = lpr.aiRiskTier ?? "unknown";
    const requiresApproval = riskTier === "high" || riskTier === "critical";

    // Get existing Supabase approval if any
    let existingApproval = null;
    if (lpr.supabaseApprovalRequestId) {
      const rows = await supabaseQuery<Record<string, unknown>>(
        `SELECT * FROM approval_requests WHERE id = $1 LIMIT 1`,
        [lpr.supabaseApprovalRequestId]
      );
      existingApproval = rows[0] ?? null;
    }

    const advice = {
      requestId: lpr.id,
      requestNumber: lpr.requestNumber,
      riskTier,
      compositeRiskScore: lpr.aiRiskScore,
      requiresApproval,
      approvalLevel: riskTier === "critical" ? "company_admin" : riskTier === "high" ? "company_admin" : "supervisor",
      approvalStatus: existingApproval ? (existingApproval.status as string) : lpr.status,
      existingApprovalId: lpr.supabaseApprovalRequestId,
      existingApproval,
      approvedBy: lpr.approvedBy,
      approvedAt: lpr.approvedAt,
      rejectedBy: lpr.rejectedBy,
      rejectedAt: lpr.rejectedAt,
      rejectedReason: lpr.rejectedReason,
      latestEvaluation: latestComposite ? {
        headline: latestComposite.headline,
        explanation: latestComposite.explanation,
        clarificationQuestions: latestComposite.clarificationQuestions ?? [],
        scoringBreakdown: latestComposite.scoringBreakdown,
        evaluatedAt: latestComposite.createdAt,
      } : null,
      recommendation: requiresApproval
        ? `Risk tier ${riskTier.toUpperCase()} — wajib mendapatkan persetujuan ${riskTier === "critical" ? "direktur/company_admin" : "supervisor"} sebelum diproses.`
        : "Risk tier dapat diproses tanpa approval khusus. Supervisor dapat mereview langsung.",
    };

    return res.json({ advice });
  } catch (err) {
    logger.error({ err }, "GET /api/purchasing/requests/:id/approval-advice failed");
    return res.status(500).json({ error: "Gagal mendapatkan approval advice" });
  }
});

// ── POST /api/purchasing/requests/:id/submit-for-approval ─────────────────────

router.post("/purchasing/requests/:id/submit-for-approval", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const [lpr] = await db
      .select()
      .from(logisticPurchaseRequestsTable)
      .where(and(
        eq(logisticPurchaseRequestsTable.id, parseInt(req.params.id as string)),
        eq(logisticPurchaseRequestsTable.companyId, companyId),
      ));
    if (!lpr) return res.status(404).json({ error: "Request tidak ditemukan" });

    if (lpr.supabaseApprovalRequestId) {
      return res.status(400).json({ error: "Approval request sudah dibuat sebelumnya", approvalId: lpr.supabaseApprovalRequestId });
    }

    // Get latest intel signals for metadata
    const signals = await db
      .select()
      .from(purchasingIntelSignalsTable)
      .where(eq(purchasingIntelSignalsTable.purchaseRequestId, lpr.id))
      .orderBy(desc(purchasingIntelSignalsTable.createdAt))
      .limit(10);

    const compositeSignal = signals.find(s => s.signalType === "composite");
    const metadata = {
      companyId,
      aiRiskScore: lpr.aiRiskScore,
      aiRiskTier: lpr.aiRiskTier,
      aiDuplicateFlag: lpr.aiDuplicateFlag,
      aiPriceDeviationPct: lpr.aiPriceDeviationPct,
      aiBudgetImpactPct: lpr.aiBudgetImpactPct,
      aiMarginImpactPct: lpr.aiMarginImpactPct,
      aiNarrative: compositeSignal?.explanation ?? "",
      clarificationQuestions: compositeSignal?.clarificationQuestions ?? [],
      scoringBreakdown: compositeSignal?.scoringBreakdown ?? {},
      vendorName: lpr.vendorName,
      serviceCategory: lpr.serviceCategory,
      estimatedAmount: lpr.estimatedAmount,
      currency: lpr.currency,
      submittedAt: new Date().toISOString(),
    };

    // Insert into Supabase approval_requests
    const approvalRows = await supabaseQuery<{ id: number }>(
      `INSERT INTO approval_requests (module, doc_type, doc_id, doc_number, requested_by, status, metadata, notified)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6::jsonb, false)
       RETURNING id`,
      [
        "purchasing_logistics",
        "logistic_purchase_request",
        lpr.id,
        lpr.requestNumber,
        req.user?.name ?? req.user?.email ?? "system",
        JSON.stringify(metadata),
      ]
    );

    const approvalId = approvalRows[0]?.id;
    if (!approvalId) {
      return res.status(500).json({ error: "Gagal membuat approval request di Supabase" });
    }

    // Update LPR
    await db.update(logisticPurchaseRequestsTable)
      .set({ supabaseApprovalRequestId: approvalId, status: "submitted_for_approval" })
      .where(eq(logisticPurchaseRequestsTable.id, lpr.id));

    await db.insert(auditLogsTable).values({
      companyId, userId: req.user?.id, userName: req.user?.name,
      action: "approval_submitted",
      module: "purchasing_intelligence",
      entityId: lpr.id,
      entityType: "logistic_purchase_request",
      after: JSON.stringify({ approvalId, riskTier: lpr.aiRiskTier }),
    });

    return res.json({ success: true, approvalId, message: "Request berhasil diajukan untuk approval" });
  } catch (err) {
    logger.error({ err }, "POST /api/purchasing/requests/:id/submit-for-approval failed");
    return res.status(500).json({ error: "Gagal submit untuk approval" });
  }
});

// ── POST /api/purchasing/approval-requests/:approvalId/decide ─────────────────

router.post("/purchasing/approval-requests/:approvalId/decide", requireAuth, requireRole("company_admin"), async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const approvalId = parseInt(req.params.approvalId as string);
    const { decision, note, notes } = req.body as { decision: "approved" | "rejected"; note?: string; notes?: string };
    const decisionNote = notes ?? note;

    if (!["approved", "rejected"].includes(decision)) {
      return res.status(400).json({ error: "decision harus 'approved' atau 'rejected'" });
    }

    // Get existing approval from Supabase
    const [approval] = await supabaseQuery<{ id: number; doc_id: number; status: string; requested_by: string }>(
      `SELECT id, doc_id, status, requested_by FROM approval_requests WHERE id = $1 AND module = 'purchasing_logistics' LIMIT 1`,
      [approvalId]
    );
    if (!approval) return res.status(404).json({ error: "Approval request tidak ditemukan" });
    if (approval.status !== "pending") {
      return res.status(400).json({ error: `Approval sudah ${approval.status}` });
    }

    // Fetch LPR for notification context
    const [lpr] = await db.select().from(logisticPurchaseRequestsTable)
      .where(eq(logisticPurchaseRequestsTable.id, approval.doc_id))
      .limit(1);

    const approverName = req.user?.name ?? req.user?.email ?? "unknown";
    const now = new Date().toISOString();

    // Update Supabase approval_requests
    if (decision === "approved") {
      await supabaseQuery(
        `UPDATE approval_requests SET status = 'approved', approved_by = $1, approved_at = $2, note = $3 WHERE id = $4`,
        [approverName, now, decisionNote ?? null, approvalId]
      );
    } else {
      await supabaseQuery(
        `UPDATE approval_requests SET status = 'rejected', rejected_by = $1, rejected_at = $2, note = $3 WHERE id = $4`,
        [approverName, now, decisionNote ?? null, approvalId]
      );
    }

    // Update LPR status
    const lprUpdateData: Partial<typeof logisticPurchaseRequestsTable.$inferInsert> = {
      status: decision,
    };
    if (decision === "approved") {
      lprUpdateData.approvedBy = approverName;
      lprUpdateData.approvedAt = new Date();
    } else {
      lprUpdateData.rejectedBy = approverName;
      lprUpdateData.rejectedAt = new Date();
      lprUpdateData.rejectedReason = decisionNote ?? undefined;
    }

    await db.update(logisticPurchaseRequestsTable)
      .set(lprUpdateData)
      .where(eq(logisticPurchaseRequestsTable.id, approval.doc_id));

    // ── Feedback Loop: write purchasing_signals ──────────────────────────────
    if (lpr) {
      try {
        await db.insert(purchasingSignalsTable).values({
          companyId,
          signalType: decision === "approved" ? "approval_granted" : "approval_rejected",
          vendorId: lpr.vendorId ?? undefined,
          vendorName: lpr.vendorName ?? undefined,
          serviceCategory: lpr.serviceCategory ?? undefined,
          origin: lpr.origin ?? undefined,
          destination: lpr.destination ?? undefined,
          quotedAmount: lpr.estimatedAmount ?? undefined,
          actualAmount: lpr.estimatedAmount ?? 0,
          currency: lpr.currency ?? "IDR",
          sourceTable: "logistic_purchase_requests",
          sourceId: lpr.id,
          purchaseRequestId: lpr.id,
          logisticOrderId: lpr.logisticOrderId ?? undefined,
          recordedAt: new Date(),
        });
        logger.info({ requestId: lpr.id, decision }, "Feedback loop: purchasing_signals written");
      } catch (signalErr) {
        logger.warn({ signalErr }, "purchasing_signals write failed (non-fatal)");
      }
    }

    // ── WA Notification via Fonnte ───────────────────────────────────────────
    let waNotified = false;
    const requesterName = approval.requested_by ?? lpr?.requestedBy ?? "";
    if (requesterName) {
      try {
        const members = await db.select({ phone: teamMembersTable.phone, name: teamMembersTable.name })
          .from(teamMembersTable)
          .where(ilike(teamMembersTable.name, `%${requesterName.split(" ")[0]}%`))
          .limit(1);
        const phone = members[0]?.phone;
        if (phone) {
          const amount = lpr?.estimatedAmount?.toLocaleString("id-ID") ?? "0";
          const msg = decision === "approved"
            ? `✅ *Purchasing Request Disetujui*\n\nRequest: ${lpr?.requestNumber ?? "-"}\nVendor: ${lpr?.vendorName ?? "-"}\nJumlah: Rp ${amount}\nDisetujui oleh: ${approverName}\n${decisionNote ? `Catatan: ${decisionNote}` : ""}`
            : `❌ *Purchasing Request Ditolak*\n\nRequest: ${lpr?.requestNumber ?? "-"}\nVendor: ${lpr?.vendorName ?? "-"}\nJumlah: Rp ${amount}\nDitolak oleh: ${approverName}\n${decisionNote ? `Alasan: ${decisionNote}` : "Silakan hubungi approver untuk detail."}`;
          const waResult = await sendFonnte(phone, msg);
          waNotified = waResult.success;
          logger.info({ phone, waNotified }, "WA notification approval decision");
        }
      } catch (waErr) {
        logger.warn({ waErr }, "WA notification failed (non-fatal)");
      }
    }

    await db.insert(auditLogsTable).values({
      companyId, userId: req.user?.id, userName: req.user?.name,
      action: `approval_${decision}`,
      module: "purchasing_intelligence",
      entityId: approval.doc_id,
      entityType: "logistic_purchase_request",
      after: JSON.stringify({ decision, approvalId, approvedBy: approverName, note: decisionNote, waNotified }),
    });

    return res.json({
      success: true,
      decision,
      waNotified,
      message: `Request berhasil ${decision === "approved" ? "disetujui" : "ditolak"}${waNotified ? " dan notifikasi WA terkirim" : ""}`,
    });
  } catch (err) {
    logger.error({ err }, "POST /api/purchasing/approval-requests/:approvalId/decide failed");
    return res.status(500).json({ error: "Gagal proses keputusan approval" });
  }
});

// ── GET /api/purchasing/approval-requests ─────────────────────────────────────

router.get("/purchasing/approval-requests", requireAuth, requireRole("supervisor"), async (req: Request, res: Response) => {
  try {
    const { status = "pending" } = req.query as Record<string, string>;

    const rows = await supabaseQuery<Record<string, unknown>>(
      `SELECT * FROM approval_requests
       WHERE module = 'purchasing_logistics'
         AND ($1 = 'all' OR status = $1)
       ORDER BY requested_at DESC
       LIMIT 100`,
      [status]
    );

    // Enrich with LPR data
    const enriched = await Promise.all(rows.map(async (ar) => {
      if (!ar.doc_id) return ar;
      const [lpr] = await db.select().from(logisticPurchaseRequestsTable)
        .where(eq(logisticPurchaseRequestsTable.id, ar.doc_id as number)).limit(1);
      return { ...ar, lpr: lpr ?? null };
    }));

    return res.json({ approvalRequests: enriched, total: enriched.length });
  } catch (err) {
    logger.error({ err }, "GET /api/purchasing/approval-requests failed");
    return res.status(500).json({ error: "Gagal memuat approval requests" });
  }
});

export default router;
