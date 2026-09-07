/**
 * Sprint 5E — Intelligence Readiness Scoring
 *
 * Pure functions — no DB calls. Compute readiness score (0-100),
 * confidence tier, and named flags for each intel dataset row.
 *
 * Score = completeness×0.35 + freshness×0.30 + coverage×0.20 + volume×0.15
 */

export type ConfidenceTier = "high" | "medium" | "low" | "insufficient";

export interface ReadinessComponents {
  completeness: number; // 0-100
  freshness: number;    // 0-100
  coverage: number;     // 0-100
  volume: number;       // 0-100
}

export interface ReadinessResult {
  score: number;
  confidenceTier: ConfidenceTier;
  flags: string[];
  components: ReadinessComponents;
}

export function toConfidenceTier(score: number): ConfidenceTier {
  if (score >= 80) return "high";
  if (score >= 60) return "medium";
  if (score >= 40) return "low";
  return "insufficient";
}

// ── Staleness penalty rates (pts per day) ────────────────────────────────────

const STALE_RATES: Record<string, number> = {
  quotations: 3,
  ai_tasks: 2,
  vendor_performance_snapshots: 2,
  customer_memory_snapshots: 2,
  vendor_risk_assessments: 1,
  customer_risk_assessments: 1,
  vendor_capabilities: 0.5,
  shipment_trackings: 1.5,
};

function freshnessScore(lastUpdatedAt: Date | null, sourceKey: string): number {
  if (!lastUpdatedAt) return 0;
  const rate = STALE_RATES[sourceKey] ?? 1;
  const ageDays = (Date.now() - lastUpdatedAt.getTime()) / 86_400_000;
  return Math.max(0, Math.round(100 - ageDays * rate));
}

function weightedFreshness(sources: Array<{ lastUpdatedAt: Date | null; key: string; weight: number }>): number {
  const totalWeight = sources.reduce((s, x) => s + x.weight, 0);
  if (totalWeight === 0) return 0;
  const weighted = sources.reduce((s, x) => s + freshnessScore(x.lastUpdatedAt, x.key) * x.weight, 0);
  return Math.round(weighted / totalWeight);
}

// ── intel_routes readiness ───────────────────────────────────────────────────

export interface RouteReadinessInput {
  taskCount: number;
  vendorCount: number;
  priceSignalCount: number;
  onTimeDeliveryRate: number | null;
  avgActualCost: number | null;
  avgQuotedAmount: number | null;
  successRate: number | null;
  avgCustomerSatisfaction: number | null;
  sourceLastUpdatedAt: Date | null;
  totalRouteCount: number;
  routesWithMinTasks: number;
}

export function computeRouteReadiness(input: RouteReadinessInput): ReadinessResult {
  const flags: string[] = [];

  // Completeness (35%)
  const criticalFilled = [
    input.taskCount > 0,
    input.vendorCount > 0,
    input.onTimeDeliveryRate !== null,
    input.avgActualCost !== null,
  ];
  const importantFilled = [
    input.avgQuotedAmount !== null,
    input.successRate !== null,
  ];
  const optionalFilled = [
    input.avgCustomerSatisfaction !== null,
  ];
  const completeness = Math.round(
    (criticalFilled.filter(Boolean).length * 3 +
      importantFilled.filter(Boolean).length * 2 +
      optionalFilled.filter(Boolean).length) /
      (criticalFilled.length * 3 + importantFilled.length * 2 + optionalFilled.length) * 100
  );

  // Freshness (30%)
  const freshness = weightedFreshness([
    { lastUpdatedAt: input.sourceLastUpdatedAt, key: "shipment_trackings", weight: 0.5 },
    { lastUpdatedAt: input.sourceLastUpdatedAt, key: "ai_tasks", weight: 0.3 },
    { lastUpdatedAt: input.sourceLastUpdatedAt, key: "quotations", weight: 0.2 },
  ]);

  // Coverage (20%)
  const coverage = input.totalRouteCount > 0
    ? Math.round((input.routesWithMinTasks / input.totalRouteCount) * 100)
    : 0;

  // Volume (15%)
  const volume = Math.min(100, Math.round((input.priceSignalCount / 10) * 100));

  // Flags
  if (input.taskCount < 3) flags.push("low_task_volume");
  if (input.priceSignalCount === 0) flags.push("no_purchasing_signals");
  else if (input.priceSignalCount < 5) flags.push("insufficient_price_data");
  if (input.avgActualCost === null) flags.push("no_cost_data");
  if (input.onTimeDeliveryRate === null) flags.push("no_delivery_rate");

  const score = Math.round(completeness * 0.35 + freshness * 0.30 + coverage * 0.20 + volume * 0.15);
  return { score, confidenceTier: toConfidenceTier(score), flags, components: { completeness, freshness, coverage, volume } };
}

