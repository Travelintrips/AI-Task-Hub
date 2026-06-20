import { pgTable, text, serial, timestamp, boolean, integer, real, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const keywordRulesTable = pgTable("keyword_rules", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  keyword: text("keyword").notNull(),
  intentCode: text("intent_code").notNull(),
  weight: real("weight").notNull().default(1.0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("keyword_rules_company_idx").on(t.companyId),
  index("keyword_rules_intent_idx").on(t.intentCode),
]);

export const insertKeywordRuleSchema = createInsertSchema(keywordRulesTable).omit({ id: true, createdAt: true });
export type InsertKeywordRule = z.infer<typeof insertKeywordRuleSchema>;
export type KeywordRule = typeof keywordRulesTable.$inferSelect;
