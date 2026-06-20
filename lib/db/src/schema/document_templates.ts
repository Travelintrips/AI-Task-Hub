import { pgTable, text, serial, timestamp, boolean, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const documentTemplatesTable = pgTable("document_templates", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  name: text("name").notNull(),
  category: text("category"),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("document_templates_company_idx").on(t.companyId),
]);

export const documentTemplateFieldsTable = pgTable("document_template_fields", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull(),
  documentName: text("document_name").notNull(),
  documentType: text("document_type"),
  isRequired: boolean("is_required").notNull().default(true),
  description: text("description"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("document_template_fields_template_idx").on(t.templateId),
]);

export const insertDocumentTemplateSchema = createInsertSchema(documentTemplatesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertDocumentTemplateFieldSchema = createInsertSchema(documentTemplateFieldsTable).omit({ id: true, createdAt: true });
export type InsertDocumentTemplate = z.infer<typeof insertDocumentTemplateSchema>;
export type InsertDocumentTemplateField = z.infer<typeof insertDocumentTemplateFieldSchema>;
export type DocumentTemplate = typeof documentTemplatesTable.$inferSelect;
export type DocumentTemplateField = typeof documentTemplateFieldsTable.$inferSelect;
