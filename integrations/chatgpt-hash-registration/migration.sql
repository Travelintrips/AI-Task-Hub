-- Apply to the AI Task DEV database before enabling registration.
CREATE SCHEMA IF NOT EXISTS ai_task_bridge;
CREATE TABLE IF NOT EXISTS ai_task_bridge.chatgpt_conversation_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL CHECK (provider = 'chatgpt'),
  source_conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_chatgpt_user_conversation UNIQUE
     (provider, source_conversation_id, user_id, company_id)
);
CREATE INDEX IF NOT EXISTS chatgpt_binding_user_lookup
  ON ai_task_bridge.chatgpt_conversation_bindings (company_id, user_id, created_at DESC);
-- Do not grant direct customer access to this table; use the authenticated API.
