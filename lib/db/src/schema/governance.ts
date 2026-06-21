import { pgTable, text, serial, timestamp, boolean, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ── 1. Routing Rules ──────────────────────────────────────────────────────────

export const routingRulesTable = pgTable("routing_rules", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  intentCode: text("intent_code"),
  category: text("category"),
  priority: text("priority"),
  assignedRole: text("assigned_role"),
  assignedDivision: text("assigned_division"),
  assignedTeam: text("assigned_team"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("routing_rules_company_idx").on(t.companyId),
  index("routing_rules_intent_idx").on(t.intentCode),
  index("routing_rules_category_idx").on(t.category),
]);

export const insertRoutingRuleSchema = createInsertSchema(routingRulesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRoutingRule = z.infer<typeof insertRoutingRuleSchema>;
export type RoutingRule = typeof routingRulesTable.$inferSelect;

// ── 2. SLA Matrix ─────────────────────────────────────────────────────────────

export const slaMatrixTable = pgTable("sla_matrix", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  intentCode: text("intent_code"),
  category: text("category"),
  priority: text("priority"),
  slaHours: integer("sla_hours").notNull(),
  escalationHours: integer("escalation_hours"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("sla_matrix_company_idx").on(t.companyId),
  index("sla_matrix_intent_idx").on(t.intentCode),
  index("sla_matrix_category_idx").on(t.category),
  index("sla_matrix_priority_idx").on(t.priority),
]);

export const insertSlaMatrixSchema = createInsertSchema(slaMatrixTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSlaMatrix = z.infer<typeof insertSlaMatrixSchema>;
export type SlaMatrix = typeof slaMatrixTable.$inferSelect;

// ── 3. Escalation Rules ───────────────────────────────────────────────────────

export const escalationRulesTable = pgTable("escalation_rules", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  intentCode: text("intent_code"),
  category: text("category"),
  priority: text("priority"),
  triggerHours: integer("trigger_hours").notNull(),
  escalateTo: text("escalate_to").notNull(),
  notifyChannel: text("notify_channel").notNull().default("whatsapp"),
  messageTemplate: text("message_template"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("escalation_rules_company_idx").on(t.companyId),
  index("escalation_rules_intent_idx").on(t.intentCode),
  index("escalation_rules_category_idx").on(t.category),
]);

export const insertEscalationRuleSchema = createInsertSchema(escalationRulesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEscalationRule = z.infer<typeof insertEscalationRuleSchema>;
export type EscalationRule = typeof escalationRulesTable.$inferSelect;

// ── 4. Escalation Logs ────────────────────────────────────────────────────────

export const escalationLogsTable = pgTable("escalation_logs", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  taskId: integer("task_id"),
  ruleId: integer("rule_id"),
  escalatedTo: text("escalated_to"),
  channel: text("channel"),
  message: text("message"),
  isSuccess: boolean("is_success").notNull().default(true),
  errorMessage: text("error_message"),
  firedAt: timestamp("fired_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("escalation_logs_company_idx").on(t.companyId),
  index("escalation_logs_task_idx").on(t.taskId),
  index("escalation_logs_rule_idx").on(t.ruleId),
  index("escalation_logs_fired_at_idx").on(t.firedAt),
]);

export const insertEscalationLogSchema = createInsertSchema(escalationLogsTable).omit({ id: true });
export type InsertEscalationLog = z.infer<typeof insertEscalationLogSchema>;
export type EscalationLog = typeof escalationLogsTable.$inferSelect;

// ── 5. Approval Rules ─────────────────────────────────────────────────────────

export const approvalRulesTable = pgTable("approval_rules", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  intentCode: text("intent_code"),
  category: text("category"),
  priority: text("priority"),
  approvalType: text("approval_type").notNull().default("admin_approval"),
  approverRole: text("approver_role").notNull().default("company_admin"),
  requiresNote: boolean("requires_note").notNull().default(false),
  timeoutHours: integer("timeout_hours").notNull().default(24),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("approval_rules_company_idx").on(t.companyId),
  index("approval_rules_intent_idx").on(t.intentCode),
  index("approval_rules_category_idx").on(t.category),
]);

export const insertApprovalRuleSchema = createInsertSchema(approvalRulesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertApprovalRule = z.infer<typeof insertApprovalRuleSchema>;
export type ApprovalRule = typeof approvalRulesTable.$inferSelect;

// ── 6. Approval Requests ──────────────────────────────────────────────────────

export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "timeout"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const approvalRequestsTable = pgTable("approval_requests", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  taskId: integer("task_id"),
  ruleId: integer("rule_id"),
  requestedBy: text("requested_by"),
  approverRole: text("approver_role").notNull().default("company_admin"),
  approvalType: text("approval_type").notNull().default("admin_approval"),
  status: text("status").notNull().default("pending"),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  notes: text("notes"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("approval_requests_company_idx").on(t.companyId),
  index("approval_requests_task_idx").on(t.taskId),
  index("approval_requests_status_idx").on(t.status),
  index("approval_requests_requested_at_idx").on(t.requestedAt),
]);

export const insertApprovalRequestSchema = createInsertSchema(approvalRequestsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertApprovalRequest = z.infer<typeof insertApprovalRequestSchema>;
export type ApprovalRequest = typeof approvalRequestsTable.$inferSelect;
