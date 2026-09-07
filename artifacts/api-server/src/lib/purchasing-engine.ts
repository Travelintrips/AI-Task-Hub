/**
 * Sprint 6B — Purchasing Intelligence Engine
 *
 * Pure scoring functions — no DB side effects.
 * Each function returns a score (0–100) + breakdown for audit trail.
 * Higher score = higher risk.
 */

import { supabaseQuery } from "./supabase-db";
import { db } from "@workspace/db";
import {
  purchasingPriceBenchmarksTable,
  purchasingSignalsTable,
  logisticPurchaseRequestsTable,
  purchasingBudgetTrackerTable,
  vendorContractRatesTable,
} from "@workspace/db/schema";
import { and, eq, gte, lte, desc, sql } from "drizzle-orm";
import { logger } from "./logger";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ScoreComponent {
  name: string;
  score: number;
  weight: number;
  detail: string;
}

export interface ModuleResult {
  score: number;
  severity: "info" | "warning" | "critical";
  headline: string;
  explanation: string;
  components: ScoreComponent[];
  data: Record<string, unknown>;
}

export interface CompositeRiskResult {
  compositeScore: number;
  riskTier: "low" | "medium" | "high" | "critical";
  modules: {
    priceBenchmark: ModuleResult;
    duplicate: ModuleResult;
    vendorRisk: ModuleResult;
    budgetImpact: ModuleResult;
    marginImpact: ModuleResult;
  };
  clarificationQuestions: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toSeverity(score: number): "info" | "warning" | "critical" {
  if (score >= 65) return "critical";
  if (score >= 35) return "warning";
  return "info";
}

function riskTier(score: number): "low" | "medium" | "high" | "critical" {
  if (score >= 81) return "critical";
  if (score >= 61) return "high";
  if (score >= 31) return "medium";
  return "low";
}

// ── Module 1: Price Benchmark Score ───────────────────────────────────────────

export async function scorePriceBenchmark(params: {
  companyId: string;
  vendorId: number | null | undefined;
  serviceCategory: string | null | undefined;
  origin: string | null | undefined;
  destination: string | null | undefined;
  proposedAmount: number;
  currency: string;
}): Promise<ModuleResult> {
  const { companyId, vendorId, serviceCategory, origin, destination, proposedAmount } = params;

  // 1. Check vendor contract rate first (overrides benchmark)
  if (vendorId && serviceCategory) {
    const today = new Date().toISOString().split("T")[0];
    const contractRates = await db
      .select()
      .from(vendorContractRatesTable)
      .where(
        and(
          eq(vendorContractRatesTable.companyId, companyId),
          eq(vendorContractRatesTable.vendorId, vendorId),
          eq(vendorContractRatesTable.serviceCategory, serviceCategory),
          eq(vendorContractRatesTable.isActive, true),
          lte(vendorContractRatesTable.validFrom, today),
        )
      )
      .limit(1);

    const activeContract = contractRates.find(
      r => !r.validUntil || r.validUntil >= today
    );

    if (activeContract) {
      const devPct = ((proposedAmount - activeContract.contractedRate) / activeContract.contractedRate) * 100;
      const score = devPct > 10 ? Math.min(90, Math.round(devPct * 1.5)) : 0;
      return {
        score,
        severity: toSeverity(score),
        headline: score > 0
          ? `Harga ${devPct.toFixed(1)}% di atas contract rate`
          : `Harga sesuai contract rate (${activeContract.contractReference ?? "aktif"})`,
        explanation: `Contract rate yang berlaku: ${activeContract.contractedRate.toLocaleString("id-ID")} ${activeContract.currency}. ${score > 0 ? `Proposal ini ${devPct.toFixed(1)}% di atas contract rate yang telah disepakati.` : "Proposal sesuai dengan rate kontrak."}`,
        components: [{ name: "Contract Rate Deviation", score, weight: 1, detail: `Dev: ${devPct.toFixed(1)}%` }],
        data: { contractRate: activeContract.contractedRate, proposedAmount, deviationPct: devPct, source: "contract" },
      };
    }
  }

  // 2. Market benchmark from materialized table
  const conditions = [
    eq(purchasingPriceBenchmarksTable.companyId, companyId),
  ];
  if (serviceCategory) conditions.push(eq(purchasingPriceBenchmarksTable.serviceCategory, serviceCategory));
  if (vendorId) conditions.push(eq(purchasingPriceBenchmarksTable.vendorId, vendorId));
  if (origin) conditions.push(eq(purchasingPriceBenchmarksTable.origin, origin));
  if (destination) conditions.push(eq(purchasingPriceBenchmarksTable.destination, destination));

  const benchmarks = await db
    .select()
    .from(purchasingPriceBenchmarksTable)
    .where(and(...conditions))
    .orderBy(desc(purchasingPriceBenchmarksTable.sampleCount))
    .limit(1);

  // Fallback: try category-wide benchmark (no vendor/route filter)
  let benchmark = benchmarks[0];
  if (!benchmark && serviceCategory) {
    const wider = await db
      .select()
      .from(purchasingPriceBenchmarksTable)
      .where(and(
        eq(purchasingPriceBenchmarksTable.companyId, companyId),
        eq(purchasingPriceBenchmarksTable.serviceCategory, serviceCategory),
      ))
      .orderBy(desc(purchasingPriceBenchmarksTable.sampleCount))
      .limit(1);
    benchmark = wider[0];
  }

  if (!benchmark || !benchmark.medianPrice || benchmark.sampleCount < 2) {
    return {
      score: 0,
      severity: "info",
      headline: "Data benchmark tidak cukup",
      explanation: "Belum ada data historis yang cukup untuk membandingkan harga ini. Akan diperbarui setelah lebih banyak transaksi tercatat.",
      components: [{ name: "Benchmark Availability", score: 0, weight: 1, detail: "Insufficient data" }],
      data: { proposedAmount, benchmarkConfidence: "insufficient", sampleCount: benchmark?.sampleCount ?? 0 },
    };
  }

  const median = benchmark.medianPrice;
  const devPct = ((proposedAmount - median) / median) * 100;

  // Score formula
  let score = 0;
  let tier = "within_range";
  if (devPct > 50) { score = 90; tier = "far_above"; }
  else if (devPct > 25) { score = 60; tier = "above"; }
  else if (devPct > 10) { score = 30; tier = "slightly_above"; }
  else if (devPct < -15) { score = 15; tier = "below_market"; } // too cheap = quality risk
  else { score = 0; tier = "normal"; }

  // Confidence modifier
  const confidenceMultiplier = benchmark.benchmarkConfidence === "high" ? 1.0
    : benchmark.benchmarkConfidence === "medium" ? 0.85
    : 0.6;
  score = Math.round(score * confidenceMultiplier);

  return {
    score,
    severity: toSeverity(score),
    headline: devPct > 10
      ? `Harga ${devPct.toFixed(1)}% di atas median pasar`
      : devPct < -15
      ? `Harga ${Math.abs(devPct).toFixed(1)}% di bawah pasar — verifikasi kualitas`
      : "Harga dalam batas normal",
    explanation: `Median historis untuk ${serviceCategory ?? "layanan ini"}: ${median.toLocaleString("id-ID")} IDR (${benchmark.sampleCount} sampel, confidence: ${benchmark.benchmarkConfidence}). Proposal: ${proposedAmount.toLocaleString("id-ID")} IDR.`,
    components: [
      { name: "Price Deviation", score: Math.round(score / confidenceMultiplier), weight: 0.8, detail: `Dev: ${devPct.toFixed(1)}%` },
      { name: "Data Confidence", score: Math.round((1 - confidenceMultiplier) * 100), weight: 0.2, detail: benchmark.benchmarkConfidence },
    ],
    data: {
      proposedAmount, median, p10: benchmark.p10Price, p90: benchmark.p90Price,
      deviationPct: devPct, sampleCount: benchmark.sampleCount,
      benchmarkConfidence: benchmark.benchmarkConfidence, priceTrend: benchmark.priceTrend,
      source: "market_benchmark", tier,
    },
  };
}

// ── Module 2: Duplicate Detection Score ───────────────────────────────────────

export async function scoreDuplicate(params: {
  companyId: string;
  vendorId: number | null | undefined;
  serviceCategory: string | null | undefined;
  origin: string | null | undefined;
  destination: string | null | undefined;
  estimatedAmount: number;
  logisticOrderId: number | null | undefined;
  excludeRequestId?: number;
}): Promise<ModuleResult & { duplicateOfId: number | null }> {
  const { companyId, vendorId, serviceCategory, origin, destination, estimatedAmount, logisticOrderId, excludeRequestId } = params;

  // 1. Check existing LPRs
  const recentCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const existingRequests = await db
    .select()
    .from(logisticPurchaseRequestsTable)
    .where(
      and(
        eq(logisticPurchaseRequestsTable.companyId, companyId),
        gte(logisticPurchaseRequestsTable.createdAt, recentCutoff),
      )
    )
    .limit(200);

  const candidates = existingRequests.filter(r => excludeRequestId ? r.id !== excludeRequestId : true);

  // 2. Similarity scoring
  let bestMatch: { id: number; similarity: number; reason: string[] } | null = null;

  for (const req of candidates) {
    let similarity = 0;
    const reasons: string[] = [];

    if (vendorId && req.vendorId === vendorId) { similarity += 40; reasons.push("vendor sama"); }
    if (serviceCategory && req.serviceCategory === serviceCategory) { similarity += 20; reasons.push("kategori sama"); }
    if (req.estimatedAmount && Math.abs((estimatedAmount - req.estimatedAmount) / req.estimatedAmount) <= 0.15) {
      similarity += 25; reasons.push("jumlah dalam ±15%");
    }
    if (origin && req.origin === origin) { similarity += 8; reasons.push("origin sama"); }
    if (destination && req.destination === destination) { similarity += 8; reasons.push("destination sama"); }
    if (logisticOrderId && req.logisticOrderId === logisticOrderId) {
      similarity += 20; reasons.push("order yang sama");
    }

    if (similarity > (bestMatch?.similarity ?? 0)) {
      bestMatch = { id: req.id, similarity, reason: reasons };
    }
  }

  // 3. Check Supabase vendor_invoices for existing invoices
  if (vendorId) {
    const invoices = await supabaseQuery<{ id: number; grand_total: number; status: string }>(
      `SELECT id, grand_total, status FROM vendor_invoices
       WHERE supplier_id = $1 AND status NOT IN ('cancelled')
         AND created_at > NOW() - INTERVAL '90 days'
       LIMIT 50`,
      [vendorId]
    );
    for (const inv of invoices) {
      if (inv.grand_total && Math.abs((estimatedAmount - inv.grand_total) / inv.grand_total) <= 0.15) {
        const s = inv.status === "paid" ? 40 : 55;
        if (s > (bestMatch?.similarity ?? 0)) {
          bestMatch = { id: -inv.id, similarity: s, reason: [`invoice Supabase (#${inv.id}) jumlah serupa`] };
        }
      }
    }
  }

  if (!bestMatch || bestMatch.similarity < 60) {
    return {
      score: 0, severity: "info", duplicateOfId: null,
      headline: "Tidak ada duplikat terdeteksi",
      explanation: "Tidak ditemukan request atau invoice serupa dalam 90 hari terakhir.",
      components: [{ name: "Similarity Check", score: 0, weight: 1, detail: "No match ≥60%" }],
      data: { candidatesChecked: candidates.length, bestSimilarity: bestMatch?.similarity ?? 0 },
    };
  }

  const sim = bestMatch.similarity;
  const score = sim >= 80 ? 90 : sim >= 70 ? 70 : 45;
  const isPaidInvoice = bestMatch.id < 0;

  return {
    score, severity: toSeverity(score),
    duplicateOfId: bestMatch.id > 0 ? bestMatch.id : null,
    headline: isPaidInvoice
      ? `Kemungkinan duplikat — invoice serupa sudah dibayar`
      : `Kemungkinan duplikat — similarity ${sim}%`,
    explanation: `Ditemukan ${isPaidInvoice ? "invoice" : "purchase request"} serupa: ${bestMatch.reason.join(", ")}. Skor kemiripan: ${sim}%. Harap konfirmasi ini bukan pembayaran ganda.`,
    components: [{ name: "Similarity Score", score, weight: 1, detail: `${sim}% - ${bestMatch.reason.join(", ")}` }],
    data: { similarity: sim, matchId: bestMatch.id, matchReasons: bestMatch.reason, isPaidInvoice },
  };
}

// ── Module 3: Vendor Risk Score ────────────────────────────────────────────────

export async function scoreVendorRisk(params: {
  companyId: string;
  vendorId: number | null | undefined;
}): Promise<ModuleResult> {
  if (!params.vendorId) {
    return {
      score: 20, severity: "info",
      headline: "Vendor belum dipilih",
      explanation: "Tidak ada vendor yang dipilih. Harap pilih vendor untuk evaluasi risiko.",
      components: [{ name: "Vendor Selection", score: 20, weight: 1, detail: "No vendor" }],
      data: {},
    };
  }

  const [riskRow] = await supabaseQuery<{
    risk_score: number; tier: string; is_active: boolean;
  }>(
    `SELECT risk_score, tier, is_active FROM vendor_risk_assessments
     WHERE vendor_id = $1 AND is_active = true ORDER BY assessed_at DESC LIMIT 1`,
    [params.vendorId]
  );

  if (!riskRow) {
    return {
      score: 25, severity: "info",
      headline: "Tidak ada risk assessment untuk vendor ini",
      explanation: "Vendor belum dinilai risikonya. Disarankan melakukan assessment sebelum order besar.",
      components: [{ name: "Risk Assessment", score: 25, weight: 1, detail: "No assessment found" }],
      data: { vendorId: params.vendorId },
    };
  }

  const tierScore: Record<string, number> = { low: 10, medium: 35, high: 70, blacklisted: 100 };
  const score = tierScore[riskRow.tier] ?? 30;

  return {
    score, severity: toSeverity(score),
    headline: `Vendor risk: ${riskRow.tier.toUpperCase()} (score: ${riskRow.risk_score}/100)`,
    explanation: `Vendor memiliki risk tier ${riskRow.tier}. ${riskRow.tier === "high" ? "Pertimbangkan vendor alternatif." : riskRow.tier === "blacklisted" ? "Vendor ini di-blacklist. Jangan lanjutkan tanpa persetujuan khusus." : "Risiko dalam batas yang dapat diterima."}`,
    components: [{ name: "Vendor Risk Tier", score, weight: 1, detail: `${riskRow.tier} — raw score ${riskRow.risk_score}` }],
    data: { vendorId: params.vendorId, riskScore: riskRow.risk_score, riskTier: riskRow.tier },
  };
}

// ── Module 4: Budget Impact Score ─────────────────────────────────────────────

export async function scoreBudgetImpact(params: {
  companyId: string;
  serviceCategory: string | null | undefined;
  estimatedAmount: number;
  periodYear: number;
  periodMonth: number;
  excludeRequestId?: number;
}): Promise<ModuleResult & { willExceed: boolean; budgetData: Record<string, number> }> {
  const { companyId, serviceCategory, estimatedAmount, periodYear, periodMonth } = params;

  if (!serviceCategory) {
    return {
      score: 0, severity: "info", willExceed: false,
      headline: "Kategori belum dipilih — budget tidak dapat dievaluasi",
      explanation: "Pilih kategori layanan untuk melihat dampak budget.",
      components: [], data: {}, budgetData: {},
    };
  }

  const tracker = await db
    .select()
    .from(purchasingBudgetTrackerTable)
    .where(and(
      eq(purchasingBudgetTrackerTable.companyId, companyId),
      eq(purchasingBudgetTrackerTable.serviceCategory, serviceCategory),
      eq(purchasingBudgetTrackerTable.periodYear, periodYear),
      eq(purchasingBudgetTrackerTable.periodMonth, periodMonth),
    ))
    .limit(1);

  const t = tracker[0];
  if (!t || t.budgetAllocated === 0) {
    return {
      score: 0, severity: "info", willExceed: false,
      headline: "Tidak ada data budget untuk kategori ini",
      explanation: `Tidak ada alokasi budget untuk ${serviceCategory} periode ${periodMonth}/${periodYear}.`,
      components: [], data: { serviceCategory, periodYear, periodMonth }, budgetData: {},
    };
  }

  const projectedUsed = t.budgetUsed + t.budgetPending + estimatedAmount;
  const utilization = projectedUsed / t.budgetAllocated;
  const willExceed = utilization > 1.0;

  let score = 0;
  if (utilization > 1.0) score = 85;
  else if (utilization > 0.95) score = 60;
  else if (utilization > 0.85) score = 30;

  const budgetData = {
    allocated: t.budgetAllocated,
    used: t.budgetUsed,
    pending: t.budgetPending,
    thisRequest: estimatedAmount,
    projectedUsed,
    remaining: t.budgetAllocated - projectedUsed,
    utilizationPct: Math.round(utilization * 100),
  };

  return {
    score, severity: toSeverity(score), willExceed,
    headline: willExceed
      ? `Budget akan MELEBIHI alokasi (+${((utilization - 1) * 100).toFixed(1)}%)`
      : `Utilisasi budget akan menjadi ${(utilization * 100).toFixed(1)}%`,
    explanation: `Budget ${serviceCategory} ${periodMonth}/${periodYear}: dialokasikan ${t.budgetAllocated.toLocaleString("id-ID")}, terpakai ${t.budgetUsed.toLocaleString("id-ID")}, pending ${t.budgetPending.toLocaleString("id-ID")}, request ini ${estimatedAmount.toLocaleString("id-ID")}.`,
    components: [{ name: "Budget Utilization", score, weight: 1, detail: `${(utilization * 100).toFixed(1)}% setelah request ini` }],
    data: budgetData, budgetData,
  };
}

// ── Module 5: Margin Impact Score ─────────────────────────────────────────────

export async function scoreMarginImpact(params: {
  companyId: string;
  serviceCategory: string | null | undefined;
  vendorId: number | null | undefined;
  estimatedAmount: number;
  logisticOrderId: number | null | undefined;
}): Promise<ModuleResult & { belowFloor: boolean }> {
  const { companyId, serviceCategory, logisticOrderId, estimatedAmount } = params;
  const MARGIN_FLOOR = 0.15; // 15% default floor

  // Try to get quoted revenue from logistic_orders
  let revenueAmount = 0;
  if (logisticOrderId) {
    const [order] = await supabaseQuery<{ grand_total: number; subtotal: number }>(
      `SELECT grand_total, subtotal FROM logistic_orders WHERE id = $1 LIMIT 1`,
      [logisticOrderId]
    );
    revenueAmount = order?.grand_total ?? order?.subtotal ?? 0;
  }

  if (!revenueAmount || revenueAmount === 0) {
    return {
      score: 0, severity: "info", belowFloor: false,
      headline: "Data revenue tidak tersedia untuk analisis margin",
      explanation: "Hubungkan request ini ke logistic order untuk mendapatkan analisis margin otomatis.",
      components: [], data: {},
    };
  }

  const projectedMargin = (revenueAmount - estimatedAmount) / revenueAmount;

  // Get benchmark from intel_profit
  const benchmarkRows = await db.execute(
    sql`SELECT avg_margin_pct FROM intel_profit
        WHERE company_id = ${companyId}
          AND dimension = 'by_category'
          AND dimension_value = ${serviceCategory ?? ""}
        ORDER BY period_start DESC LIMIT 1`
  );
  const benchmarkMargin = (benchmarkRows.rows[0] as { avg_margin_pct: number } | undefined)?.avg_margin_pct ?? null;

  const belowFloor = projectedMargin < MARGIN_FLOOR;
  let score = 0;
  if (projectedMargin <= 0) score = 100;
  else if (projectedMargin < MARGIN_FLOOR) score = 80;
  else if (benchmarkMargin && projectedMargin < benchmarkMargin * 0.9) score = 45;
  else if (benchmarkMargin && projectedMargin < benchmarkMargin) score = 15;

  return {
    score, severity: toSeverity(score), belowFloor,
    headline: belowFloor
      ? `Margin proyeksi ${(projectedMargin * 100).toFixed(1)}% — DI BAWAH floor ${(MARGIN_FLOOR * 100).toFixed(0)}%`
      : `Margin proyeksi ${(projectedMargin * 100).toFixed(1)}%`,
    explanation: `Revenue: ${revenueAmount.toLocaleString("id-ID")} | Biaya: ${estimatedAmount.toLocaleString("id-ID")} | Margin: ${(projectedMargin * 100).toFixed(1)}%${benchmarkMargin ? ` | Benchmark: ${(benchmarkMargin * 100).toFixed(1)}%` : ""}.`,
    components: [
      { name: "Projected Margin", score, weight: 0.7, detail: `${(projectedMargin * 100).toFixed(1)}% vs floor ${(MARGIN_FLOOR * 100).toFixed(0)}%` },
      { name: "Benchmark Gap", score: benchmarkMargin ? Math.max(0, Math.round((benchmarkMargin - projectedMargin) * 200)) : 0, weight: 0.3, detail: benchmarkMargin ? `Benchmark: ${(benchmarkMargin * 100).toFixed(1)}%` : "N/A" },
    ],
    data: { revenueAmount, estimatedAmount, projectedMarginPct: projectedMargin, benchmarkMarginPct: benchmarkMargin, marginFloor: MARGIN_FLOOR },
  };
}

// ── Composite Scoring ─────────────────────────────────────────────────────────

export function computeCompositeScore(modules: {
  priceBenchmark: ModuleResult;
  duplicate: ModuleResult;
  vendorRisk: ModuleResult;
  budgetImpact: ModuleResult;
  marginImpact: ModuleResult;
}): { compositeScore: number; riskTier: "low" | "medium" | "high" | "critical" } {
  const weights = { priceBenchmark: 0.25, duplicate: 0.25, vendorRisk: 0.20, budgetImpact: 0.15, marginImpact: 0.15 };
  const compositeScore = Math.round(
    modules.priceBenchmark.score * weights.priceBenchmark +
    modules.duplicate.score * weights.duplicate +
    modules.vendorRisk.score * weights.vendorRisk +
    modules.budgetImpact.score * weights.budgetImpact +
    modules.marginImpact.score * weights.marginImpact
  );
  return { compositeScore, riskTier: riskTier(compositeScore) };
}

// ── Clarification Questions Generator ─────────────────────────────────────────

export function generateClarificationQuestions(params: {
  priceBenchmark: ModuleResult;
  duplicate: ModuleResult;
  budgetImpact: ModuleResult & { willExceed: boolean };
  marginImpact: ModuleResult & { belowFloor: boolean };
  vendorRisk: ModuleResult;
}): string[] {
  const questions: string[] = [];

  const priceData = params.priceBenchmark.data as Record<string, unknown>;
  if ((priceData.deviationPct as number) > 25) {
    questions.push(`Harga proposal ${(priceData.deviationPct as number).toFixed(1)}% di atas median pasar. Mohon jelaskan alasan perbedaan harga ini.`);
  }
  if (params.duplicate.score >= 45) {
    questions.push("Terdeteksi request atau invoice serupa dalam 90 hari terakhir. Konfirmasi bahwa ini bukan pembayaran ganda.");
  }
  if (params.budgetImpact.willExceed) {
    questions.push("Approval ini akan melebihi alokasi budget bulan ini. Apakah ada realokasi budget atau justifikasi khusus?");
  }
  if (params.marginImpact.belowFloor) {
    questions.push("Margin proyeksi di bawah batas minimum perusahaan. Bagaimana revenue akan dikompensasi?");
  }
  const vendorData = params.vendorRisk.data as Record<string, unknown>;
  if ((vendorData.riskTier as string) === "high") {
    questions.push("Vendor ini memiliki risk tier HIGH. Apakah ada vendor alternatif yang dapat dipertimbangkan?");
  }
  if ((vendorData.riskTier as string) === "blacklisted") {
    questions.push("PERINGATAN: Vendor ini di-blacklist. Diperlukan persetujuan khusus dari direktur untuk melanjutkan.");
  }

  return questions;
}

// ── Full Evaluation ───────────────────────────────────────────────────────────

export async function evaluatePurchaseRequest(params: {
  companyId: string;
  requestId: number;
  vendorId: number | null | undefined;
  serviceCategory: string | null | undefined;
  origin: string | null | undefined;
  destination: string | null | undefined;
  estimatedAmount: number;
  currency: string;
  logisticOrderId: number | null | undefined;
}): Promise<CompositeRiskResult> {
  const now = new Date();
  const periodYear = now.getFullYear();
  const periodMonth = now.getMonth() + 1;

  const [priceBenchmark, duplicate, vendorRisk, budgetImpactRaw, marginImpactRaw] = await Promise.all([
    scorePriceBenchmark({ ...params, proposedAmount: params.estimatedAmount }),
    scoreDuplicate({ ...params, excludeRequestId: params.requestId }),
    scoreVendorRisk(params),
    scoreBudgetImpact({ ...params, periodYear, periodMonth, excludeRequestId: params.requestId }),
    scoreMarginImpact(params),
  ]);

  const budgetImpact = budgetImpactRaw as ModuleResult & { willExceed: boolean; budgetData: Record<string, number> };
  const marginImpact = marginImpactRaw as ModuleResult & { belowFloor: boolean };

  const { compositeScore, riskTier: tier } = computeCompositeScore({ priceBenchmark, duplicate, vendorRisk, budgetImpact, marginImpact });

  const clarificationQuestions = generateClarificationQuestions({
    priceBenchmark, duplicate, budgetImpact, marginImpact, vendorRisk,
  });

  return {
    compositeScore,
    riskTier: tier,
    modules: { priceBenchmark, duplicate, vendorRisk, budgetImpact, marginImpact },
    clarificationQuestions,
  };
}

// ── Benchmark Refresh ─────────────────────────────────────────────────────────

export async function refreshPriceBenchmarks(companyId: string): Promise<{ refreshed: number; errors: number }> {
  let refreshed = 0;
  let errors = 0;

  try {
    // Pull purchasing_signals from last 90 days
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const signals = await db
      .select()
      .from(purchasingSignalsTable)
      .where(and(
        eq(purchasingSignalsTable.companyId, companyId),
        gte(purchasingSignalsTable.recordedAt, cutoff),
      ));

    // Group by (vendorId, serviceCategory, origin, destination)
    type DimKey = string;
    const groups = new Map<DimKey, number[]>();

    for (const s of signals) {
      if (!s.actualAmount || s.actualAmount <= 0) continue;
      const key = JSON.stringify([s.vendorId ?? null, s.serviceCategory ?? "", s.origin ?? "", s.destination ?? ""]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(s.actualAmount);
    }

    // Also pull Supabase sources
    const supabaseSignals = await supabaseQuery<{
      vendor_id: number; actual_amount: number; service_category: string; origin: string; destination: string;
    }>(
      `SELECT
         vf.vendor_id,
         (vf.price_snapshot->>'total_cost')::numeric AS actual_amount,
         lo.shipment_type AS service_category,
         lo.origin,
         lo.destination
       FROM logistic_vendor_fulfillments vf
       JOIN logistic_orders lo ON lo.id = vf.order_id
       WHERE lo.created_at > NOW() - INTERVAL '90 days'
         AND vf.price_snapshot->>'total_cost' IS NOT NULL
         AND vf.price_snapshot->>'total_cost' != '0'
       LIMIT 1000`
    );

    for (const s of supabaseSignals) {
      if (!s.actual_amount || s.actual_amount <= 0) continue;
      const key = JSON.stringify([s.vendor_id ?? null, s.service_category ?? "", s.origin ?? "", s.destination ?? ""]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(s.actual_amount);
    }

    const today = new Date().toISOString().split("T")[0];
    const periodStart = cutoff.toISOString().split("T")[0];

    for (const [keyStr, amounts] of groups) {
      const [vendorId, serviceCategory, origin, destination] = JSON.parse(keyStr) as [number | null, string, string, string];
      if (!serviceCategory || amounts.length < 1) continue;

      const sorted = [...amounts].sort((a, b) => a - b);
      const n = sorted.length;
      const pct = (p: number) => sorted[Math.max(0, Math.floor((p / 100) * n) - 1)] ?? sorted[0];
      const avg = sorted.reduce((a, b) => a + b, 0) / n;
      const median = pct(50);
      const stdDev = n > 1 ? Math.sqrt(sorted.map(v => (v - avg) ** 2).reduce((a, b) => a + b, 0) / n) : 0;
      const volatilityPct = median > 0 ? (stdDev / median) * 100 : 0;
      const confidence = n >= 10 ? "high" : n >= 5 ? "medium" : n >= 2 ? "low" : "insufficient";

      // Check contract rate
      const contractRates = vendorId ? await db.select().from(vendorContractRatesTable).where(and(
        eq(vendorContractRatesTable.companyId, companyId),
        eq(vendorContractRatesTable.vendorId, vendorId),
        eq(vendorContractRatesTable.serviceCategory, serviceCategory),
        eq(vendorContractRatesTable.isActive, true),
      )).limit(1) : [];
      const contract = contractRates[0];

      const record = {
        companyId, vendorId: vendorId ?? undefined, serviceCategory,
        origin: origin || undefined, destination: destination || undefined,
        currency: "IDR",
        p10Price: pct(10), p25Price: pct(25), medianPrice: median,
        p75Price: pct(75), p90Price: pct(90),
        avgPrice: avg, minPrice: sorted[0], maxPrice: sorted[n - 1],
        sampleCount: n, priceVolatilityPct: volatilityPct,
        priceTrend: volatilityPct > 20 ? "rising" : "stable" as "rising" | "stable",
        contractRateAvailable: !!contract,
        contractRate: contract?.contractedRate ?? undefined,
        contractRateValidUntil: contract?.validUntil ?? undefined,
        benchmarkConfidence: confidence,
        periodDays: 90, periodStart, periodEnd: today,
        refreshedAt: new Date(), isStale: false,
      };

      // Upsert
      await db.insert(purchasingPriceBenchmarksTable).values(record)
        .onConflictDoNothing();
      refreshed++;
    }
  } catch (err) {
    logger.error({ err }, "refreshPriceBenchmarks failed");
    errors++;
  }

  logger.info({ companyId, refreshed, errors }, "Price benchmarks refreshed");
  return { refreshed, errors };
}

// ── Budget Tracker Refresh ────────────────────────────────────────────────────

export async function refreshBudgetTracker(companyId: string, year: number, month: number): Promise<void> {
  // Pull expense_budgets from Supabase
  const budgets = await supabaseQuery<{
    id: number; budget_amount: number; category_id: number; department: string;
  }>(
    `SELECT eb.id, eb.budget_amount, eb.category_id, eb.department
     FROM expense_budgets eb
     WHERE eb.year = $1 AND eb.month = $2 LIMIT 100`,
    [year, month]
  );

  // Pull actuals from Supabase expenses
  const actuals = await supabaseQuery<{ expense_type: string; total_spent: number }>(
    `SELECT expense_type, SUM(total) AS total_spent
     FROM expenses
     WHERE EXTRACT(YEAR FROM created_at) = $1
       AND EXTRACT(MONTH FROM created_at) = $2
       AND status NOT IN ('cancelled','rejected')
     GROUP BY expense_type`,
    [year, month]
  );
  const actualMap = new Map(actuals.map(a => [a.expense_type, a.total_spent]));

  // Pull pending LPRs
  const pendingLPRs = await db
    .select()
    .from(logisticPurchaseRequestsTable)
    .where(and(
      eq(logisticPurchaseRequestsTable.companyId, companyId),
      eq(logisticPurchaseRequestsTable.status, "pending_review"),
    ));

  const pendingByCategory = new Map<string, number>();
  for (const lpr of pendingLPRs) {
    if (!lpr.serviceCategory || !lpr.estimatedAmount) continue;
    pendingByCategory.set(lpr.serviceCategory, (pendingByCategory.get(lpr.serviceCategory) ?? 0) + lpr.estimatedAmount);
  }

  for (const budget of budgets) {
    const serviceCategory = `budget_cat_${budget.category_id}`;
    const used = actualMap.get(serviceCategory) ?? 0;
    const pending = pendingByCategory.get(serviceCategory) ?? 0;
    const remaining = budget.budget_amount - used - pending;

    await db.insert(purchasingBudgetTrackerTable).values({
      companyId, periodYear: year, periodMonth: month,
      serviceCategory, department: budget.department,
      budgetAllocated: budget.budget_amount,
      budgetUsed: used, budgetPending: pending,
      budgetRemaining: remaining,
      utilizationPct: budget.budget_amount > 0 ? ((used + pending) / budget.budget_amount) * 100 : 0,
      currency: "IDR", supabaseBudgetId: budget.id,
      refreshedAt: new Date(),
    }).onConflictDoNothing();
  }
}

// ── Signal Ingestion ──────────────────────────────────────────────────────────

export async function ingestPurchasingSignals(companyId: string): Promise<{ ingested: number }> {
  let ingested = 0;

  // Already-ingested source IDs
  const existing = await db
    .select({ sourceTable: purchasingSignalsTable.sourceTable, sourceId: purchasingSignalsTable.sourceId })
    .from(purchasingSignalsTable)
    .where(eq(purchasingSignalsTable.companyId, companyId));
  const existingSet = new Set(existing.map(r => `${r.sourceTable}:${r.sourceId}`));

  const skip = (table: string, id: number) => existingSet.has(`${table}:${id}`);

  // 1. vendor_invoices (paid)
  const invoices = await supabaseQuery<{
    id: number; supplier_id: number; supplier_name: string; grand_total: number;
    invoice_date: string; po_id: number | null;
  }>(
    `SELECT vi.id, vi.supplier_id, vi.supplier_name, vi.grand_total, vi.invoice_date, vi.po_id
     FROM vendor_invoices vi
     WHERE vi.status = 'paid' AND vi.grand_total > 0
     LIMIT 200`
  );

  for (const inv of invoices) {
    if (skip("vendor_invoices", inv.id)) continue;
    // Try to get logistic context via po → purchase_documents → logistic_orders
    let serviceCategory: string | null = null;
    let origin: string | null = null;
    let destination: string | null = null;
    let logisticOrderId: number | null = null;
    if (inv.po_id) {
      const [pd] = await supabaseQuery<{ logistic_order_id: number }>(
        `SELECT logistic_order_id FROM purchase_documents WHERE id = $1 LIMIT 1`, [inv.po_id]
      );
      if (pd?.logistic_order_id) {
        const [lo] = await supabaseQuery<{ shipment_type: string; origin: string; destination: string }>(
          `SELECT shipment_type, origin, destination FROM logistic_orders WHERE id = $1 LIMIT 1`,
          [pd.logistic_order_id]
        );
        serviceCategory = lo?.shipment_type ?? null;
        origin = lo?.origin ?? null;
        destination = lo?.destination ?? null;
        logisticOrderId = pd.logistic_order_id;
      }
    }
    await db.insert(purchasingSignalsTable).values({
      companyId, signalType: "invoice_paid",
      vendorId: inv.supplier_id, vendorName: inv.supplier_name,
      serviceCategory, origin, destination,
      actualAmount: inv.grand_total, currency: "IDR",
      sourceTable: "vendor_invoices", sourceId: inv.id,
      logisticOrderId,
      recordedAt: new Date(inv.invoice_date),
    }).onConflictDoNothing();
    ingested++;
  }

  // 2. expenses with logistic_order_id
  const expenses = await supabaseQuery<{
    id: number; vendor_id: number; total: number; logistic_order_id: number;
    created_at: string; expense_type: string;
  }>(
    `SELECT e.id, e.vendor_id, e.total, e.logistic_order_id, e.created_at, e.expense_type
     FROM expenses e
     WHERE e.vendor_id IS NOT NULL AND e.logistic_order_id IS NOT NULL
       AND e.total > 0 AND e.status NOT IN ('cancelled','rejected')
     LIMIT 300`
  );

  for (const exp of expenses) {
    if (skip("expenses", exp.id)) continue;
    const [lo] = await supabaseQuery<{ shipment_type: string; origin: string; destination: string }>(
      `SELECT shipment_type, origin, destination FROM logistic_orders WHERE id = $1 LIMIT 1`,
      [exp.logistic_order_id]
    );
    await db.insert(purchasingSignalsTable).values({
      companyId, signalType: "expense_posted",
      vendorId: exp.vendor_id, serviceCategory: lo?.shipment_type ?? exp.expense_type,
      origin: lo?.origin ?? null, destination: lo?.destination ?? null,
      actualAmount: exp.total, currency: "IDR",
      sourceTable: "expenses", sourceId: exp.id,
      logisticOrderId: exp.logistic_order_id,
      recordedAt: new Date(exp.created_at),
    }).onConflictDoNothing();
    ingested++;
  }

  // 3. logistic_vendor_fulfillments with price_snapshot
  const fulfillments = await supabaseQuery<{
    id: number; vendor_id: number; order_id: number;
    price_snapshot: Record<string, unknown>; created_at: string;
  }>(
    `SELECT id, vendor_id, order_id, price_snapshot, created_at
     FROM logistic_vendor_fulfillments
     WHERE price_snapshot IS NOT NULL AND price_snapshot->>'total_cost' IS NOT NULL
       AND (price_snapshot->>'total_cost')::numeric > 0
     LIMIT 300`
  );

  for (const f of fulfillments) {
    if (skip("logistic_vendor_fulfillments", f.id)) continue;
    const totalCost = Number(f.price_snapshot?.total_cost ?? 0);
    if (!totalCost) continue;
    const [lo] = await supabaseQuery<{ shipment_type: string; origin: string; destination: string }>(
      `SELECT shipment_type, origin, destination FROM logistic_orders WHERE id = $1 LIMIT 1`,
      [f.order_id]
    );
    await db.insert(purchasingSignalsTable).values({
      companyId, signalType: "fulfillment_closed",
      vendorId: f.vendor_id, serviceCategory: lo?.shipment_type ?? null,
      origin: lo?.origin ?? null, destination: lo?.destination ?? null,
      actualAmount: totalCost, currency: "IDR",
      sourceTable: "logistic_vendor_fulfillments", sourceId: f.id,
      logisticOrderId: f.order_id,
      recordedAt: new Date(f.created_at),
    }).onConflictDoNothing();
    ingested++;
  }

  logger.info({ companyId, ingested }, "Purchasing signals ingested");
  return { ingested };
}
