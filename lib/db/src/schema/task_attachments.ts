import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTaskAttachmentSchema = createInsertSchema(taskAttachmentsTable).omit({ id: true, createdAt: true });
export type InsertTaskAttachment = z.infer<typeof insertTaskAttachmentSchema>;
export type TaskAttachment = typeof taskAttachmentsTable.$inferSelect;
