import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const customersTable = pgTable("customers", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  companyName: text("company_name").notNull(),
  picName: text("pic_name"),
  whatsapp: text("whatsapp"),
  email: text("email"),
  npwp: text("npwp"),
  address: text("address"),
  notes: text("notes"),
  totalTasks: integer("total_tasks").notNull().default(0),
  totalDocuments: integer("total_documents").notNull().default(0),
  aiSummary: text("ai_summary"),
  lastTaskAt: timestamp("last_task_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("customers_company_idx").on(t.companyId),
  index("customers_whatsapp_idx").on(t.whatsapp),
  index("customers_company_name_idx").on(t.companyName),
]);

export const insertCustomerSchema = createInsertSchema(customersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type Customer = typeof customersTable.$inferSelect;
