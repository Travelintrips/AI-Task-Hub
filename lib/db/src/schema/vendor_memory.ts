/**
 * Sprint 5B — Vendor Memory Center
 *
 * New tables:
 *   vendor_preferences         — learned/explicit preferences (with status lifecycle)
 *   vendor_risk_assessments    — immutable risk records (new row per change)
 *   vendor_performance_snapshots — daily performance snapshots from operational data
 *   vendor_capabilities        — service capabilities (manual + AI-inferred)
 *   vendor_document_registry   — compliance docs with expiry tracking
 *   vendor_memory_snapshots    — AI-generated context block injected into IntentEngine
 *   vendor_memory_events       — audit trail for all memory mutations
 *
 * Primary entity: suppliers table in Supabase (id = integer).
 * vendor_id in all tables below refers to suppliers.id.
 */

import {
  pgTable, text, serial, timestamp, boolean, integer, numeric, index,
  date, jsonb, smallint, real,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ── 1. Vendor Preferences ─────────────────────────────────────────────────────

export const vendorPreferencesTable = pgTable("vendor_preferences", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  vendorId: integer("vendor_id").notNull(),       // → suppliers.id

  category: text("category").notNull(),
  // 'service'       → dominant_mode, top_routes, specialization
  // 'communication' → response_tier, preferred_channel, pic_name
  // 'document'      → invoice_format, typical_docs
  // 'payment'       → preferred_method, typical_term_days
  // 'operational'   → typical_lead_time, operation_areas, vehicle_types
  key: text("key").notNull(),
  value: text("value").notNull(),
  valueJson: jsonb("value_json"),                  // for arrays / complex values

  status: text("status").notNull().default("active"), // active|inactive|superseded
  source: text("source").notNull().default("manual"), // manual|ai_inferred|form_submitted
  confidence: numeric("confidence", { precision: 4, scale: 2 }), // 0.00–1.00
  inferredFromCount: integer("inferred_from_count").default(1),

  createdBy: text("created_by"),
  supersededAt: timestamp("superseded_at", { withTimezone: true }),
  supersededBy: integer("superseded_by"),           // id of the preference that replaced this

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("vend_pref_vendor_idx").on(t.companyId, t.vendorId),
  index("vend_pref_cat_key_idx").on(t.companyId, t.vendorId, t.category, t.key),
  index("vend_pref_status_idx").on(t.status),
]);

export const insertVendorPreferenceSchema = createInsertSchema(vendorPreferencesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVendorPreference = z.infer<typeof insertVendorPreferenceSchema>;
export type VendorPreference = typeof vendorPreferencesTable.$inferSelect;

// ── 2. Vendor Risk Assessments (IMMUTABLE) ────────────────────────────────────
// Never update-in-place. New assessment → new row. Previous isActive becomes false.

export const vendorRiskAssessmentsTable = pgTable("vendor_risk_assessments", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  vendorId: integer("vendor_id").notNull(),

  assessedAt: timestamp("assessed_at", { withTimezone: true }).notNull().defaultNow(),
  assessedBy: text("assessed_by").notNull(),       // user id | 'ai'
  assessType: text("assess_type").notNull().default("manual"),
  // 'manual' | 'periodic' | 'triggered'

  riskScore: integer("risk_score").notNull(),       // 0–100 (higher = more risky)
  tier: text("tier").notNull(),                     // low|medium|high|blacklisted
  previousTier: text("previous_tier"),

  creditLimit: numeric("credit_limit", { precision: 14, scale: 2 }),
  paymentTermsDays: integer("payment_terms_days"),
  outstandingPayable: numeric("outstanding_payable", { precision: 14, scale: 2 }),

  factors: jsonb("factors"),
  // [{code, weight, rawValue, normalizedScore, detail}]
  // codes: late_delivery|cancel_rate|invoice_dispute|pod_missing
  //        rfq_no_show|compliance_issue|payment_delay|expired_documents|customer_complaints

  recommendations: text("recommendations"),
  notes: text("notes"),
  expiresAt: date("expires_at"),

  // IMMUTABLE lifecycle
  isActive: boolean("is_active").notNull().default(true),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  archivedByAssessmentId: integer("archived_by_assessment_id"),
}, (t) => [
  index("vend_risk_vendor_idx").on(t.companyId, t.vendorId),
  index("vend_risk_active_idx").on(t.companyId, t.vendorId, t.isActive),
  index("vend_risk_assessed_at_idx").on(t.assessedAt),
]);