// ── intel_vendors readiness ──────────────────────────────────────────────────

export interface VendorReadinessInput {
  onTimeRate: number | null;
  riskScore: number | null;
  documentCompleteness: number | null;
  criticalDocsMissing: boolean;
  selectionRate: number | null;
  performanceScore: number | null;
  purchasingSignalCount: number;
  avgCustomerSatisfaction: number | null;
  riskAssessmentAge: number | null;
  performanceSnapshotLastUpdated: Date | null;
  riskLastUpdated: Date | null;
  capabilitiesLastUpdated: Date | null;
  totalActiveVendors: number;
  vendorsWithSignals: number;
}

export function computeVendorReadiness(input: VendorReadinessInput): ReadinessResult {
  const flags: string[] = [];

  // Completeness (35%)
  const criticalFilled = [
    input.onTimeRate !== null,
    input.riskScore !== null,
    input.documentCompleteness !== null,
    input.selectionRate !== null,
  ];
  const importantFilled = [
    input.performanceScore !== null,
    input.avgCustomerSatisfaction !== null,
  ];
  const optionalFilled = [
    input.purchasingSignalCount > 0,
  ];
  const completeness = Math.round(
    (criticalFilled.filter(Boolean).length * 3 +
      importantFilled.filter(Boolean).length * 2 +
      optionalFilled.filter(Boolean).length) /
      (criticalFilled.length * 3 + importantFilled.length * 2 + optionalFilled.length) * 100
  );

  // Freshness (30%)
  const freshness = weightedFreshness([
    { lastUpdatedAt: input.performanceSnapshotLastUpdated, key: "vendor_performance_snapshots", weight: 0.5 },
    { lastUpdatedAt: input.riskLastUpdated, key: "vendor_risk_assessments", weight: 0.3 },
    { lastUpdatedAt: input.capabilitiesLastUpdated, key: "vendor_capabilities", weight: 0.2 },
  ]);

  // Coverage (20%)
  const coverage = input.totalActiveVendors > 0
    ? Math.round((input.vendorsWithSignals / input.totalActiveVendors) * 100)
    : 0;

  // Volume (15%)
  const volume = Math.min(100, Math.round((input.purchasingSignalCount / 5) * 100));

  // Flags
  if (input.criticalDocsMissing) flags.push("document_registry_incomplete");
  if (input.purchasingSignalCount === 0) flags.push("no_purchasing_signals");
  if (input.riskScore === null) flags.push("no_risk_assessment");
  if (input.riskAssessmentAge !== null && input.riskAssessmentAge > 90) flags.push("vendor_risk_stale");
  if (input.onTimeRate === null) flags.push("no_vendor_performance_snapshot");

  const score = Math.round(completeness * 0.35 + freshness * 0.30 + coverage * 0.20 + volume * 0.15);
  return { score, confidenceTier: toConfidenceTier(score), flags, components: { completeness, freshness, coverage, volume } };
}

// ── intel_customers readiness ────────────────────────────────────────────────

export interface CustomerReadinessInput {
  riskScore: number | null;
  sentimentTrend: string | null;
  frequentServices: string[] | null;
  completionRate: number | null;
  taskCount: number;
  riskAssessmentAge: number | null;
  satisfactionSampleCount: number;
  memorySnapshotLastUpdated: Date | null;
  riskLastUpdated: Date | null;
  tasksLastUpdated: Date | null;
  totalActiveCustomers: number;
  customersWithOutcomes: number;
}

