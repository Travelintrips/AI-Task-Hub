import { pgTable, text, serial, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const INTAKE_STATUSES = ["collecting", "ready_for_task", "submitted", "cancelled", "expired"] as const;
export type IntakeStatus = (typeof INTAKE_STATUSES)[number];

export const intakeSessionsTable = pgTable("conversation_intake_sessions", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  phone: text("phone").notNull(),
  customerId: text("customer_id"),

  intentCode: text("intent_code").notNull(),
  intentName: text("intent_name"),
  category: text("category"),

  status: text("status").notNull().default("collecting"),

  collectedFields: jsonb("collected_fields").notNull().default({}),
  missingFields: jsonb("missing_fields").notNull().default([]),
  requiredDocuments: jsonb("required_documents").notNull().default([]),
  uploadedDocuments: jsonb("uploaded_documents").notNull().default([]),

  lastQuestion: text("last_question"),
  lastMessage: text("last_message"),

  taskId: text("task_id"),

  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("intake_sessions_phone_idx").on(t.phone),
  index("intake_sessions_company_idx").on(t.companyId),
  index("intake_sessions_status_idx").on(t.status),
  index("intake_sessions_phone_status_idx").on(t.phone, t.status),
  index("intake_sessions_intent_idx").on(t.intentCode),
]);

export const insertIntakeSessionSchema = createInsertSchema(intakeSessionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertIntakeSession = z.infer<typeof insertIntakeSessionSchema>;
export type IntakeSession = typeof intakeSessionsTable.$inferSelect;