export const insertVendorRiskSchema = createInsertSchema(vendorRiskAssessmentsTable).omit({ id: true, assessedAt: true, archivedAt: true });
export type InsertVendorRisk = z.infer<typeof insertVendorRiskSchema>;
export type VendorRiskAssessment = typeof vendorRiskAssessmentsTable.$inferSelect;

// ── 3. Vendor Performance Snapshots ───────────────────────────────────────────
// Periodic aggregation from operational data — separate from Supabase vendor_performance

export const vendorPerformanceSnapshotsTable = pgTable("vendor_performance_snapshots", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  vendorId: integer("vendor_id").notNull(),
  snapshotDate: date("snapshot_date").notNull(),

  // Job stats
  jobsTotal: integer("jobs_total").default(0),
  jobsCompleted: integer("jobs_completed").default(0),
  jobsCancelled: integer("jobs_cancelled").default(0),
  jobsRejected: integer("jobs_rejected").default(0),
  activeJobsCount: integer("active_jobs_count").default(0),

  // Rates
  onTimeRate: real("on_time_rate"),                // 0.0–1.0
  responseRate: real("response_rate"),
  avgResponseHours: real("avg_response_hours"),
  avgCompletionDays: real("avg_completion_days"),

  // RFQ stats
  rfqInvites: integer("rfq_invites").default(0),
  rfqSubmitted: integer("rfq_submitted").default(0),
  rfqSelected: integer("rfq_selected").default(0),
  quotationWinRate: real("quotation_win_rate"),    // rfqSelected/rfqSubmitted

  // Financial
  totalRevenue: numeric("total_revenue", { precision: 14, scale: 2 }),
  totalCost: numeric("total_cost", { precision: 14, scale: 2 }),
  totalMargin: numeric("total_margin", { precision: 14, scale: 2 }),
  outstandingPayable: numeric("outstanding_payable", { precision: 14, scale: 2 }),
  invoiceDisputeCount: integer("invoice_dispute_count").default(0),

  // Quality
  podCompletenessScore: real("pod_completeness_score"),
  etaAccuracyScore: real("eta_accuracy_score"),
  cancelRate: real("cancel_rate"),
  customerComplaintCount: integer("customer_complaint_count").default(0),

  // Computed score
  performanceScore: real("performance_score"),     // 0–100
  performanceGrade: text("performance_grade"),     // A|B|C|D|F
  readinessScore: real("readiness_score"),         // 0–100
  vendorGrade: text("vendor_grade"),               // from Supabase vendor_performance

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("vend_perf_snap_vendor_idx").on(t.companyId, t.vendorId),
  index("vend_perf_snap_date_idx").on(t.companyId, t.vendorId, t.snapshotDate),
]);

export const insertVendorPerformanceSnapshotSchema = createInsertSchema(vendorPerformanceSnapshotsTable).omit({ id: true, createdAt: true });
export type InsertVendorPerformanceSnapshot = z.infer<typeof insertVendorPerformanceSnapshotSchema>;
export type VendorPerformanceSnapshot = typeof vendorPerformanceSnapshotsTable.$inferSelect;

// ── 4. Vendor Capabilities ────────────────────────────────────────────────────
// Service capabilities — manual input, AI-inferred from completed jobs, or vendor form

