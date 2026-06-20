import { pgTable, text, serial, timestamp, boolean, integer, jsonb, real, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const whatsappMessagesTable = pgTable("whatsapp_messages", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  wamid: text("wamid"),
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
  customerId: integer("customer_id"),
  aiConfidence: real("ai_confidence"),
  sentiment: text("sentiment"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("wa_messages_sender_phone_idx").on(t.senderPhone),
  index("wa_messages_from_idx").on(t.from),
  index("wa_messages_task_id_idx").on(t.taskId),
  index("wa_messages_customer_id_idx").on(t.customerId),
  index("wa_messages_processed_idx").on(t.processed),
  index("wa_messages_created_at_idx").on(t.createdAt),
  index("wa_messages_wamid_idx").on(t.wamid),
]);

export const insertWhatsappMessageSchema = createInsertSchema(whatsappMessagesTable).omit({ id: true, createdAt: true });
export type InsertWhatsappMessage = z.infer<typeof insertWhatsappMessageSchema>;
export type WhatsappMessage = typeof whatsappMessagesTable.$inferSelect;
