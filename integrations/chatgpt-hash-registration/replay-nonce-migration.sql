-- Apply to AI Task DEV before enabling hash registration.
CREATE SCHEMA IF NOT EXISTS ai_task_bridge;

CREATE TABLE IF NOT EXISTS ai_task_bridge.chatgpt_relay_nonces (
  nonce_hash TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS chatgpt_relay_nonces_expiry
  ON ai_task_bridge.chatgpt_relay_nonces (expires_at);

-- Expired nonce cleanup can be scheduled separately; rows are retained beyond the
-- signed request window to prevent timestamp/nonce replay after expiry.