export const vendorCapabilitiesTable = pgTable("vendor_capabilities", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  vendorId: integer("vendor_id").notNull(),

  serviceType: text("service_type").notNull(),
  // trucking|sea_freight|air_freight|customs|warehouse|courier

  cargoType: text("cargo_type"),                   // general|hazmat|cold_chain|bulk|oversized
  dangerousGoods: boolean("dangerous_goods").default(false),
  coldChain: boolean("cold_chain").default(false),
  maxWeightKg: real("max_weight_kg"),
  maxVolumeM3: real("max_volume_m3"),

  originCountry: text("origin_country"),
  destinationCountry: text("destination_country"),
  originCities: text("origin_cities").array(),     // e.g. ['Jakarta','Surabaya']
  destinationCities: text("destination_cities").array(),

  vehicleTypes: text("vehicle_types").array(),     // ['Tronton','Fuso','CDD']
  driverCount: integer("driver_count"),
  certifications: text("certifications").array(),  // ['ISO9001','IATA','NVOCC']

  confidenceScore: real("confidence_score").default(1.0), // 0.0–1.0
  source: text("source").notNull().default("manual"),
  // 'manual'|'ai_inferred'|'form_submitted'|'job_history'
  inferredFromJobCount: integer("inferred_from_job_count"),

  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),

  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("vend_cap_vendor_idx").on(t.companyId, t.vendorId),
  index("vend_cap_service_idx").on(t.companyId, t.serviceType),
  index("vend_cap_active_idx").on(t.companyId, t.vendorId, t.isActive),
]);

