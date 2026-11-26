-- AI Task is the authoritative job ledger; no access through Supabase Data API.
-- Additive migration only: existing operational tasks and audit logs remain untouched.
CREATE SCHEMA IF NOT EXISTS ai_task_bridge;
REVOKE ALL ON SCHEMA ai_task_bridge FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS ai_task_bridge.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL CHECK (source IN ('AI_CORE', 'CHATGPT', 'OPENCLAW', 'WHATSAPP', 'WORKER')),
  external_id text NOT NULL,
  idempotency_key text NOT NULL,
  source_session_id text,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'QUEUED'
    CHECK (status IN ('QUEUED', 'WAITING_FOR_WORKER', 'RUNNING', 'SUSPECTED_STALL', 'BLOCKED', 'FAILED', 'WAITING_FOR_ACK', 'COMPLETED')),
  owner text,
  lease_token uuid,
  lease_until timestamptz,
  callback_id text,
  callback_received_at timestamptz,
  result_verified_at timestamptz,
  result_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, idempotency_key)
);

CREATE TABLE IF NOT EXISTS ai_task_bridge.job_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES ai_task_bridge.jobs(id) ON DELETE RESTRICT,
  event_id text NOT NULL UNIQUE,
  kind text NOT NULL,
  sender text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_task_bridge.sessions (
  source text NOT NULL,
  session_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('IDLE', 'RUNNING', 'SUSPECTED_STALL', 'DISCONNECTED', 'AUTH_REQUIRED')),
  owner text,
  job_id uuid REFERENCES ai_task_bridge.jobs(id) ON DELETE SET NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, session_id)
);

CREATE INDEX IF NOT EXISTS bridge_jobs_status_idx ON ai_task_bridge.jobs (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS bridge_jobs_session_idx ON ai_task_bridge.jobs (source, source_session_id);
CREATE INDEX IF NOT EXISTS bridge_events_job_idx ON ai_task_bridge.job_events (job_id, received_at DESC);
CREATE INDEX IF NOT EXISTS bridge_sessions_seen_idx ON ai_task_bridge.sessions (last_seen_at DESC);

ALTER TABLE ai_task_bridge.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_task_bridge.job_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_task_bridge.sessions ENABLE ROW LEVEL SECURITY;
-- No RLS policies or GRANTs are created: only the backend privileged DB
-- connection is allowed to access this non-exposed schema.
