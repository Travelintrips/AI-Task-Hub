import { pgTable, text, serial, timestamp, integer, real, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const dispatcherLogsTable = pgTable("dispatcher_logs", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  taskId: integer("task_id").notNull(),
  taskNumber: text("task_number"),
  taskTitle: text("task_title"),
  taskCategory: text("task_category"),
  taskPriority: text("task_priority"),
  taskSlaStatus: text("task_sla_status"),

  // Kandidat yang disarankan AI
  suggestedMemberId: integer("suggested_member_id"),
  suggestedMemberName: text("suggested_member_name"),
  suggestedMemberRole: text("suggested_member_role"),
  suggestedMemberDivision: text("suggested_member_division"),

  // Siapa yang benar-benar diassign
  assignedMemberName: text("assigned_member_name"),
  wasOverridden: boolean("was_overridden").default(false),
  overrideReason: text("override_reason"),

  // Skor dan alasan
  totalScore: real("total_score"),
  workloadScore: real("workload_score"),
  skillScore: real("skill_score"),
  urgencyScore: real("urgency_score"),
  availabilityScore: real("availability_score"),
  explanation: text("explanation"),
  allCandidatesJson: text("all_candidates_json"),

  // Meta
  dispatchedBy: text("dispatched_by"),
  dispatchedAt: timestamp("dispatched_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDispatcherLogSchema = createInsertSchema(dispatcherLogsTable).omit({ id: true, createdAt: true });
export type InsertDispatcherLog = z.infer<typeof insertDispatcherLogSchema>;
export type DispatcherLog = typeof dispatcherLogsTable.$inferSelect;
