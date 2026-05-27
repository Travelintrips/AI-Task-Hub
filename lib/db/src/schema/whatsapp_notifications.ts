import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const whatsappNotificationsTable = pgTable("whatsapp_notifications", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id"),
  companyId: text("company_id").notNull().default("default"),
  recipientPhone: text("recipient_phone").notNull(),
  recipientType: text("recipient_type").notNull().default("customer"),
  templateName: text("template_name"),
  messageText: text("message_text").notNull(),
  status: text("status").notNull().default("pending"),
  externalMessageId: text("external_message_id"),
  errorMessage: text("error_message"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertWhatsappNotificationSchema = createInsertSchema(whatsappNotificationsTable).omit({ id: true, createdAt: true });
export type InsertWhatsappNotification = z.infer<typeof insertWhatsappNotificationSchema>;
export type WhatsappNotification = typeof whatsappNotificationsTable.$inferSelect;
