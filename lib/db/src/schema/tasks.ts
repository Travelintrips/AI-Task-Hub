import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tasksTable = pgTable("tasks", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("pending"),
  priority: text("priority").notNull().default("medium"),
  assigneeId: integer("assignee_id"),
  assignedRole: text("assigned_role"),
  assignedDivision: text("assigned_division"),
  assignedVendor: text("assigned_vendor"),
  customerName: text("customer_name"),
  sourceMessageId: integer("source_message_id"),
  dueDate: text("due_date"),
  tags: text("tags").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("tasks_status_idx").on(t.status),
  index("tasks_assignee_idx").on(t.assigneeId),
  index("tasks_priority_idx").on(t.priority),
  index("tasks_created_at_idx").on(t.createdAt),
]);

export const insertTaskSchema = createInsertSchema(tasksTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasksTable.$inferSelect;
