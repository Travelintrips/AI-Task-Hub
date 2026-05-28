import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const taskTimelineTable = pgTable("task_timeline", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull(),
  eventType: text("event_type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  actor: text("actor"),
  actorType: text("actor_type").notNull().default("system"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTaskTimelineSchema = createInsertSchema(taskTimelineTable).omit({ id: true, createdAt: true });
export type InsertTaskTimeline = z.infer<typeof insertTaskTimelineSchema>;
export type TaskTimeline = typeof taskTimelineTable.$inferSelect;
