import { pgTable, text, serial, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const USER_ROLES = [
  "super_admin",
  "company_admin",
  "supervisor",
  "staff",
  "vendor",
  "customer",
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const ROLE_HIERARCHY: Record<UserRole, number> = {
  super_admin:   6,
  company_admin: 5,
  supervisor:    4,
  staff:         3,
  vendor:        2,
  customer:      1,
};

export const usersTable = pgTable("users", {
  id:           serial("id").primaryKey(),
  companyId:    text("company_id").notNull().default("default"),
  name:         text("name").notNull(),
  email:        text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role:         text("role").notNull().default("staff"),
  division:     text("division"),
  phone:        text("phone"),
  isActive:     boolean("is_active").notNull().default(true),
  lastLoginAt:  timestamp("last_login_at", { withTimezone: true }),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true, createdAt: true, updatedAt: true, passwordHash: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
