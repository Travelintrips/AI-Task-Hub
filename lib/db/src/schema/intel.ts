/**
 * Sprint 5E — Intelligence Readiness Layer
 *
 * Materialized dataset tables written by scheduled refresh jobs.
 * Five intelligence datasets + readiness scores + refresh log.
 *
 * Revisions applied:
 *   - confidenceTier on all 5 intel tables
 *   - sourceCount + sourceLastUpdatedAt on all 5 intel tables
 *   - recommendationAcceptanceRate + recommendationWinRate on intel_vendors
 *   - belowMarginFloorCount on intel_profit
 *   - datasetVersion on all 7 tables
 */

import {
  pgTable, text, serial, timestamp, integer, real, boolean, smallint, date, index,
} from "drizzle-orm/pg-core";

export const INTEL_DATASET_VERSION = 1;

// ── 1. intel_routes ───────────────────────────────────────────────────────────
// One row per (companyId, origin, destination, serviceCategory, periodStart)

export const intelRoutesTable = pgTable("intel_routes", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  origin: text("origin").notNull(),
  destination: text("destination").notNull(),
  serviceCategory: text("service_category").notNull(),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  datasetVersion: integer("dataset_version").notNull().default(INTEL_DATASET_VERSION),

  sourceCount: smallint("source_count").default(0),
  sourceLastUpdatedAt: timestamp("source_last_updated_at", { withTimezone: true }),

  // Demand
  taskCount: integer("task_count").default(0),
  uniqueCustomers: integer("unique_customers").default(0),
  repeatCustomerRate: real("repeat_customer_rate"),
  avgTasksPerMonth: real("avg_tasks_per_month"),

  // Timing
  avgEtaDays: real("avg_eta_days"),
  avgActualDays: real("avg_actual_days"),
  onTimeDeliveryRate: real("on_time_delivery_rate"),
  catalogEstimatedDays: text("catalog_estimated_days"),

  // Cost benchmarks (populated from purchasing_signals once Sprint 5D is live)
  catalogBasePrice: real("catalog_base_price"),
  avgQuotedAmount: real("avg_quoted_amount"),
  avgActualCost: real("avg_actual_cost"),
  avgActualRevenue: real("avg_actual_revenue"),
  avgMarginPct: real("avg_margin_pct"),
  costVariancePct: real("cost_variance_pct"),
  priceSignalCount: integer("price_signal_count").default(0),

  // Vendor coverage
  vendorCount: integer("vendor_count").default(0),
  avgVendorSelectionRate: real("avg_vendor_selection_rate"),
  topVendorIds: text("top_vendor_ids").array(),

  // Quality
  avgCustomerSatisfaction: real("avg_customer_satisfaction"),
  successRate: real("success_rate"),

  // Readiness
  readinessScore: smallint("readiness_score").default(0),
  confidenceTier: text("confidence_tier").notNull().default("insufficient"),
  readinessFlags: text("readiness_flags").array(),
  refreshedAt: timestamp("refreshed_at", { withTimezone: true }),
  isStale: boolean("is_stale").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("intel_routes_route_idx").on(t.companyId, t.origin, t.destination, t.serviceCategory, t.periodStart),
  index("intel_routes_category_idx").on(t.companyId, t.serviceCategory),
  index("intel_routes_readiness_idx").on(t.companyId, t.readinessScore),
  index("intel_routes_stale_idx").on(t.companyId, t.isStale),
]);

// ── 2. intel_vendors ──────────────────────────────────────────────────────────
// One row per (companyId, vendorId, periodStart)

