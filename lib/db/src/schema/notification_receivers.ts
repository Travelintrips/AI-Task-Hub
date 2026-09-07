import { pgTable, text, serial, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const notificationReceiversTable = pgTable("notification_receivers", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  category: text("category").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertNotificationReceiverSchema = createInsertSchema(notificationReceiversTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertNotificationReceiver = z.infer<typeof insertNotificationReceiverSchema>;
export type NotificationReceiver = typeof notificationReceiversTable.$inferSelect;
