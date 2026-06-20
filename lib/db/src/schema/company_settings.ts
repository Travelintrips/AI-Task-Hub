import { pgTable, text, serial, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const companySettingsTable = pgTable("company_settings", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().unique().default("default"),
  companyName: text("company_name"),
  companyPhone: text("company_phone"),
  companyAddress: text("company_address"),
  companyEmail: text("company_email"),
  industryType: text("industry_type"),
  logoUrl: text("logo_url"),
  timezone: text("timezone").default("Asia/Jakarta"),
  // WhatsApp / messaging
  fonnteToken: text("fonnte_token"),
  whatsappPhoneNumberId: text("whatsapp_phone_number_id"),
  whatsappToken: text("whatsapp_token"),
  whatsappWebhookVerifyToken: text("whatsapp_webhook_verify_token"),
  // WA message templates
  templateMissingDoc: text("template_missing_doc"),
  templateNewTask: text("template_new_task"),
  templateAssignment: text("template_assignment"),
  templateProgress: text("template_progress"),
  templateApproval: text("template_approval"),
  templateCompleted: text("template_completed"),
  // AI settings
  openaiModel: text("openai_model").default("gpt-4o-mini"),
  aiEnabled: boolean("ai_enabled").notNull().default(true),
  // Auto-dispatcher settings
  dispatcherEnabled: boolean("dispatcher_enabled").notNull().default(false),
  autoAssignEnabled: boolean("auto_assign_enabled").notNull().default(false),
  // Follow-up settings
  followUpEnabled: boolean("follow_up_enabled").notNull().default(true),
  followUpIntervalHours: integer("follow_up_interval_hours").notNull().default(24),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCompanySettingsSchema = createInsertSchema(companySettingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCompanySettings = z.infer<typeof insertCompanySettingsSchema>;
export type CompanySettings = typeof companySettingsTable.$inferSelect;
