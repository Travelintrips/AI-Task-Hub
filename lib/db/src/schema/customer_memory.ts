/**
 * Sprint 5A — Customer Memory Center
 *
 * New tables:
 *   customer_preferences       — learned/explicit preferences (with status lifecycle)
 *   customer_risk_assessments  — immutable risk records (new row per change)
 *   customer_memory_snapshots  — AI-generated context block injected into IntentEngine
 *   customer_memory_events     — audit trail for all memory mutations
 *   customer_document_registry — reusable docs across tasks (Phase 4)
 *
 * No financial aggregates stored here.
 * Use the customer_aggregates_view (defined in migration SQL) for financial data.
 */

import {
  pgTable, text, serial, timestamp, boolean, integer, numeric, index, date, jsonb, smallint,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ── 1. Customer Preferences ───────────────────────────────────────────────────

export const customerPreferencesTable = pgTable("customer_preferences", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  customerId: integer("customer_id").notNull(),

  category: text("category").notNull(), // communication|service|document|notification
  key: text("key").notNull(),           // e.g. preferred_contact_time, frequent_service
  value: text("value").notNull(),
  valueJson: jsonb("value_json"),       // for complex values (arrays, objects)

  // Lifecycle status
  status: text("status").notNull().default("active"), // active|inactive|superseded

  // Provenance
  source: text("source").notNull().default("manual"), // manual|ai_inferred
  confidence: numeric("confidence", { precision: 4, scale: 2 }), // 0.00-1.00 for ai_inferred
  inferredFromCount: integer("inferred_from_count").default(1),

  createdBy: text("created_by"),          // user id or 'ai'
  lastConfirmedAt: timestamp("last_confirmed_at", { withTimezone: true }),
  supersededAt: timestamp("superseded_at", { withTimezone: true }),
  supersededBy: integer("superseded_by"), // id of the new preference that replaced this

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("cust_pref_customer_idx").on(t.companyId, t.customerId),
  index("cust_pref_category_key_idx").on(t.companyId, t.customerId, t.category, t.key),
  index("cust_pref_status_idx").on(t.status),
]);

export const insertCustomerPreferenceSchema = createInsertSchema(customerPreferencesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCustomerPreference = z.infer<typeof insertCustomerPreferenceSchema>;
export type CustomerPreference = typeof customerPreferencesTable.$inferSelect;

// ── 2. Customer Risk Assessments (IMMUTABLE) ──────────────────────────────────
// Never update-in-place. New assessment → new row. Previous isActive becomes false.

export const customerRiskAssessmentsTable = pgTable("customer_risk_assessments", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  customerId: integer("customer_id").notNull(),

  assessedAt: timestamp("assessed_at", { withTimezone: true }).notNull().defaultNow(),
  assessedBy: text("assessed_by").notNull(), // user id | 'ai'

  riskScore: integer("risk_score").notNull(),   // 0-100 (higher = more risky)
  tier: text("tier").notNull(),                 // low|medium|high|blocked
  previousTier: text("previous_tier"),          // tier before this assessment

  creditLimit: numeric("credit_limit", { precision: 14, scale: 2 }),

  factors: jsonb("factors"),          // [{"code":"late_payment","weight":30,"detail":"..."}]
  recommendations: text("recommendations"),
  notes: text("notes"),

  expiresAt: date("expires_at"),      // when this assessment should be reviewed

  // IMMUTABLE lifecycle — only isActive can be flipped (to false when superseded)
  isActive: boolean("is_active").notNull().default(true),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  archivedByAssessmentId: integer("archived_by_assessment_id"), // the new assessment that replaced this
}, (t) => [
  index("cust_risk_customer_idx").on(t.companyId, t.customerId),
  index("cust_risk_active_idx").on(t.companyId, t.customerId, t.isActive),
  index("cust_risk_assessed_at_idx").on(t.assessedAt),
]);

export const insertCustomerRiskSchema = createInsertSchema(customerRiskAssessmentsTable).omit({ id: true, assessedAt: true, archivedAt: true });
export type InsertCustomerRisk = z.infer<typeof insertCustomerRiskSchema>;
export type CustomerRiskAssessment = typeof customerRiskAssessmentsTable.$inferSelect;

// ── 3. Customer Memory Snapshots ──────────────────────────────────────────────
// AI-generated context block injected into IntentEngine system prompt.

