/**
 * Sprint 6B — Purchase Request Intelligence
 *
 * POST /api/purchasing/requests           — create & auto-evaluate
 * GET  /api/purchasing/requests           — list with filters
 * GET  /api/purchasing/requests/:id       — detail
 * GET  /api/purchasing/requests/:id/intel — AI signals for request
 * POST /api/purchasing/requests/:id/evaluate — re-run AI evaluation
 * PATCH /api/purchasing/requests/:id/status  — update status
 * GET  /api/purchasing/duplicates         — all flagged duplicates
 * POST /api/purchasing/requests/:id/check-duplicate — manual dup check
 * POST /api/purchasing/signals/ingest     — ingest from Supabase sources
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  logisticPurchaseRequestsTable,
  purchasingIntelSignalsTable,
  purchasingSignalsTable,
  auditLogsTable,
  type InsertLogisticPurchaseRequest,
} from "@workspace/db/schema";
import { requireAuth, requireRole } from "../middleware/auth";
import { logger } from "../lib/logger";
import { eq, and, desc, sql, ilike, or } from "drizzle-orm";
import {
  evaluatePurchaseRequest,
  scoreDuplicate,
  ingestPurchasingSignals,
  type ModuleResult,
} from "../lib/purchasing-engine";

const router: IRouter = Router();

// ── Helper ─────────────────────────────────────────────────────────────────

function cid(req: Request): string { return req.user?.companyId ?? "default"; }

function generateRequestNumber(): string {
  const now = new Date();
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const seq = String(Math.floor(Math.random() * 9000) + 1000);
  return `LPR-${ymd}-${seq}`;
}

async function writeIntelSignal(params: {
  companyId: string;
  requestId: number;
  signalType: string;
  severity: "info" | "warning" | "critical";
  score: number;
  compositeRiskScore: number;
  headline: string;
  explanation: string;
  components: Array<{ name: string; score: number; weight: number; detail: string }>;
  dataSnapshot: Record<string, unknown>;
  clarificationQuestions?: string[];
}): Promise<void> {
  await db.insert(purchasingIntelSignalsTable).values({
    companyId: params.companyId,
    purchaseRequestId: params.requestId,
    signalType: params.signalType,
    severity: params.severity,
    score: params.score,
    compositeRiskScore: params.compositeRiskScore,
    headline: params.headline,
    explanation: params.explanation ?? "",
    scoringBreakdown: { components: params.components },
    dataSnapshot: params.dataSnapshot,
    clarificationQuestions: params.clarificationQuestions ?? [],
  });
}

async function runAndPersistEvaluation(
  requestId: number,
  lpr: typeof logisticPurchaseRequestsTable.$inferSelect
): Promise<ReturnType<typeof evaluatePurchaseRequest>> {
  const result = await evaluatePurchaseRequest({
    companyId: lpr.companyId,
    requestId,
    vendorId: lpr.vendorId,
    serviceCategory: lpr.serviceCategory,
    origin: lpr.origin,
    destination: lpr.destination,
    estimatedAmount: lpr.estimatedAmount ?? 0,
    currency: lpr.currency,
    logisticOrderId: lpr.logisticOrderId,
  });

  const { compositeScore, riskTier, modules, clarificationQuestions } = result;

  // Write per-module intel signals
  const signalDefs: Array<[string, ModuleResult]> = [
    ["price_benchmark", modules.priceBenchmark],
    ["duplicate_detected", modules.duplicate],
    ["supplier_risk", modules.vendorRisk],
    ["budget_impact", modules.budgetImpact],
    ["margin_impact", modules.marginImpact],
  ];

  for (const [signalType, mod] of signalDefs) {
    if (mod.score > 0 || signalType === "price_benchmark") {
      await writeIntelSignal({
        companyId: lpr.companyId,
        requestId,
        signalType,
        severity: mod.severity,
        score: mod.score,
        compositeRiskScore: compositeScore,
        headline: mod.headline,
        explanation: mod.explanation ?? "",
        components: mod.components,
        dataSnapshot: mod.data,
        clarificationQuestions: signalType === "duplicate_detected" ? clarificationQuestions : undefined,
      });
    }
  }

  // Write composite signal
  await writeIntelSignal({
    companyId: lpr.companyId,
    requestId,
    signalType: "composite",
    severity: compositeScore >= 65 ? "critical" : compositeScore >= 35 ? "warning" : "info",
    score: compositeScore,
    compositeRiskScore: compositeScore,
    headline: `Risk Tier: ${riskTier.toUpperCase()} (Score: ${compositeScore}/100)`,
    explanation: `Evaluasi komprehensif: Price(${modules.priceBenchmark.score}) + Duplicate(${modules.duplicate.score}) + VendorRisk(${modules.vendorRisk.score}) + Budget(${modules.budgetImpact.score}) + Margin(${modules.marginImpact.score})`,
    components: [
      { name: "Price Benchmark", score: modules.priceBenchmark.score, weight: 0.25, detail: modules.priceBenchmark.headline },
      { name: "Duplicate", score: modules.duplicate.score, weight: 0.25, detail: modules.duplicate.headline },
      { name: "Vendor Risk", score: modules.vendorRisk.score, weight: 0.20, detail: modules.vendorRisk.headline },
      { name: "Budget Impact", score: modules.budgetImpact.score, weight: 0.15, detail: modules.budgetImpact.headline },
      { name: "Margin Impact", score: modules.marginImpact.score, weight: 0.15, detail: modules.marginImpact.headline },
    ],
    dataSnapshot: { compositeScore, riskTier, modules: Object.fromEntries(signalDefs.map(([k, v]) => [k, { score: v.score }])) },
    clarificationQuestions,
  });

  // Patch LPR with AI results
  const duplicateMod = modules.duplicate as ModuleResult & { duplicateOfId?: number | null };
  await db.update(logisticPurchaseRequestsTable)
    .set({
      aiRiskScore: compositeScore,
      aiRiskTier: riskTier,
      aiDuplicateFlag: modules.duplicate.score >= 45,
      aiDuplicateOfId: duplicateMod.duplicateOfId ?? undefined,
      aiPriceDeviationPct: (modules.priceBenchmark.data as Record<string, number>).deviationPct ?? null,
      aiBudgetImpactPct: (modules.budgetImpact.data as Record<string, number>).utilizationPct ?? null,
      aiMarginImpactPct: (modules.marginImpact.data as Record<string, number>).projectedMarginPct
        ? (modules.marginImpact.data as Record<string, number>).projectedMarginPct * 100 : null,
      aiEvaluatedAt: new Date(),
    })
    .where(eq(logisticPurchaseRequestsTable.id, requestId));

  return result;
}

// ── POST /api/purchasing/requests ─────────────────────────────────────────────

router.post("/purchasing/requests", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const {
      vendorId, vendorName, serviceCategory, origin, destination,
      description, estimatedAmount, currency = "IDR",
      logisticOrderId, urgencyLevel = "normal", department, notes,
    } = req.body as Record<string, unknown>;

    if (!estimatedAmount || typeof estimatedAmount !== "number") {
      return res.status(400).json({ error: "estimatedAmount diperlukan (number)" });
    }

    const requestNumber = generateRequestNumber();

    const [created] = await db.insert(logisticPurchaseRequestsTable).values({
      companyId,
      requestNumber,
      requestedBy: req.user?.name ?? req.user?.email ?? "unknown",
      vendorId: vendorId as number | undefined,
      vendorName: vendorName as string | undefined,
      serviceCategory: serviceCategory as string | undefined,
      origin: origin as string | undefined,
      destination: destination as string | undefined,
      description: description as string | undefined,
      estimatedAmount: estimatedAmount as number,
      currency: currency as string,
      logisticOrderId: logisticOrderId as number | undefined,
      urgencyLevel: urgencyLevel as string,
      department: department as string | undefined,
      notes: notes as string | undefined,
      status: "pending_review",
    } satisfies InsertLogisticPurchaseRequest).returning();

    // Run AI evaluation async (don't block response)
    runAndPersistEvaluation(created.id, created).catch(err =>
      logger.error({ err, requestId: created.id }, "Background AI evaluation failed")
    );

    // Audit log
    await db.insert(auditLogsTable).values({
      companyId,
      userId: req.user?.id,
      userName: req.user?.name,
      action: "create",
      module: "purchasing_intelligence",
      entityId: created.id,
      entityType: "logistic_purchase_request",
    });

    return res.status(201).json({ success: true, request: created, message: "Purchase request dibuat. AI sedang mengevaluasi..." });
  } catch (err) {
    logger.error({ err }, "POST /api/purchasing/requests failed");
    return res.status(500).json({ error: "Gagal membuat purchase request" });
  }
});

// ── GET /api/purchasing/requests ──────────────────────────────────────────────

router.get("/purchasing/requests", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const { status, riskTier, vendorId, limit = "50", offset = "0", search } = req.query as Record<string, string>;

    const conditions = [eq(logisticPurchaseRequestsTable.companyId, companyId)];
    if (status) conditions.push(eq(logisticPurchaseRequestsTable.status, status));
    if (riskTier) conditions.push(eq(logisticPurchaseRequestsTable.aiRiskTier, riskTier));
    if (vendorId) conditions.push(eq(logisticPurchaseRequestsTable.vendorId, parseInt(vendorId)));
    if (search) conditions.push(
      or(
        ilike(logisticPurchaseRequestsTable.requestNumber, `%${search}%`),
        ilike(logisticPurchaseRequestsTable.vendorName, `%${search}%`),
        ilike(logisticPurchaseRequestsTable.description, `%${search}%`),
      )!
    );

    const rows = await db
      .select()
      .from(logisticPurchaseRequestsTable)
      .where(and(...conditions))
      .orderBy(desc(logisticPurchaseRequestsTable.createdAt))
      .limit(Math.min(parseInt(limit) || 50, 100))
      .offset(parseInt(offset) || 0);

    const [countRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(logisticPurchaseRequestsTable)
      .where(and(...conditions));

    return res.json({ requests: rows, total: countRow?.count ?? 0 });
  } catch (err) {
    logger.error({ err }, "GET /api/purchasing/requests failed");
    return res.status(500).json({ error: "Gagal memuat purchase requests" });
  }
});

// ── GET /api/purchasing/requests/:id ─────────────────────────────────────────

router.get("/purchasing/requests/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const [row] = await db
      .select()
      .from(logisticPurchaseRequestsTable)
      .where(and(
        eq(logisticPurchaseRequestsTable.id, parseInt(req.params.id as string)),
        eq(logisticPurchaseRequestsTable.companyId, cid(req)),
      ));
    if (!row) return res.status(404).json({ error: "Request tidak ditemukan" });
    return res.json({ request: row });
  } catch (err) {
    logger.error({ err }, "GET /api/purchasing/requests/:id failed");
    return res.status(500).json({ error: "Gagal memuat request" });
  }
});

// ── GET /api/purchasing/requests/:id/intel ────────────────────────────────────

router.get("/purchasing/requests/:id/intel", requireAuth, async (req: Request, res: Response) => {
  try {
    const signals = await db
      .select()
      .from(purchasingIntelSignalsTable)
      .where(eq(purchasingIntelSignalsTable.purchaseRequestId, parseInt(req.params.id as string)))
      .orderBy(desc(purchasingIntelSignalsTable.createdAt));
    return res.json({ signals });
  } catch (err) {
    logger.error({ err }, "GET /api/purchasing/requests/:id/intel failed");
    return res.status(500).json({ error: "Gagal memuat intel signals" });
  }
});

// ── POST /api/purchasing/requests/:id/evaluate ────────────────────────────────

router.post("/purchasing/requests/:id/evaluate", requireAuth, requireRole("supervisor"), async (req: Request, res: Response) => {
  try {
    const [lpr] = await db
      .select()
      .from(logisticPurchaseRequestsTable)
      .where(and(
        eq(logisticPurchaseRequestsTable.id, parseInt(req.params.id as string)),
        eq(logisticPurchaseRequestsTable.companyId, cid(req)),
      ));
    if (!lpr) return res.status(404).json({ error: "Request tidak ditemukan" });

    const result = await runAndPersistEvaluation(lpr.id, lpr);

    await db.insert(auditLogsTable).values({
      companyId: cid(req),
      userId: req.user?.id,
      userName: req.user?.name,
      action: "ai_evaluate",
      module: "purchasing_intelligence",
      entityId: lpr.id,
      entityType: "logistic_purchase_request",
      after: JSON.stringify({ riskTier: result.riskTier, compositeScore: result.compositeScore }),
    });

    return res.json({ success: true, evaluation: result });
  } catch (err) {
    logger.error({ err }, "POST /api/purchasing/requests/:id/evaluate failed");
    return res.status(500).json({ error: "Gagal menjalankan evaluasi" });
  }
});

// ── PATCH /api/purchasing/requests/:id/status ─────────────────────────────────

router.patch("/purchasing/requests/:id/status", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const { status, notes } = req.body as { status: string; notes?: string };

    const allowed = ["draft", "pending_review", "submitted_for_approval", "approved", "rejected", "cancelled"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `Status tidak valid. Pilih: ${allowed.join(", ")}` });
    }

    const [lpr] = await db
      .select()
      .from(logisticPurchaseRequestsTable)
      .where(and(
        eq(logisticPurchaseRequestsTable.id, parseInt(req.params.id as string)),
        eq(logisticPurchaseRequestsTable.companyId, companyId),
      ));
    if (!lpr) return res.status(404).json({ error: "Request tidak ditemukan" });

    const updateData: Partial<typeof logisticPurchaseRequestsTable.$inferInsert> = { status, notes: notes ?? lpr.notes };
    if (status === "approved") {
      updateData.approvedBy = req.user?.name ?? req.user?.email;
      updateData.approvedAt = new Date();
    } else if (status === "rejected") {
      updateData.rejectedBy = req.user?.name ?? req.user?.email;
      updateData.rejectedAt = new Date();
      updateData.rejectedReason = notes ?? undefined;
    }

    const [updated] = await db
      .update(logisticPurchaseRequestsTable)
      .set(updateData)
      .where(eq(logisticPurchaseRequestsTable.id, lpr.id))
      .returning();

    await db.insert(auditLogsTable).values({
      companyId,
      userId: req.user?.id,
      userName: req.user?.name,
      action: `status_${status}`,
      module: "purchasing_intelligence",
      entityId: lpr.id,
      entityType: "logistic_purchase_request",
      before: JSON.stringify({ status: lpr.status }),
      after: JSON.stringify({ status }),
    });

    return res.json({ success: true, request: updated });
  } catch (err) {
    logger.error({ err }, "PATCH /api/purchasing/requests/:id/status failed");
    return res.status(500).json({ error: "Gagal update status" });
  }
});

// ── GET /api/purchasing/duplicates ────────────────────────────────────────────

router.get("/purchasing/duplicates", requireAuth, requireRole("supervisor"), async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(logisticPurchaseRequestsTable)
      .where(and(
        eq(logisticPurchaseRequestsTable.companyId, cid(req)),
        eq(logisticPurchaseRequestsTable.aiDuplicateFlag, true),
      ))
      .orderBy(desc(logisticPurchaseRequestsTable.createdAt));
    return res.json({ duplicates: rows });
  } catch (err) {
    logger.error({ err }, "GET /api/purchasing/duplicates failed");
    return res.status(500).json({ error: "Gagal memuat duplikat" });
  }
});

// ── POST /api/purchasing/requests/:id/check-duplicate ─────────────────────────

router.post("/purchasing/requests/:id/check-duplicate", requireAuth, async (req: Request, res: Response) => {
  try {
    const [lpr] = await db
      .select()
      .from(logisticPurchaseRequestsTable)
      .where(and(
        eq(logisticPurchaseRequestsTable.id, parseInt(req.params.id as string)),
        eq(logisticPurchaseRequestsTable.companyId, cid(req)),
      ));
    if (!lpr) return res.status(404).json({ error: "Request tidak ditemukan" });

    const result = await scoreDuplicate({
      companyId: lpr.companyId,
      vendorId: lpr.vendorId,
      serviceCategory: lpr.serviceCategory,
      origin: lpr.origin,
      destination: lpr.destination,
      estimatedAmount: lpr.estimatedAmount ?? 0,
      logisticOrderId: lpr.logisticOrderId,
      excludeRequestId: lpr.id,
    });

    await db.update(logisticPurchaseRequestsTable)
      .set({ aiDuplicateFlag: result.score >= 45, aiDuplicateOfId: result.duplicateOfId ?? undefined })
      .where(eq(logisticPurchaseRequestsTable.id, lpr.id));

    return res.json({ result });
  } catch (err) {
    logger.error({ err }, "POST /api/purchasing/requests/:id/check-duplicate failed");
    return res.status(500).json({ error: "Gagal check duplikat" });
  }
});

// ── POST /api/purchasing/signals/ingest ───────────────────────────────────────

router.post("/purchasing/signals/ingest", requireAuth, requireRole("company_admin"), async (req: Request, res: Response) => {
  try {
    const result = await ingestPurchasingSignals(cid(req));

    await db.insert(auditLogsTable).values({
      companyId: cid(req),
      userId: req.user?.id,
      userName: req.user?.name,
      action: "signals_ingest",
      module: "purchasing_intelligence",
      after: JSON.stringify(result),
    });

    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error({ err }, "POST /api/purchasing/signals/ingest failed");
    return res.status(500).json({ error: "Gagal ingest signals" });
  }
});

// ── GET /api/purchasing/signals ───────────────────────────────────────────────

router.get("/purchasing/signals", requireAuth, requireRole("supervisor"), async (req: Request, res: Response) => {
  try {
    const { limit = "100" } = req.query as Record<string, string>;
    const rows = await db
      .select()
      .from(purchasingSignalsTable)
      .where(eq(purchasingSignalsTable.companyId, cid(req)))
      .orderBy(desc(purchasingSignalsTable.recordedAt))
      .limit(Math.min(parseInt(limit), 200));
    return res.json({ signals: rows, total: rows.length });
  } catch (err) {
    logger.error({ err }, "GET /api/purchasing/signals failed");
    return res.status(500).json({ error: "Gagal memuat signals" });
  }
});

export default router;
