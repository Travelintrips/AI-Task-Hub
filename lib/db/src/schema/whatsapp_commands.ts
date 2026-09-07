/**
 * Sprint 10A-1 — WhatsApp First Operations
 *
 * Tables:
 *   whatsapp_commands       — command registry (enabled/disabled per user_type)
 *   whatsapp_command_logs   — audit trail: who executed what, result, duration
 *   whatsapp_usage_metrics  — daily aggregated usage per role/command
 */

import {
  pgTable, text, serial, timestamp, integer, boolean, real, jsonb, index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ── Supported user types ────────────────────────────────────────────────────────

export const WA_USER_TYPES = [
  "customer", "vendor", "driver", "staff",
  "supervisor", "company_admin", "owner", "super_admin",
] as const;
export type WaUserType = (typeof WA_USER_TYPES)[number];

// ── 1. whatsapp_commands ────────────────────────────────────────────────────────

export const whatsappCommandsTable = pgTable("whatsapp_commands", {
  id: serial("id").primaryKey(),

  command: text("command").notNull(),
  description: text("description").notNull(),
  userType: text("user_type").notNull(),
  enabled: boolean("enabled").notNull().default(true),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("wa_commands_user_type_idx").on(t.userType),
  index("wa_commands_enabled_idx").on(t.enabled),
]);

export const insertWhatsappCommandSchema = createInsertSchema(whatsappCommandsTable).omit({ id: true, createdAt: true });
export type InsertWhatsappCommand = z.infer<typeof insertWhatsappCommandSchema>;
export type WhatsappCommand = typeof whatsappCommandsTable.$inferSelect;

// ── 2. whatsapp_command_logs ────────────────────────────────────────────────────

export const whatsappCommandLogsTable = pgTable("whatsapp_command_logs", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),

  phone: text("phone").notNull(),
  role: text("role").notNull(),
  command: text("command").notNull(),
  args: text("args"),
  result: text("result").notNull().default("ok"),
  replyPreview: text("reply_preview"),
  durationMs: integer("duration_ms"),

  executedAt: timestamp("executed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("wa_cmd_logs_phone_idx").on(t.phone),
  index("wa_cmd_logs_command_idx").on(t.command),
  index("wa_cmd_logs_role_idx").on(t.role),
  index("wa_cmd_logs_company_idx").on(t.companyId),
  index("wa_cmd_logs_executed_idx").on(t.executedAt),
]);

export const insertWhatsappCommandLogSchema = createInsertSchema(whatsappCommandLogsTable).omit({ id: true, executedAt: true });
export type InsertWhatsappCommandLog = z.infer<typeof insertWhatsappCommandLogSchema>;
export type WhatsappCommandLog = typeof whatsappCommandLogsTable.$inferSelect;

// ── 3. whatsapp_usage_metrics ───────────────────────────────────────────────────

export const whatsappUsageMetricsTable = pgTable("whatsapp_usage_metrics", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),

  metricDate: text("metric_date").notNull(),
  role: text("role").notNull(),
  command: text("command").notNull(),
  execCount: integer("exec_count").notNull().default(0),
  uniquePhones: integer("unique_phones").notNull().default(0),
  successCount: integer("success_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  avgDurationMs: real("avg_duration_ms"),

  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("wa_usage_date_idx").on(t.metricDate),
  index("wa_usage_role_idx").on(t.role),
  index("wa_usage_company_date_idx").on(t.companyId, t.metricDate),
]);

export const insertWhatsappUsageMetricSchema = createInsertSchema(whatsappUsageMetricsTable).omit({ id: true, updatedAt: true });
export type InsertWhatsappUsageMetric = z.infer<typeof insertWhatsappUsageMetricSchema>;
export type WhatsappUsageMetric = typeof whatsappUsageMetricsTable.$inferSelect;
