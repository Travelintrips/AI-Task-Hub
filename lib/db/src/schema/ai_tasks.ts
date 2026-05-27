import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

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
  status: text("status").notNull().default("pending"),
  assignedTo: text("assigned_to"),
  assignedRole: text("assigned_role"),
  dueDate: timestamp("due_date", { withTimezone: true }),
  aiSummary: text("ai_summary"),
  aiIntent: text("ai_intent"),
  missingData: text("missing_data"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiTaskSchema = createInsertSchema(aiTasksTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiTask = z.infer<typeof insertAiTaskSchema>;
export type AiTask = typeof aiTasksTable.$inferSelect;
