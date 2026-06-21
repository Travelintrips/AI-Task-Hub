/**
 * Sprint 6B — Purchasing Intelligence (Replit DB layer)
 *
 * Tabel-tabel ini hidup di Replit DB (intelligence/materialized layer).
 * Supabase tetap menjadi operational source of truth.
 *
 * Tables:
 *   logistic_purchase_requests  — logistics service PR (bukan inventory)
 *   purchasing_signals          — append-only event log dari Supabase sources
 *   purchasing_price_benchmarks — statistical benchmark per vendor/category/route
 *   purchasing_intel_signals    — AI output log (immutable audit trail)
 *   purchasing_budget_tracker   — materialized budget utilization
 *   vendor_contract_rates       — negotiated rates override market benchmark
 */

import {
  pgTable, text, serial, timestamp, integer, real, boolean,
  smallint, date, index, jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ── Risk tier & signal types ──────────────────────────────────────────────────

export const PURCHASE_RISK_TIERS = ["low", "medium", "high", "critical"] as const;
export type PurchaseRiskTier = (typeof PURCHASE_RISK_TIERS)[number];

export const PURCHASE_REQUEST_STATUSES = [
  "draft", "pending_review", "submitted_for_approval",
  "approved", "rejected", "cancelled",
] as const;
export type PurchaseRequestStatus = (typeof PURCHASE_REQUEST_STATUSES)[number];

export const INTEL_SIGNAL_TYPES = [
  "price_benchmark", "duplicate_detected", "supplier_risk",
  "budget_impact", "margin_impact", "approval_risk", "composite",
] as const;
export type IntelSignalType = (typeof INTEL_SIGNAL_TYPES)[number];

export const INTEL_SIGNAL_SEVERITIES = ["info", "warning", "critical"] as const;
export type IntelSignalSeverity = (typeof INTEL_SIGNAL_SEVERITIES)[number];

export const PRICE_TRENDS = ["rising", "stable", "falling", "insufficient_data"] as const;
export type PriceTrend = (typeof PRICE_TRENDS)[number];

export const PURCHASING_SIGNAL_TYPES = [
  "invoice_paid", "payment_confirmed", "fulfillment_closed",
  "expense_posted", "contract_rate_applied",
] as const;
export type PurchasingSignalType = (typeof PURCHASING_SIGNAL_TYPES)[number];

// ── 1. logistic_purchase_requests ─────────────────────────────────────────────
// Logistics service purchasing — bukan inventory. Domain berbeda dari Supabase purchase_requests.

export const logisticPurchaseRequestsTable = pgTable("logistic_purchase_requests", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),

  // Identifiers
  requestNumber: text("request_number").notNull(),
  logisticOrderId: integer("logistic_order_id"),  // → Supabase logistic_orders.id

  // Request context
  requestedBy: text("requested_by"),
  department: text("department"),
  urgencyLevel: text("urgency_level").notNull().default("normal"),
  // normal | urgent | critical

  // Vendor
  vendorId: integer("vendor_id"),                  // → Supabase suppliers.id
  vendorName: text("vendor_name"),

  // Service context
  serviceCategory: text("service_category"),
  // trucking | sea_freight | air_freight | customs | warehouse | courier
  origin: text("origin"),
  destination: text("destination"),
  description: text("description"),

  // Amount
  estimatedAmount: real("estimated_amount"),
  currency: text("currency").notNull().default("IDR"),

  // Status
  status: text("status").notNull().default("draft"),

  // AI evaluation results
  aiRiskScore: smallint("ai_risk_score"),           // 0–100
  aiRiskTier: text("ai_risk_tier"),                 // low|medium|high|critical
  aiDuplicateFlag: boolean("ai_duplicate_flag").notNull().default(false),
  aiDuplicateOfId: integer("ai_duplicate_of_id"),  // → other logistic_purchase_requests.id
  aiPriceDeviationPct: real("ai_price_deviation_pct"),
  aiBudgetImpactPct: real("ai_budget_impact_pct"),
  aiMarginImpactPct: real("ai_margin_impact_pct"),
  aiEvaluatedAt: timestamp("ai_evaluated_at", { withTimezone: true }),

  // Approval
  supabaseApprovalRequestId: integer("supabase_approval_request_id"),
  // → Supabase approval_requests.id (created when risk ≥ HIGH)
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  rejectedBy: text("rejected_by"),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  rejectedReason: text("rejected_reason"),

  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("lpr_company_idx").on(t.companyId),
  index("lpr_request_number_idx").on(t.requestNumber),
  index("lpr_status_idx").on(t.status),
  index("lpr_vendor_idx").on(t.companyId, t.vendorId),
  index("lpr_risk_tier_idx").on(t.companyId, t.aiRiskTier),
  index("lpr_duplicate_flag_idx").on(t.companyId, t.aiDuplicateFlag),
  index("lpr_logistic_order_idx").on(t.logisticOrderId),
  index("lpr_created_at_idx").on(t.createdAt),
]);