export const intelVendorsTable = pgTable("intel_vendors", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  vendorId: integer("vendor_id").notNull(),
  vendorName: text("vendor_name"),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  datasetVersion: integer("dataset_version").notNull().default(INTEL_DATASET_VERSION),

  sourceCount: smallint("source_count").default(0),
  sourceLastUpdatedAt: timestamp("source_last_updated_at", { withTimezone: true }),

  // Capabilities
  serviceTypes: text("service_types").array(),
  cargoTypes: text("cargo_types").array(),
  coverageOrigins: text("coverage_origins").array(),
  coverageDestinations: text("coverage_destinations").array(),
  certifications: text("certifications").array(),
  hasHazmat: boolean("has_hazmat").default(false),
  hasColdChain: boolean("has_cold_chain").default(false),

  // Performance
  onTimeRate: real("on_time_rate"),
  responseRate: real("response_rate"),
  documentAccuracy: real("document_accuracy"),
  cancelRate: real("cancel_rate"),
  performanceScore: real("performance_score"),
  performanceGrade: text("performance_grade"),
  avgResponseHours: real("avg_response_hours"),
  jobsTotal: integer("jobs_total").default(0),
  jobsCompleted: integer("jobs_completed").default(0),

  // Risk
  riskScore: integer("risk_score"),
  riskTier: text("risk_tier"),
  riskFactorCodes: text("risk_factor_codes").array(),
  riskAssessmentAge: integer("risk_assessment_age"),

  // Documents
  documentCompleteness: real("document_completeness"),
  expiredDocCount: integer("expired_doc_count").default(0),
  missingDocTypes: text("missing_doc_types").array(),
  criticalDocsMissing: boolean("critical_docs_missing").default(false),

  // CMM track record (Sprint 5C — populated after implementation)
  timesRecommended: integer("times_recommended").default(0),
  timesRecommendedRank1: integer("times_recommended_rank1").default(0),
  timesSelected: integer("times_selected").default(0),
  selectionRate: real("selection_rate"),
  rank1AcceptanceRate: real("rank1_acceptance_rate"),
  avgCmmCompositeScore: real("avg_cmm_composite_score"),
  recommendationAcceptanceRate: real("recommendation_acceptance_rate"),
  recommendationWinRate: real("recommendation_win_rate"),

  // Purchasing signals (Sprint 5D — populated after implementation)
  purchasingSignalCount: integer("purchasing_signal_count").default(0),
  avgActualCost: real("avg_actual_cost"),
  avgMarginPct: real("avg_margin_pct"),
  costStdDev: real("cost_std_dev"),
  costPredictabilityTier: text("cost_predictability_tier"),

  // Satisfaction
  avgCustomerSatisfaction: real("avg_customer_satisfaction"),
  satisfactionSampleCount: integer("satisfaction_sample_count").default(0),

  // Readiness
  readinessScore: smallint("readiness_score").default(0),
  confidenceTier: text("confidence_tier").notNull().default("insufficient"),
  readinessFlags: text("readiness_flags").array(),
  refreshedAt: timestamp("refreshed_at", { withTimezone: true }),
  isStale: boolean("is_stale").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("intel_vendors_vendor_idx").on(t.companyId, t.vendorId, t.periodStart),
  index("intel_vendors_risk_idx").on(t.companyId, t.riskTier),
  index("intel_vendors_grade_idx").on(t.companyId, t.performanceGrade),
  index("intel_vendors_readiness_idx").on(t.companyId, t.readinessScore),
  index("intel_vendors_stale_idx").on(t.companyId, t.isStale),
]);

// ── 3. intel_customers ────────────────────────────────────────────────────────
// One row per (companyId, customerId, periodStart)

export const intelCustomersTable = pgTable("intel_customers", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  customerId: integer("customer_id").notNull(),
  customerName: text("customer_name"),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  datasetVersion: integer("dataset_version").notNull().default(INTEL_DATASET_VERSION),

  sourceCount: smallint("source_count").default(0),
  sourceLastUpdatedAt: timestamp("source_last_updated_at", { withTimezone: true }),

  // Profile
  tier: text("tier"),
  industry: text("industry"),
  preferredChannel: text("preferred_channel"),
  preferredLanguage: text("preferred_language"),

  // Behavioral patterns
  frequentServices: text("frequent_services").array(),
  typicalRoutes: text("typical_routes").array(),
  typicalCargoTypes: text("typical_cargo_types").array(),
  avgTasksPerMonth: real("avg_tasks_per_month"),
  taskCount: integer("task_count").default(0),
  lastTaskAt: timestamp("last_task_at", { withTimezone: true }),
  daysSinceLastTask: integer("days_since_last_task"),

  // Task outcomes
  completionRate: real("completion_rate"),
  onTrackRate: real("on_track_rate"),
  slaBreachRate: real("sla_breach_rate"),
  avgFollowUpCount: real("avg_follow_up_count"),

  // Sentiment
  sentimentTrend: text("sentiment_trend"),
  avgSentimentScore: real("avg_sentiment_score"),
  positiveSentimentPct: real("positive_sentiment_pct"),

  // Risk
  riskScore: integer("risk_score"),
  riskTier: text("risk_tier"),
  creditLimit: real("credit_limit"),
  riskFactorCodes: text("risk_factor_codes").array(),
  riskAssessmentAge: integer("risk_assessment_age"),

  // Satisfaction (Sprint 5D — populated after implementation)
  avgCustomerSatisfaction: real("avg_customer_satisfaction"),
  satisfactionSampleCount: integer("satisfaction_sample_count").default(0),
  satisfactionTrend: text("satisfaction_trend"),

  // Document behavior
  missingDocFrequency: real("missing_doc_frequency"),
  typicalMissingDocs: text("typical_missing_docs").array(),

  // Readiness
  readinessScore: smallint("readiness_score").default(0),
  confidenceTier: text("confidence_tier").notNull().default("insufficient"),
  readinessFlags: text("readiness_flags").array(),
  refreshedAt: timestamp("refreshed_at", { withTimezone: true }),
  isStale: boolean("is_stale").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("intel_customers_cust_idx").on(t.companyId, t.customerId, t.periodStart),
  index("intel_customers_tier_idx").on(t.companyId, t.tier),
  index("intel_customers_risk_idx").on(t.companyId, t.riskTier),
  index("intel_customers_readiness_idx").on(t.companyId, t.readinessScore),
  index("intel_customers_stale_idx").on(t.companyId, t.isStale),
]);

