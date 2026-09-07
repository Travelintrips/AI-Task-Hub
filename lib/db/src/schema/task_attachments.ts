import { pgTable, text, serial, timestamp, integer, boolean, date, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const taskAttachmentsTable = pgTable("task_attachments", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull(),
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url"),
  objectPath: text("object_path"),
  mimeType: text("mime_type"),
  fileSize: integer("file_size"),
  fileType: text("file_type"),
  documentType: text("document_type"),
  ocrStatus: text("ocr_status").default("pending"),
  extractedText: text("extracted_text"),
  extractedFields: jsonb("extracted_fields"),
  uploadedBy: text("uploaded_by"),

  // ── Sprint 5A: Customer memory fields ─────────────────────────────────────
  customerId: integer("customer_id"),      // backfilled from ai_tasks.customer_id
  documentExpiry: date("document_expiry"), // for docs with expiry (NPWP, permits, etc.)
  isReusable: boolean("is_reusable").notNull().default(false),
  reuseNotes: text("reuse_notes"),         // e.g. "Valid until Mar 2026"

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("task_attach_task_id_idx").on(t.taskId),
  index("task_attach_ocr_status_idx").on(t.ocrStatus),
  index("task_attach_customer_id_idx").on(t.customerId),
  index("task_attach_reusable_idx").on(t.customerId, t.isReusable),
]);

export const insertTaskAttachmentSchema = createInsertSchema(taskAttachmentsTable).omit({ id: true, createdAt: true });
export type InsertTaskAttachment = z.infer<typeof insertTaskAttachmentSchema>;
export type TaskAttachment = typeof taskAttachmentsTable.$inferSelect;