export const insertLogisticPurchaseRequestSchema = createInsertSchema(logisticPurchaseRequestsTable)
  .omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLogisticPurchaseRequest = z.infer<typeof insertLogisticPurchaseRequestSchema>;
export type LogisticPurchaseRequest = typeof logisticPurchaseRequestsTable.$inferSelect;

// ── 2. purchasing_signals ──────────────────────────────────────────────────────
// Append-only event log dikumpulkan dari Supabase sources.
// Feed utama untuk purchasing_price_benchmarks refresh.

export const purchasingSignalsTable = pgTable("purchasing_signals", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),

  signalType: text("signal_type").notNull(),
  // invoice_paid | payment_confirmed | fulfillment_closed | expense_posted | contract_rate_applied

  // Vendor
  vendorId: integer("vendor_id"),
  vendorName: text("vendor_name"),

  // Service context (from logistic_orders join)
  serviceCategory: text("service_category"),
  origin: text("origin"),
  destination: text("destination"),

  // Amounts
  quotedAmount: real("quoted_amount"),
  actualAmount: real("actual_amount").notNull(),
  currency: text("currency").notNull().default("IDR"),

  // Margin (populated when revenue is known)
  revenueAmount: real("revenue_amount"),
  marginPct: real("margin_pct"),

  // Source references (Supabase)
  sourceTable: text("source_table").notNull(),
  sourceId: integer("source_id").notNull(),
  logisticOrderId: integer("logistic_order_id"),
  purchaseRequestId: integer("purchase_request_id"),
  // → logistic_purchase_requests.id (Replit)

  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("ps_company_vendor_idx").on(t.companyId, t.vendorId),
  index("ps_company_category_idx").on(t.companyId, t.serviceCategory),
  index("ps_source_idx").on(t.sourceTable, t.sourceId),
  index("ps_signal_type_idx").on(t.signalType),
  index("ps_recorded_at_idx").on(t.companyId, t.recordedAt),
]);

export const insertPurchasingSignalSchema = createInsertSchema(purchasingSignalsTable)
  .omit({ id: true, createdAt: true });
export type InsertPurchasingSignal = z.infer<typeof insertPurchasingSignalSchema>;
export type PurchasingSignal = typeof purchasingSignalsTable.$inferSelect;

// ── 3. purchasing_price_benchmarks ────────────────────────────────────────────
// Materialized statistical benchmark per (company, vendor, category, origin, dest).
// Direfresh dari purchasing_signals + contract rates.

export const purchasingPriceBenchmarksTable = pgTable("purchasing_price_benchmarks", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),

  // Dimensions
  vendorId: integer("vendor_id"),                  // null = market-wide benchmark
  vendorName: text("vendor_name"),
  serviceCategory: text("service_category").notNull(),
  origin: text("origin"),
  destination: text("destination"),
  currency: text("currency").notNull().default("IDR"),

  // Statistical metrics
  p10Price: real("p10_price"),
  p25Price: real("p25_price"),
  medianPrice: real("median_price"),
  p75Price: real("p75_price"),
  p90Price: real("p90_price"),
  avgPrice: real("avg_price"),
  minPrice: real("min_price"),
  maxPrice: real("max_price"),
  sampleCount: integer("sample_count").notNull().default(0),

  // Trend & volatility
  priceVolatilityPct: real("price_volatility_pct"),
  priceTrend: text("price_trend").notNull().default("insufficient_data"),
  // rising | stable | falling | insufficient_data

  // Contract rate
  contractRateAvailable: boolean("contract_rate_available").notNull().default(false),
  contractRate: real("contract_rate"),
  contractRateValidUntil: date("contract_rate_valid_until"),

  // Quality
  benchmarkConfidence: text("benchmark_confidence").notNull().default("low"),
  // high (≥10 samples) | medium (5–9) | low (2–4) | insufficient (<2)
  periodDays: integer("period_days").notNull().default(90),
  periodStart: date("period_start"),
  periodEnd: date("period_end"),

  refreshedAt: timestamp("refreshed_at", { withTimezone: true }),
  isStale: boolean("is_stale").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("ppb_company_vendor_cat_idx").on(t.companyId, t.vendorId, t.serviceCategory),
  index("ppb_company_cat_route_idx").on(t.companyId, t.serviceCategory, t.origin, t.destination),
  index("ppb_confidence_idx").on(t.companyId, t.benchmarkConfidence),
  index("ppb_stale_idx").on(t.companyId, t.isStale),
]);

export const insertPurchasingPriceBenchmarkSchema = createInsertSchema(purchasingPriceBenchmarksTable)
  .omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPurchasingPriceBenchmark = z.infer<typeof insertPurchasingPriceBenchmarkSchema>;
export type PurchasingPriceBenchmark = typeof purchasingPriceBenchmarksTable.$inferSelect;

// ── 4. purchasing_intel_signals ───────────────────────────────────────────────
// Immutable AI output log — setiap AI evaluation ditulis di sini.
// Tidak pernah di-update; buat row baru untuk re-evaluation.