export function computeCustomerReadiness(input: CustomerReadinessInput): ReadinessResult {
  const flags: string[] = [];

  // Completeness (35%)
  const criticalFilled = [
    input.riskScore !== null,
    input.sentimentTrend !== null,
    (input.frequentServices?.length ?? 0) > 0,
    input.completionRate !== null,
  ];
  const importantFilled = [
    input.taskCount > 0,
    input.satisfactionSampleCount > 0,
  ];
  const optionalFilled: boolean[] = [];
  const completeness = Math.round(
    (criticalFilled.filter(Boolean).length * 3 +
      importantFilled.filter(Boolean).length * 2 +
      optionalFilled.filter(Boolean).length) /
      (criticalFilled.length * 3 + importantFilled.length * 2 + Math.max(optionalFilled.length, 1)) * 100
  );

  // Freshness (30%)
  const freshness = weightedFreshness([
    { lastUpdatedAt: input.memorySnapshotLastUpdated, key: "customer_memory_snapshots", weight: 0.4 },
    { lastUpdatedAt: input.tasksLastUpdated, key: "ai_tasks", weight: 0.4 },
    { lastUpdatedAt: input.riskLastUpdated, key: "customer_risk_assessments", weight: 0.2 },
  ]);

  // Coverage (20%)
  const coverage = input.totalActiveCustomers > 0
    ? Math.round((input.customersWithOutcomes / input.totalActiveCustomers) * 100)
    : 0;

  // Volume (15%)
  const volume = Math.min(100, Math.round((input.satisfactionSampleCount / 3) * 100));

  // Flags
  if (input.taskCount === 0) flags.push("low_task_volume");
  if (input.riskScore === null) flags.push("no_risk_assessment");
  if (input.riskAssessmentAge !== null && input.riskAssessmentAge > 90) flags.push("customer_risk_stale");
  if (input.satisfactionSampleCount === 0) flags.push("no_satisfaction_data");

  const score = Math.round(completeness * 0.35 + freshness * 0.30 + coverage * 0.20 + volume * 0.15);
  return { score, confidenceTier: toConfidenceTier(score), flags, components: { completeness, freshness, coverage, volume } };
}

// ── intel_profit readiness ───────────────────────────────────────────────────

export interface ProfitReadinessInput {
  signalCount: number;
  taskCount: number;
  quotationCount: number;
  totalActualRevenue: number;
  avgMarginPct: number | null;
  belowFloorPct: number | null;
  quotationsLastUpdated: Date | null;
  tasksLastUpdated: Date | null;
  dimension: string;
  dimensionCoverage: number;   // 0-1 fraction
}

export function computeProfitReadiness(input: ProfitReadinessInput): ReadinessResult {
  const flags: string[] = [];

  // Completeness (35%)
  const criticalFilled = [
    input.totalActualRevenue > 0,
    input.avgMarginPct !== null,
    input.signalCount > 0,
    input.quotationCount > 0,
  ];
  const importantFilled = [
    input.taskCount > 0,
    input.belowFloorPct !== null,
  ];
  const completeness = Math.round(
    (criticalFilled.filter(Boolean).length * 3 + importantFilled.filter(Boolean).length * 2) /
      (criticalFilled.length * 3 + importantFilled.length * 2) * 100
  );

  // Freshness (30%)
  const freshness = weightedFreshness([
    { lastUpdatedAt: input.quotationsLastUpdated, key: "quotations", weight: 0.6 },
    { lastUpdatedAt: input.tasksLastUpdated, key: "ai_tasks", weight: 0.4 },
  ]);

  // Coverage (20%)
  const coverage = Math.round(input.dimensionCoverage * 100);

  // Volume (15%)
  const volume = Math.min(100, Math.round((input.signalCount / 10) * 100));

  // Flags
  if (input.signalCount === 0) flags.push("no_purchasing_signals");
  else if (input.signalCount < 5) flags.push("insufficient_price_data");
  if (input.belowFloorPct !== null && input.belowFloorPct > 0.1) flags.push("margin_below_floor");
  if (input.quotationCount === 0) flags.push("no_quotation_data");

  const score = Math.round(completeness * 0.35 + freshness * 0.30 + coverage * 0.20 + volume * 0.15);
  return { score, confidenceTier: toConfidenceTier(score), flags, components: { completeness, freshness, coverage, volume } };
}

