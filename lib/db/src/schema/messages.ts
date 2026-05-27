import { pgTable, text, serial, timestamp, boolean, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const whatsappMessagesTable = pgTable("whatsapp_messages", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  from: text("from").notNull(),
  senderPhone: text("sender_phone"),
  senderName: text("sender_name"),
  body: text("body").notNull(),
  messageText: text("message_text"),
  messageType: text("message_type").notNull().default("text"),
  direction: text("direction").notNull().default("inbound"),
  attachmentUrl: text("attachment_url"),
  rawPayload: jsonb("raw_payload"),
  timestamp: text("timestamp").notNull(),
  processed: boolean("processed").notNull().default(false),
  aiProcessed: boolean("ai_processed").notNull().default(false),
  detectedIntent: text("detected_intent"),
  taskId: integer("task_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertWhatsappMessageSchema = createInsertSchema(whatsappMessagesTable).omit({ id: true, createdAt: true });
export type InsertWhatsappMessage = z.infer<typeof insertWhatsappMessageSchema>;
export type WhatsappMessage = typeof whatsappMessagesTable.$inferSelect;
