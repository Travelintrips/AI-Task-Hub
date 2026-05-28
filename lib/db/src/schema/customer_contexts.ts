import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const customerContextsTable = pgTable("customer_contexts", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  phone: text("phone").notNull(),
  name: text("name"),
  companyName: text("company_name"),
  frequentService: text("frequent_service"),
  specialNotes: text("special_notes"),
  previousIntents: text("previous_intents"),
  totalTasks: integer("total_tasks").notNull().default(0),
  lastActiveTaskId: integer("last_active_task_id"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("customer_ctx_phone_company_idx").on(t.phone, t.companyId),
  index("customer_ctx_phone_idx").on(t.phone),
]);

export const insertCustomerContextSchema = createInsertSchema(customerContextsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCustomerContext = z.infer<typeof insertCustomerContextSchema>;
export type CustomerContext = typeof customerContextsTable.$inferSelect;
