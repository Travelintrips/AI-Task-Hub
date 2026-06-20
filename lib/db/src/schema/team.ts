import { pgTable, text, serial, timestamp, boolean, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const teamMembersTable = pgTable("team_members", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  name: text("name").notNull(),
  role: text("role").notNull(),
  division: text("division"),
  isVendor: text("is_vendor").default("false"),
  isActive: boolean("is_active").notNull().default(true),
  phone: text("phone"),
  email: text("email"),
  avatarUrl: text("avatar_url"),
  skills: text("skills"),
  maxActiveTasks: integer("max_active_tasks"),
  currentTaskCount: integer("current_task_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("team_members_company_idx").on(t.companyId),
  index("team_members_division_idx").on(t.division),
]);

export const insertTeamMemberSchema = createInsertSchema(teamMembersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTeamMember = z.infer<typeof insertTeamMemberSchema>;
export type TeamMember = typeof teamMembersTable.$inferSelect;
