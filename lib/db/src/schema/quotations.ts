import { pgTable, text, serial, timestamp, integer, real, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const QUOTATION_STATUSES = ["draft", "sent", "accepted", "rejected"] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];

export const quotationsTable = pgTable("quotations", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  quotationNumber: text("quotation_number"),
  taskId: integer("task_id"),
  customerId: integer("customer_id"),
  customerName: text("customer_name"),
  customerPhone: text("customer_phone"),
  title: text("title").notNull(),
  description: text("description"),
  freightCost: real("freight_cost").default(0),
  customsCost: real("customs_cost").default(0),
  truckingCost: real("trucking_cost").default(0),
  handlingCost: real("handling_cost").default(0),
  otherCharges: real("other_charges").default(0),
  totalAmount: real("total_amount").default(0),
  currency: text("currency").notNull().default("IDR"),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  status: text("status").notNull().default("draft"),
  notes: text("notes"),
  aiGenerated: text("ai_generated"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("quotations_company_idx").on(t.companyId),
  index("quotations_task_idx").on(t.taskId),
  index("quotations_status_idx").on(t.status),
  index("quotations_customer_idx").on(t.customerId),
]);

export const insertQuotationSchema = createInsertSchema(quotationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertQuotation = z.infer<typeof insertQuotationSchema>;
export type Quotation = typeof quotationsTable.$inferSelect;
