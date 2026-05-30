import { pgTable, text, serial, timestamp, integer, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const followUpLogsTable = pgTable("follow_up_logs", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull(),
  companyId: text("company_id").notNull().default("default"),
  customerPhone: text("customer_phone"),
  customerName: text("customer_name"),
  followUpNumber: integer("follow_up_number").notNull().default(1),
  message: text("message").notNull(),
  channel: text("channel").notNull().default("whatsapp"),
  isSuccess: boolean("is_success").notNull().default(false),
  errorMessage: text("error_message"),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("follow_up_task_idx").on(t.taskId),
  index("follow_up_company_idx").on(t.companyId),
]);

export const insertFollowUpLogSchema = createInsertSchema(followUpLogsTable).omit({ id: true });
export type InsertFollowUpLog = z.infer<typeof insertFollowUpLogSchema>;
export type FollowUpLog = typeof followUpLogsTable.$inferSelect;