export const purchasingIntelSignalsTable = pgTable("purchasing_intel_signals", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),

  purchaseRequestId: integer("purchase_request_id").notNull(),
  // → logistic_purchase_requests.id

  signalType: text("signal_type").notNull(),
  severity: text("severity").notNull().default("info"),
  // info | warning | critical

  // Scores
  score: smallint("score"),                        // 0–100 module-specific score
  compositeRiskScore: smallint("composite_risk_score"), // 0–100 overall

  // Structured AI output
  headline: text("headline").notNull(),            // Short human-readable title
  explanation: text("explanation"),               // 2-3 sentence AI narrative
  scoringBreakdown: jsonb("scoring_breakdown"),   // {components: [{name, score, weight, detail}]}
  dataSnapshot: jsonb("data_snapshot"),           // Snapshot of data used for this evaluation

  // Clarification questions (for approval_risk signals)
  clarificationQuestions: text("clarification_questions").array(),

  // Acknowledgement by human
  acknowledged: boolean("acknowledged").notNull().default(false),
  acknowledgedBy: text("acknowledged_by"),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  acknowledgementNote: text("acknowledgement_note"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("pis_request_idx").on(t.purchaseRequestId),
  index("pis_company_idx").on(t.companyId),
  index("pis_signal_type_idx").on(t.signalType),
  index("pis_severity_idx").on(t.companyId, t.severity),
  index("pis_created_at_idx").on(t.createdAt),
]);

export const insertPurchasingIntelSignalSchema = createInsertSchema(purchasingIntelSignalsTable)
  .omit({ id: true, createdAt: true });
export type InsertPurchasingIntelSignal = z.infer<typeof insertPurchasingIntelSignalSchema>;
export type PurchasingIntelSignal = typeof purchasingIntelSignalsTable.$inferSelect;

// ── 5. purchasing_budget_tracker ──────────────────────────────────────────────
// Materialized budget utilization per company/category/period.
// Direfresh dari expense_budgets (Supabase) + expenses (Supabase) + pending LPRs.

export const purchasingBudgetTrackerTable = pgTable("purchasing_budget_tracker", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),

  // Period
  periodYear: integer("period_year").notNull(),
  periodMonth: integer("period_month").notNull(),      // 1–12

  // Category (maps to expense_budgets.category_id / expenses.expense_type)
  serviceCategory: text("service_category").notNull(),
  department: text("department"),

  // Budget amounts
  budgetAllocated: real("budget_allocated").notNull().default(0),
  budgetUsed: real("budget_used").notNull().default(0),         // Actuals from expenses
  budgetPending: real("budget_pending").notNull().default(0),   // Pending LPRs
  budgetRemaining: real("budget_remaining").notNull().default(0),
  utilizationPct: real("utilization_pct").notNull().default(0), // (used+pending)/allocated

  currency: text("currency").notNull().default("IDR"),

  // Supabase reference
  supabaseBudgetId: integer("supabase_budget_id"),              // → expense_budgets.id

  refreshedAt: timestamp("refreshed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("pbt_company_period_idx").on(t.companyId, t.periodYear, t.periodMonth),
  index("pbt_company_category_idx").on(t.companyId, t.serviceCategory),
]);

export const insertPurchasingBudgetTrackerSchema = createInsertSchema(purchasingBudgetTrackerTable)
  .omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPurchasingBudgetTracker = z.infer<typeof insertPurchasingBudgetTrackerSchema>;
export type PurchasingBudgetTracker = typeof purchasingBudgetTrackerTable.$inferSelect;

// ── 6. vendor_contract_rates ──────────────────────────────────────────────────
// Negotiated contract rates — override market benchmark in price scoring.

export const vendorContractRatesTable = pgTable("vendor_contract_rates", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),

  vendorId: integer("vendor_id").notNull(),                     // → Supabase suppliers.id
  vendorName: text("vendor_name"),
  serviceCategory: text("service_category").notNull(),
  origin: text("origin"),
  destination: text("destination"),

  contractedRate: real("contracted_rate").notNull(),
  currency: text("currency").notNull().default("IDR"),
  rateUnit: text("rate_unit").notNull().default("per_shipment"),
  // per_shipment | per_kg | per_cbm | per_container

  validFrom: date("valid_from").notNull(),
  validUntil: date("valid_until"),
  contractReference: text("contract_reference"),
  notes: text("notes"),

  isActive: boolean("is_active").notNull().default(true),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("vcr_company_vendor_idx").on(t.companyId, t.vendorId),
  index("vcr_company_cat_idx").on(t.companyId, t.serviceCategory),
  index("vcr_active_idx").on(t.companyId, t.isActive),
  index("vcr_valid_until_idx").on(t.validUntil),
]);

export const insertVendorContractRateSchema = createInsertSchema(vendorContractRatesTable)
  .omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVendorContractRate = z.infer<typeof insertVendorContractRateSchema>;
export type VendorContractRate = typeof vendorContractRatesTable.$inferSelect;
