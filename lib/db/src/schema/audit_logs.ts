import { pgTable, text, serial, timestamp, integer, index, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const auditLogsTable = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  userId: integer("user_id"),
  userName: text("user_name"),
  userEmail: text("user_email"),
  action: text("action").notNull(),
  module: text("module").notNull(),
  entityId: integer("entity_id"),
  entityType: text("entity_type"),
  before: text("before"),
  after: text("after"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("audit_logs_company_idx").on(t.companyId),
  index("audit_logs_user_idx").on(t.userId),
  index("audit_logs_module_idx").on(t.module),
  index("audit_logs_action_idx").on(t.action),
  index("audit_logs_created_at_idx").on(t.createdAt),
]);

export const insertAuditLogSchema = createInsertSchema(auditLogsTable).omit({ id: true, createdAt: true });
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogsTable.$inferSelect;
