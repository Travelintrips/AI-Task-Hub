import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const documentAuditsTable = pgTable("document_audits", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull(),
  auditStatus: text("audit_status").notNull().default("pending"),
  missingFields: text("missing_fields").array().notNull().default([]),
  matchedFields: text("matched_fields").array().notNull().default([]),
  mismatchFields: text("mismatch_fields").array().notNull().default([]),
  unclearFields: text("unclear_fields").array().notNull().default([]),
  aiRecommendation: text("ai_recommendation"),
  adminReviewStatus: text("admin_review_status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDocumentAuditSchema = createInsertSchema(documentAuditsTable).omit({ id: true, createdAt: true });
export type InsertDocumentAudit = z.infer<typeof insertDocumentAuditSchema>;
export type DocumentAudit = typeof documentAuditsTable.$inferSelect;
