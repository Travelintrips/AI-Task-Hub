import { pgTable, text, serial, timestamp, boolean, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const intentMasterTable = pgTable("intent_master", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  intentCode: text("intent_code").notNull(),
  intentName: text("intent_name").notNull(),
  category: text("category"),
  description: text("description"),
  suggestedCategory: text("suggested_category"),
  suggestedDivision: text("suggested_division"),
  suggestedPriority: text("suggested_priority").default("medium"),
  slaHours: integer("sla_hours"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("intent_master_company_idx").on(t.companyId),
  index("intent_master_code_idx").on(t.intentCode),
]);

export const insertIntentMasterSchema = createInsertSchema(intentMasterTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertIntentMaster = z.infer<typeof insertIntentMasterSchema>;
export type IntentMaster = typeof intentMasterTable.$inferSelect;
