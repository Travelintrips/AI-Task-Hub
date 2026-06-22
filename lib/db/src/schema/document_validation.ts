import { pgTable, text, serial, timestamp, integer, jsonb, numeric, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─── document_intake_audits ───────────────────────────────────────────────────

export const VALIDATION_STATUSES = ["valid", "incomplete", "invalid", "needs_review"] as const;
export type ValidationStatus = (typeof VALIDATION_STATUSES)[number];

export const documentIntakeAuditsTable = pgTable("document_intake_audits", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  taskId: integer("task_id"),
  intakeSessionId: integer("intake_session_id"),
  customerId: integer("customer_id"),
  vendorId: integer("vendor_id"),
  fleetUnitId: integer("fleet_unit_id"),

  documentType: text("document_type").notNull(),
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(),
  objectPath: text("object_path"),

  extractedFields: jsonb("extracted_fields").default({}),
  requiredFields: jsonb("required_fields").default([]),
  missingFields: text("missing_fields").array().notNull().default([]),

  validationStatus: text("validation_status").notNull().default("needs_review"),
  confidenceScore: numeric("confidence_score", { precision: 5, scale: 4 }).notNull().default("0"),
  issueSummary: text("issue_summary"),
  aiNotes: text("ai_notes"),

  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("doc_intake_audits_company_idx").on(t.companyId),
  index("doc_intake_audits_task_idx").on(t.taskId),
  index("doc_intake_audits_session_idx").on(t.intakeSessionId),
  index("doc_intake_audits_status_idx").on(t.validationStatus),
  index("doc_intake_audits_type_idx").on(t.documentType),
]);

export const insertDocumentIntakeAuditSchema = createInsertSchema(documentIntakeAuditsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDocumentIntakeAudit = z.infer<typeof insertDocumentIntakeAuditSchema>;
export type DocumentIntakeAudit = typeof documentIntakeAuditsTable.$inferSelect;

// ─── document_validation_rules ────────────────────────────────────────────────

export const documentValidationRulesTable = pgTable("document_validation_rules", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  documentType: text("document_type").notNull(),
  intentCode: text("intent_code"),
  requiredFields: text("required_fields").array().notNull().default([]),
  optionalFields: text("optional_fields").array().notNull().default([]),
  validationPrompt: text("validation_prompt"),
  isActive: text("is_active").notNull().default("true"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("doc_validation_rules_company_idx").on(t.companyId),
  index("doc_validation_rules_type_idx").on(t.documentType),
]);

export const insertDocumentValidationRuleSchema = createInsertSchema(documentValidationRulesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDocumentValidationRule = z.infer<typeof insertDocumentValidationRuleSchema>;
export type DocumentValidationRule = typeof documentValidationRulesTable.$inferSelect;