// ── 4. intel_profit ───────────────────────────────────────────────────────────
// Multi-dimensional: one row per (companyId, dimension, dimensionValue, periodStart)

export const intelProfitTable = pgTable("intel_profit", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  dimension: text("dimension").notNull(), // total|by_category|by_vendor|by_customer|by_route
  dimensionValue: text("dimension_value"),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  datasetVersion: integer("dataset_version").notNull().default(INTEL_DATASET_VERSION),

  sourceCount: smallint("source_count").default(0),
  sourceLastUpdatedAt: timestamp("source_last_updated_at", { withTimezone: true }),

  // Volume
  signalCount: integer("signal_count").default(0),
  taskCount: integer("task_count").default(0),
  quotationCount: integer("quotation_count").default(0),
  quotationAcceptedCount: integer("quotation_accepted_count").default(0),
  quotationWinRate: real("quotation_win_rate"),

  // Revenue
  totalQuotedAmount: real("total_quoted_amount").default(0),
  totalActualRevenue: real("total_actual_revenue").default(0),
  avgRevenuePerTask: real("avg_revenue_per_task"),

  // Cost
  totalActualCost: real("total_actual_cost").default(0),
  avgCostPerTask: real("avg_cost_per_task"),
  catalogBasePrice: real("catalog_base_price"),
  costVsCatalogPct: real("cost_vs_catalog_pct"),

  // Margin
  totalActualMargin: real("total_actual_margin").default(0),
  avgMarginPct: real("avg_margin_pct"),
  medianMarginPct: real("median_margin_pct"),
  p10MarginPct: real("p10_margin_pct"),
  p90MarginPct: real("p90_margin_pct"),
  marginStdDev: real("margin_std_dev"),
  belowFloorCount: integer("below_floor_count").default(0),
  belowFloorPct: real("below_floor_pct"),
  belowMarginFloorCount: integer("below_margin_floor_count").default(0),

  // Variance (Sprint 5D)
  avgProfitVariance: real("avg_profit_variance"),
  positiveProfitVariancePct: real("positive_profit_variance_pct"),

  // Trend
  revenueGrowthPct: real("revenue_growth_pct"),
  marginGrowthPct: real("margin_growth_pct"),
  prevPeriodAvgMarginPct: real("prev_period_avg_margin_pct"),

  // Readiness
  readinessScore: smallint("readiness_score").default(0),
  confidenceTier: text("confidence_tier").notNull().default("insufficient"),
  readinessFlags: text("readiness_flags").array(),
  refreshedAt: timestamp("refreshed_at", { withTimezone: true }),
  isStale: boolean("is_stale").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("intel_profit_dim_idx").on(t.companyId, t.dimension, t.dimensionValue, t.periodStart),
  index("intel_profit_period_idx").on(t.companyId, t.dimension, t.periodStart),
  index("intel_profit_readiness_idx").on(t.companyId, t.readinessScore),
  index("intel_profit_stale_idx").on(t.companyId, t.isStale),
]);

// ── 5. intel_quotations ───────────────────────────────────────────────────────
// One row per (companyId, serviceCategory, periodStart)