// ── intel_quotations readiness ───────────────────────────────────────────────

export interface QuotationReadinessInput {
  quotationsIssued: number;
  winRate: number | null;
  avgTotalAmount: number | null;
  avgHoursToSend: number | null;
  quotationsLastUpdated: Date | null;
  totalCategories: number;
  categoriesWithMinQuotes: number;
}

export function computeQuotationReadiness(input: QuotationReadinessInput): ReadinessResult {
  const flags: string[] = [];

  // Completeness (35%)
  const criticalFilled = [
    input.quotationsIssued >= 20,
    input.winRate !== null,
    input.avgTotalAmount !== null,
    input.avgHoursToSend !== null,
  ];
  const importantFilled = [
    input.quotationsIssued > 0,
  ];
  const completeness = Math.round(
    (criticalFilled.filter(Boolean).length * 3 + importantFilled.filter(Boolean).length * 2) /
      (criticalFilled.length * 3 + importantFilled.length * 2) * 100
  );

  // Freshness (30%)
  const freshness = weightedFreshness([
    { lastUpdatedAt: input.quotationsLastUpdated, key: "quotations", weight: 1 },
  ]);

  // Coverage (20%)
  const coverage = input.totalCategories > 0
    ? Math.round((input.categoriesWithMinQuotes / input.totalCategories) * 100)
    : 0;

  // Volume (15%)
  const volume = Math.min(100, Math.round((input.quotationsIssued / 20) * 100));

  // Flags
  if (input.quotationsIssued === 0) flags.push("no_quotation_data");
  if (input.winRate !== null && input.winRate < 0.3) flags.push("quotation_win_rate_low");
  if (input.quotationsIssued < 20) flags.push("insufficient_price_data");

  const score = Math.round(completeness * 0.35 + freshness * 0.30 + coverage * 0.20 + volume * 0.15);
  return { score, confidenceTier: toConfidenceTier(score), flags, components: { completeness, freshness, coverage, volume } };
}

// ── Aggregate readiness summary ───────────────────────────────────────────────

export interface DatasetReadinessSummary {
  overallScore: number;
  confidenceTier: ConfidenceTier;
  rowCount: number;
  rowsAbove80: number;
  rowsAbove60: number;
  rowsBelow40: number;
  topFlags: string[];
  avgCompleteness: number;
  avgFreshness: number;
  avgCoverage: number;
  avgVolume: number;
}

export function aggregateReadiness(rows: ReadinessResult[]): DatasetReadinessSummary {
  if (rows.length === 0) {
    return {
      overallScore: 0, confidenceTier: "insufficient",
      rowCount: 0, rowsAbove80: 0, rowsAbove60: 0, rowsBelow40: 0,
      topFlags: [], avgCompleteness: 0, avgFreshness: 0, avgCoverage: 0, avgVolume: 0,
    };
  }

  const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const overallScore = Math.round(mean(rows.map((r) => r.score)));

  const flagCounts = new Map<string, number>();
  for (const r of rows) {
    for (const f of r.flags) flagCounts.set(f, (flagCounts.get(f) ?? 0) + 1);
  }
  const topFlags = [...flagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([f]) => f);

  return {
    overallScore,
    confidenceTier: toConfidenceTier(overallScore),
    rowCount: rows.length,
    rowsAbove80: rows.filter((r) => r.score >= 80).length,
    rowsAbove60: rows.filter((r) => r.score >= 60).length,
    rowsBelow40: rows.filter((r) => r.score < 40).length,
    topFlags,
    avgCompleteness: Math.round(mean(rows.map((r) => r.components.completeness))),
    avgFreshness: Math.round(mean(rows.map((r) => r.components.freshness))),
    avgCoverage: Math.round(mean(rows.map((r) => r.components.coverage))),
    avgVolume: Math.round(mean(rows.map((r) => r.components.volume))),
  };
}
