import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const AI_TASK_STATUSES = [
  "new_inquiry",
  "waiting_documents",
  "documents_received",
  "audit_in_progress",
  "missing_data",
  "ready_for_review",
  "assigned",
  "in_progress",
  "waiting_customer",
  "waiting_vendor",
  "quotation_ready",
  "approved_by_customer",
  "completed",
  "cancelled",
] as const;

export type AiTaskStatus = (typeof AI_TASK_STATUSES)[number];

export const aiTasksTable = pgTable("ai_tasks", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  taskNumber: text("task_number"),
  source: text("source").notNull().default("manual"),
  customerName: text("customer_name"),
  customerPhone: text("customer_phone"),
  title: text("title").notNull(),
  description: text("description"),
  category: text("category"),
  division: text("division"),
  priority: text("priority").notNull().default("medium"),
  status: text("status").notNull().default("new_inquiry"),
  assignedTo: text("assigned_to"),
  assignedRole: text("assigned_role"),
  assignedDivision: text("assigned_division"),
  assignedVendor: text("assigned_vendor"),
  driverName: text("driver_name"),
  driverPhone: text("driver_phone"),
  plateNumber: text("plate_number"),
  quotationAmount: text("quotation_amount"),
  quotationNotes: text("quotation_notes"),
  dueDate: timestamp("due_date", { withTimezone: true }),
  aiSummary: text("ai_summary"),
  aiIntent: text("ai_intent"),
  missingData: text("missing_data"),
  requiredAction: text("required_action"),
  adminNotes: text("admin_notes"),
  aiConfidenceScore: text("ai_confidence_score"),
  customerSentiment: text("customer_sentiment"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("ai_tasks_company_status_idx").on(t.companyId, t.status),
  index("ai_tasks_customer_phone_idx").on(t.customerPhone),
  index("ai_tasks_status_idx").on(t.status),
  index("ai_tasks_category_idx").on(t.category),
  index("ai_tasks_division_idx").on(t.division),
  index("ai_tasks_created_at_idx").on(t.createdAt),
]);

export const insertAiTaskSchema = createInsertSchema(aiTasksTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiTask = z.infer<typeof insertAiTaskSchema>;
export type AiTask = typeof aiTasksTable.$inferSelect;
