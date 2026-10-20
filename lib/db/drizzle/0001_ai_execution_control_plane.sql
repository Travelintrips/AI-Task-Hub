CREATE TABLE IF NOT EXISTS "ai_execution_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" text DEFAULT 'default' NOT NULL,
  "task_id" integer,
  "source" text NOT NULL,
  "external_id" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "title" text NOT NULL,
  "instruction" text,
  "session_id" text,
  "correlation_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "command_id" uuid,
  "assigned_client_id" text,
  "worker_id" text,
  "worker_type" text,
  "status" text DEFAULT 'queued' NOT NULL,
  "progress" integer DEFAULT 0 NOT NULL,
  "result_summary" text,
  "error_message" text,
  "callback_verified" boolean DEFAULT false NOT NULL,
  "attestation_verified" boolean DEFAULT false NOT NULL,
  "final_ack_verified" boolean DEFAULT false NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "ai_execution_jobs_source_external_uidx" ON "ai_execution_jobs" ("source","external_id");
CREATE UNIQUE INDEX IF NOT EXISTS "ai_execution_jobs_idempotency_uidx" ON "ai_execution_jobs" ("idempotency_key");
CREATE INDEX IF NOT EXISTS "ai_execution_jobs_company_idx" ON "ai_execution_jobs" ("company_id");
CREATE INDEX IF NOT EXISTS "ai_execution_jobs_task_idx" ON "ai_execution_jobs" ("task_id");
CREATE INDEX IF NOT EXISTS "ai_execution_jobs_status_idx" ON "ai_execution_jobs" ("status");
CREATE INDEX IF NOT EXISTS "ai_execution_jobs_created_idx" ON "ai_execution_jobs" ("created_at");

CREATE TABLE IF NOT EXISTS "ai_execution_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "execution_id" uuid NOT NULL,
  "task_id" integer,
  "company_id" text DEFAULT 'default' NOT NULL,
  "event_id" text NOT NULL,
  "event_type" text NOT NULL,
  "phase" text,
  "status" text,
  "message" text,
  "worker_id" text,
  "signature_verified" boolean DEFAULT false NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "ai_execution_events_event_uidx" ON "ai_execution_events" ("event_id");
CREATE INDEX IF NOT EXISTS "ai_execution_events_execution_idx" ON "ai_execution_events" ("execution_id");
CREATE INDEX IF NOT EXISTS "ai_execution_events_task_idx" ON "ai_execution_events" ("task_id");
CREATE INDEX IF NOT EXISTS "ai_execution_events_created_idx" ON "ai_execution_events" ("created_at");

ALTER TABLE "ai_execution_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_execution_events" ENABLE ROW LEVEL SECURITY;
