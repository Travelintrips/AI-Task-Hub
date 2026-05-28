import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const publicTokensTable = pgTable("public_tokens", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  taskId: integer("task_id").notNull(),
  tokenType: text("token_type").notNull(),
  createdBy: text("created_by"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  usedAt: timestamp("used_at", { withTimezone: true }),
  isRevoked: boolean("is_revoked").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPublicTokenSchema = createInsertSchema(publicTokensTable).omit({ id: true, createdAt: true });
export type InsertPublicToken = z.infer<typeof insertPublicTokenSchema>;
export type PublicToken = typeof publicTokensTable.$inferSelect;
