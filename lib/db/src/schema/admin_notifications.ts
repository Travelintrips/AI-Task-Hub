import { pgTable, text, serial, timestamp, integer, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const adminNotificationsTable = pgTable("admin_notifications", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  taskId: integer("task_id"),
  customerPhone: text("customer_phone"),
  customerName: text("customer_name"),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("admin_notif_company_idx").on(t.companyId),
  index("admin_notif_is_read_idx").on(t.isRead),
  index("admin_notif_company_read_idx").on(t.companyId, t.isRead),
]);

export const insertAdminNotificationSchema = createInsertSchema(adminNotificationsTable).omit({ id: true, createdAt: true });
export type InsertAdminNotification = z.infer<typeof insertAdminNotificationSchema>;
export type AdminNotification = typeof adminNotificationsTable.$inferSelect;
