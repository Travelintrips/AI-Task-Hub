import { pgTable, text, uuid, integer, boolean, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

export const aiExecutionJobsTable = pgTable("ai_execution_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: text("company_id").notNull().default("default"),
  taskId: integer("task_id"),
  source: text("source").notNull(),
  externalId: text("external_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  title: text("title").notNull(),
  instruction: text("instruction"),
  sessionId: text("session_id"),
  correlationId: uuid("correlation_id").notNull().defaultRandom(),
  commandId: uuid("command_id"),
  assignedClientId: text("assigned_client_id"),
  workerId: text("worker_id"),
  workerType: text("worker_type"),
  status: text("status").notNull().default("queued"),
  progress: integer("progress").notNull().default(0),
  resultSummary: text("result_summary"),
  errorMessage: text("error_message"),
  callbackVerified: boolean("callback_verified").notNull().default(false),
  attestationVerified: boolean("attestation_verified").notNull().default(false),
  finalAckVerified: boolean("final_ack_verified").notNull().default(false),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("ai_execution_jobs_source_external_uidx").on(t.source, t.externalId),
  uniqueIndex("ai_execution_jobs_idempotency_uidx").on(t.idempotencyKey),
  index("ai_execution_jobs_company_idx").on(t.companyId),
  index("ai_execution_jobs_task_idx").on(t.taskId),
  index("ai_execution_jobs_status_idx").on(t.status),
  index("ai_execution_jobs_created_idx").on(t.createdAt),
]);

export const aiExecutionEventsTable = pgTable("ai_execution_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  executionId: uuid("execution_id").notNull(),
  taskId: integer("task_id"),
  companyId: text("company_id").notNull().default("default"),
  eventId: text("event_id").notNull(),
  eventType: text("event_type").notNull(),
  phase: text("phase"),
  status: text("status"),
  message: text("message"),
  workerId: text("worker_id"),
  signatureVerified: boolean("signature_verified").notNull().default(false),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("ai_execution_events_event_uidx").on(t.eventId),
  index("ai_execution_events_execution_idx").on(t.executionId),
  index("ai_execution_events_task_idx").on(t.taskId),
  index("ai_execution_events_created_idx").on(t.createdAt),
]);

export type AiExecutionJob = typeof aiExecutionJobsTable.$inferSelect;
export type AiExecutionEvent = typeof aiExecutionEventsTable.$inferSelect;