export const customerMemorySnapshotsTable = pgTable("customer_memory_snapshots", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  customerId: integer("customer_id").notNull(),
  version: integer("version").notNull().default(1),
  snapshotType: text("snapshot_type").notNull().default("full"), // full|incremental

  generatedBy: text("generated_by").notNull().default("ai"), // ai|manual
  model: text("model"),
  promptVersionId: integer("prompt_version_id"),

  // Structured fields (for programmatic use)
  lastNIntents: text("last_n_intents").array(),        // last 5 intents
  lastTaskSummary: text("last_task_summary"),
  openTasksCount: integer("open_tasks_count").default(0),
  missingDocsList: text("missing_docs_list").array(),
  frequentServices: text("frequent_services").array(),
  riskTier: text("risk_tier"),
  sentimentTrend: text("sentiment_trend"), // improving|stable|declining
  preferredChannel: text("preferred_channel"),

  // Full AI-generated narrative (≤400 tokens, injected into system prompt)
  aiContextBlock: text("ai_context_block").notNull(),

  // Quality metadata
  tokenCount: integer("token_count"),
  sourceTaskCount: integer("source_task_count"),
  sourceMsgCount: integer("source_msg_count"),

  // Freshness — 0 (stale) to 100 (perfectly fresh)
  freshnessScore: smallint("freshness_score").notNull().default(100),

  isStale: boolean("is_stale").notNull().default(false),
  staleReason: text("stale_reason"),
  validUntil: timestamp("valid_until", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("cust_mem_snapshot_customer_idx").on(t.companyId, t.customerId),
  index("cust_mem_snapshot_stale_idx").on(t.companyId, t.customerId, t.isStale),
  index("cust_mem_snapshot_created_idx").on(t.createdAt),
]);

export const insertCustomerMemorySnapshotSchema = createInsertSchema(customerMemorySnapshotsTable).omit({ id: true, createdAt: true });
export type InsertCustomerMemorySnapshot = z.infer<typeof insertCustomerMemorySnapshotSchema>;
export type CustomerMemorySnapshot = typeof customerMemorySnapshotsTable.$inferSelect;

// ── 4. Customer Memory Events ─────────────────────────────────────────────────
// Audit trail for all memory-related mutations.

export const customerMemoryEventsTable = pgTable("customer_memory_events", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  customerId: integer("customer_id").notNull(),

  eventType: text("event_type").notNull(),
  // snapshot_generated | preference_inferred | preference_updated | preference_superseded
  // risk_assessed | document_registered | memory_refreshed | snapshot_stale

  actorId: text("actor_id"),      // user id | 'ai' | 'system'
  actorType: text("actor_type").notNull().default("system"), // user|ai|system

  entityType: text("entity_type"),  // customer_preference|customer_risk|customer_memory_snapshot|customer_document
  entityId: integer("entity_id"),

  payload: jsonb("payload"),        // event-specific data: {key, oldValue, newValue, ...}
  notes: text("notes"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("cust_mem_event_customer_idx").on(t.companyId, t.customerId),
  index("cust_mem_event_type_idx").on(t.eventType),
  index("cust_mem_event_created_idx").on(t.createdAt),
]);

export const insertCustomerMemoryEventSchema = createInsertSchema(customerMemoryEventsTable).omit({ id: true, createdAt: true });
export type InsertCustomerMemoryEvent = z.infer<typeof insertCustomerMemoryEventSchema>;
export type CustomerMemoryEvent = typeof customerMemoryEventsTable.$inferSelect;

// ── 5. Customer Document Registry ─────────────────────────────────────────────
// Reusable documents identified across tasks. (Phase 4)

export const customerDocumentRegistryTable = pgTable("customer_document_registry", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  customerId: integer("customer_id").notNull(),

  documentType: text("document_type").notNull(), // npwp|bl|coa|surat_kuasa|invoice|packing_list|...
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url"),
  objectPath: text("object_path"),
  mimeType: text("mime_type"),
  fileSize: integer("file_size"),

  sourceTaskId: integer("source_task_id"),       // which task this came from
  sourceAttachmentId: integer("source_attachment_id"),

  expiryDate: date("expiry_date"),
  isCurrent: boolean("is_current").notNull().default(true),
  isVerified: boolean("is_verified").notNull().default(false),
  verifiedBy: text("verified_by"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),

  tags: text("tags").array(),
  notes: text("notes"),

  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  uploadedBy: text("uploaded_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("cust_doc_reg_customer_idx").on(t.companyId, t.customerId),
  index("cust_doc_reg_type_idx").on(t.companyId, t.customerId, t.documentType),
  index("cust_doc_reg_current_idx").on(t.companyId, t.customerId, t.isCurrent),
]);

export const insertCustomerDocumentRegistrySchema = createInsertSchema(customerDocumentRegistryTable).omit({ id: true, createdAt: true });
export type InsertCustomerDocumentRegistry = z.infer<typeof insertCustomerDocumentRegistrySchema>;
export type CustomerDocumentRegistry = typeof customerDocumentRegistryTable.$inferSelect;