export const insertVendorCapabilitySchema = createInsertSchema(vendorCapabilitiesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVendorCapability = z.infer<typeof insertVendorCapabilitySchema>;
export type VendorCapability = typeof vendorCapabilitiesTable.$inferSelect;

// ── 5. Vendor Document Registry ───────────────────────────────────────────────

export const VENDOR_DOC_TYPES = [
  // Legal
  "npwp", "nib", "siup", "siujpt", "pkp", "nppbkc", "akta_pendirian", "sk_kemenkumham",
  // Certifications
  "iso_9001", "iata", "nvocc", "sertifikat_k3", "insurance",
  // Transport
  "td_angkutan", "kir", "sio", "bpkb", "stnk",
  // Operational
  "pod", "invoice_template", "packing_list_template",
  // Other
  "business_license", "other",
] as const;

export type VendorDocType = (typeof VENDOR_DOC_TYPES)[number];

export const vendorDocumentRegistryTable = pgTable("vendor_document_registry", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  vendorId: integer("vendor_id").notNull(),

  documentType: text("document_type").notNull(),
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url"),
  objectPath: text("object_path"),
  mimeType: text("mime_type"),
  fileSizeBytes: integer("file_size_bytes"),

  sourceType: text("source_type").default("upload"),
  // 'upload'|'vendor_fulfillment'|'mini_form'|'rfq'|'portal'
  sourceId: integer("source_id"),

  expiryDate: date("expiry_date"),
  isCurrent: boolean("is_current").notNull().default(true),
  isVerified: boolean("is_verified").notNull().default(false),
  verifiedBy: text("verified_by"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  verificationNotes: text("verification_notes"),

  riskLevel: text("risk_level").default("low"),    // low|medium|high (if doc missing/expired)
  tags: text("tags").array(),
  notes: text("notes"),

  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  uploadedBy: text("uploaded_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("vend_doc_reg_vendor_idx").on(t.companyId, t.vendorId),
  index("vend_doc_reg_type_idx").on(t.companyId, t.vendorId, t.documentType),
  index("vend_doc_reg_current_idx").on(t.companyId, t.vendorId, t.isCurrent),
  index("vend_doc_expiry_idx").on(t.expiryDate),
]);

export const insertVendorDocumentRegistrySchema = createInsertSchema(vendorDocumentRegistryTable).omit({ id: true, createdAt: true });
export type InsertVendorDocumentRegistry = z.infer<typeof insertVendorDocumentRegistrySchema>;
export type VendorDocumentRegistry = typeof vendorDocumentRegistryTable.$inferSelect;

// ── 6. Vendor Memory Snapshots ────────────────────────────────────────────────
// AI-generated context block injected into IntentEngine.

export const vendorMemorySnapshotsTable = pgTable("vendor_memory_snapshots", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  vendorId: integer("vendor_id").notNull(),
  version: integer("version").notNull().default(1),
  snapshotType: text("snapshot_type").notNull().default("full"), // full|incremental

  generatedBy: text("generated_by").notNull().default("ai"),    // ai|manual|system
  model: text("model"),

  // Structured fields (for programmatic queries)
  topServiceTypes: text("top_service_types").array(),
  bestRoutes: text("best_routes").array(),
  activeJobsCount: integer("active_jobs_count").default(0),
  missingDocsList: text("missing_docs_list").array(),
  riskTier: text("risk_tier"),
  performanceGrade: text("performance_grade"),
  readinessScore: smallint("readiness_score"),
  responseTimeTier: text("response_time_tier"),   // fast|medium|slow
  priceTrend: text("price_trend"),                // increasing|stable|decreasing
  complianceStatus: text("compliance_status"),    // compliant|partial|incomplete|non_compliant
  avgPrice: numeric("avg_price", { precision: 14, scale: 2 }),
  recentIssues: text("recent_issues").array(),
  frequentServices: text("frequent_services").array(),

  // Full AI narrative (≤400 tokens)
  aiContextBlock: text("ai_context_block").notNull(),

  // Quality metadata
  tokenCount: integer("token_count"),
  sourceFulfillmentCount: integer("source_fulfillment_count"),
  sourceRfqCount: integer("source_rfq_count"),
  sourceInvoiceCount: integer("source_invoice_count"),

  // Freshness
  freshnessScore: smallint("freshness_score").notNull().default(100),
  isStale: boolean("is_stale").notNull().default(false),
  staleReason: text("stale_reason"),
  validUntil: timestamp("valid_until", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("vend_mem_snap_vendor_idx").on(t.companyId, t.vendorId),
  index("vend_mem_snap_stale_idx").on(t.companyId, t.vendorId, t.isStale),
  index("vend_mem_snap_created_idx").on(t.createdAt),
]);

export const insertVendorMemorySnapshotSchema = createInsertSchema(vendorMemorySnapshotsTable).omit({ id: true, createdAt: true });
export type InsertVendorMemorySnapshot = z.infer<typeof insertVendorMemorySnapshotSchema>;
export type VendorMemorySnapshot = typeof vendorMemorySnapshotsTable.$inferSelect;

// ── 7. Vendor Memory Events ───────────────────────────────────────────────────
// Audit trail for all memory-related mutations.

export const vendorMemoryEventsTable = pgTable("vendor_memory_events", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  vendorId: integer("vendor_id").notNull(),

  eventType: text("event_type").notNull(),
  // snapshot_generated | preference_created | preference_superseded | preference_deactivated
  // risk_assessed | document_registered | document_expired | document_verified
  // capability_updated | performance_refreshed | memory_refreshed | snapshot_stale
  // pricing_anomaly_detected

  actorId: text("actor_id"),
  actorType: text("actor_type").notNull().default("system"), // user|ai|system

  entityType: text("entity_type"),
  // vendor_preference|vendor_risk|vendor_memory_snapshot|vendor_document|vendor_capability
  entityId: integer("entity_id"),

  payload: jsonb("payload"),
  notes: text("notes"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("vend_mem_event_vendor_idx").on(t.companyId, t.vendorId),
  index("vend_mem_event_type_idx").on(t.eventType),
  index("vend_mem_event_created_idx").on(t.createdAt),
]);

export const insertVendorMemoryEventSchema = createInsertSchema(vendorMemoryEventsTable).omit({ id: true, createdAt: true });
export type InsertVendorMemoryEvent = z.infer<typeof insertVendorMemoryEventSchema>;
export type VendorMemoryEvent = typeof vendorMemoryEventsTable.$inferSelect;
