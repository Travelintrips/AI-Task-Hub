import { pgTable, text, serial, timestamp, boolean, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const dataTemplatesTable = pgTable("data_templates", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  intentCode: text("intent_code"),
  name: text("name").notNull(),
  category: text("category"),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("data_templates_company_idx").on(t.companyId),
  index("data_templates_intent_idx").on(t.intentCode),
  index("data_templates_category_idx").on(t.category),
]);

export const dataTemplateFieldsTable = pgTable("data_template_fields", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull(),
  fieldName: text("field_name").notNull(),
  fieldLabel: text("field_label").notNull(),
  fieldType: text("field_type").notNull().default("text"),
  isRequired: boolean("is_required").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  helpText: text("help_text"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("data_template_fields_template_idx").on(t.templateId),
]);

export const insertDataTemplateSchema = createInsertSchema(dataTemplatesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertDataTemplateFieldSchema = createInsertSchema(dataTemplateFieldsTable).omit({ id: true, createdAt: true });
export type InsertDataTemplate = z.infer<typeof insertDataTemplateSchema>;
export type InsertDataTemplateField = z.infer<typeof insertDataTemplateFieldSchema>;
export type DataTemplate = typeof dataTemplatesTable.$inferSelect;
export type DataTemplateField = typeof dataTemplateFieldsTable.$inferSelect;
