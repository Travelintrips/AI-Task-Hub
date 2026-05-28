import { pgTable, text, serial, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const documentAuditsTable = pgTable("document_audits", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull(),
  auditStatus: text("audit_status").notNull().default("pending"),
  completeFields: text("complete_fields").array().notNull().default([]),
  missingFields: text("missing_fields").array().notNull().default([]),
  mismatchFields: text("mismatch_fields").array().notNull().default([]),
  unclearFields: text("unclear_fields").array().notNull().default([]),
  recommendation: text("recommendation"),
  nextAction: text("next_action"),
  auditDetail: jsonb("audit_detail"),
  crossDocDetail: jsonb("cross_doc_detail"),
  crossDocWarnings: text("cross_doc_warnings").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("doc_audits_task_id_idx").on(t.taskId),
  index("doc_audits_status_idx").on(t.auditStatus),
]);

export const insertDocumentAuditSchema = createInsertSchema(documentAuditsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDocumentAudit = z.infer<typeof insertDocumentAuditSchema>;
export type DocumentAudit = typeof documentAuditsTable.$inferSelect;