export const intelQuotationsTable = pgTable("intel_quotations", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  serviceCategory: text("service_category").notNull(),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  datasetVersion: integer("dataset_version").notNull().default(INTEL_DATASET_VERSION),

  sourceCount: smallint("source_count").default(0),
  sourceLastUpdatedAt: timestamp("source_last_updated_at", { withTimezone: true }),

  // Volume
  quotationsIssued: integer("quotations_issued").default(0),
  quotationsSent: integer("quotations_sent").default(0),
  quotationsAccepted: integer("quotations_accepted").default(0),
  quotationsRejected: integer("quotations_rejected").default(0),
  winRate: real("win_rate"),
  aiGeneratedCount: integer("ai_generated_count").default(0),
  manualCount: integer("manual_count").default(0),

  // Pricing
  avgTotalAmount: real("avg_total_amount"),
  medianTotalAmount: real("median_total_amount"),
  p10TotalAmount: real("p10_total_amount"),
  p90TotalAmount: real("p90_total_amount"),
  catalogBasePrice: real("catalog_base_price"),
  avgPremiumOverCatalog: real("avg_premium_over_catalog"),

  // Accuracy (Sprint 5D)
  avgProfitVariance: real("avg_profit_variance"),
  quotesTooLow: integer("quotes_too_low").default(0),
  quotesTooLowPct: real("quotes_too_low_pct"),
  quotesTooHigh: integer("quotes_too_high").default(0),

  // Speed
  avgHoursToSend: real("avg_hours_to_send"),
  avgHoursToRespond: real("avg_hours_to_respond"),
  avgTotalCycleDays: real("avg_total_cycle_days"),

  // AI vs manual
  aiWinRate: real("ai_win_rate"),
  manualWinRate: real("manual_win_rate"),
  aiAvgAmount: real("ai_avg_amount"),
  manualAvgAmount: real("manual_avg_amount"),
  aiAvgHoursToSend: real("ai_avg_hours_to_send"),
  manualAvgHoursToSend: real("manual_avg_hours_to_send"),

  // Intent confidence correlation
  avgIntentConfidenceAtQuote: real("avg_intent_confidence_at_quote"),
  highConfidenceWinRate: real("high_confidence_win_rate"),
  lowConfidenceWinRate: real("low_confidence_win_rate"),

  // Readiness
  readinessScore: smallint("readiness_score").default(0),
  confidenceTier: text("confidence_tier").notNull().default("insufficient"),
  readinessFlags: text("readiness_flags").array(),
  refreshedAt: timestamp("refreshed_at", { withTimezone: true }),
  isStale: boolean("is_stale").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("intel_quot_cat_idx").on(t.companyId, t.serviceCategory, t.periodStart),
  index("intel_quot_readiness_idx").on(t.companyId, t.readinessScore),
  index("intel_quot_stale_idx").on(t.companyId, t.isStale),
]);

// ── 6. intel_readiness_scores ─────────────────────────────────────────────────
// Aggregated readiness summary per dataset per period

export const intelReadinessScoresTable = pgTable("intel_readiness_scores", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  datasetName: text("dataset_name").notNull(), // routes|vendors|customers|profit|quotations
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  datasetVersion: integer("dataset_version").notNull().default(INTEL_DATASET_VERSION),

  overallReadinessScore: smallint("overall_readiness_score").default(0),
  overallConfidenceTier: text("overall_confidence_tier").notNull().default("insufficient"),
  rowCount: integer("row_count").default(0),
  rowsAbove80: integer("rows_above_80").default(0),
  rowsAbove60: integer("rows_above_60").default(0),
  rowsBelow40: integer("rows_below_40").default(0),
  topFlags: text("top_flags").array(),
  avgCompleteness: real("avg_completeness"),
  avgFreshness: real("avg_freshness"),
  avgCoverage: real("avg_coverage"),
  avgVolume: real("avg_volume"),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("intel_readiness_dataset_idx").on(t.companyId, t.datasetName, t.periodStart),
]);

// ── 7. intel_refresh_log ──────────────────────────────────────────────────────
// Append-only log of every refresh run

export const intelRefreshLogTable = pgTable("intel_refresh_log", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  jobId: text("job_id").notNull(),
  datasetName: text("dataset_name").notNull(),
  trigger: text("trigger").notNull().default("scheduled"), // scheduled|stale_signal|manual
  triggeredBy: text("triggered_by").default("system"),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  status: text("status").notNull().default("running"), // running|completed|failed|partial
  rowsWritten: integer("rows_written").default(0),
  rowsStaleCleared: integer("rows_stale_cleared").default(0),
  readinessScoreAvg: real("readiness_score_avg"),
  durationMs: integer("duration_ms"),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("intel_refresh_log_ds_idx").on(t.companyId, t.datasetName, t.startedAt),
  index("intel_refresh_log_status_idx").on(t.companyId, t.status),
  index("intel_refresh_log_job_idx").on(t.jobId),
]);

// ── Types ──────────────────────────────────────────────────────────────────────

export type IntelRoute = typeof intelRoutesTable.$inferSelect;
export type IntelVendor = typeof intelVendorsTable.$inferSelect;
export type IntelCustomer = typeof intelCustomersTable.$inferSelect;
export type IntelProfit = typeof intelProfitTable.$inferSelect;
export type IntelQuotation = typeof intelQuotationsTable.$inferSelect;
export type IntelReadinessScore = typeof intelReadinessScoresTable.$inferSelect;
export type IntelRefreshLog = typeof intelRefreshLogTable.$inferSelect;

export type ConfidenceTier = "high" | "medium" | "low" | "insufficient";
export type IntelDatasetName = "routes" | "vendors" | "customers" | "profit" | "quotations";
