import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { startFollowUpScheduler } from "./lib/follow-up-scheduler";
import { startOrderSyncScheduler } from "./lib/order-sync-scheduler";
import { startEscalationScheduler } from "./lib/escalation-scheduler";
import { startIntelScheduler } from "./lib/intel-scheduler";
import { startFleetScheduler } from "./lib/fleet-scheduler";
import { refreshSlaStatuses } from "./lib/sla";
import { expireOldIntakeSessions } from "./lib/intake-engine";
import { supabasePool } from "./lib/supabase-db";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

const allowedOrigins = (() => {
  const domains = process.env.REPLIT_DOMAINS ?? "";
  if (!domains) return true; // dev: allow all
  return domains
    .split(",")
    .map((d) => `https://${d.trim()}`)
    .filter(Boolean);
})();

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  }),
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use("/api", router);

// Start background services
startFollowUpScheduler();

// Auto-import transaksi/pesanan dari Supabase logistic_orders → ai_tasks (real-time)
startOrderSyncScheduler();

// Governance: escalation rules + approval timeout scanner
startEscalationScheduler();

// Sprint 5E: Intelligence Readiness Layer — nightly refresh at 00:30
startIntelScheduler();

// Sprint 7D: Fleet Scheduler — risk, cost, maintenance, fuel anomaly
startFleetScheduler();

// Refresh SLA statuses every 15 minutes
setInterval(() => { refreshSlaStatuses().catch(() => {}); }, 15 * 60 * 1000);

// Expire stale intake sessions every hour
setInterval(() => {
  expireOldIntakeSessions()
    .then((n) => { if (n > 0) logger.info({ expired: n }, "intake-sessions: expired stale sessions"); })
    .catch(() => {});
}, 60 * 60 * 1000);

// ── Sprint 9A startup migrations (idempotent) ──────────────────────────────────
if (supabasePool) {
  supabasePool.query(`
    CREATE TABLE IF NOT EXISTS conversation_intake_sessions (
      id                 SERIAL PRIMARY KEY,
      company_id         TEXT NOT NULL DEFAULT 'default',
      phone              TEXT NOT NULL,
      customer_id        TEXT,
      intent_code        TEXT NOT NULL,
      intent_name        TEXT,
      category           TEXT,
      status             TEXT NOT NULL DEFAULT 'collecting',
      collected_fields   JSONB NOT NULL DEFAULT '{}',
      missing_fields     JSONB NOT NULL DEFAULT '[]',
      required_documents JSONB NOT NULL DEFAULT '[]',
      uploaded_documents JSONB NOT NULL DEFAULT '[]',
      last_question      TEXT,
      last_message       TEXT,
      task_id            TEXT,
      expires_at         TIMESTAMPTZ,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS intake_sessions_phone_idx        ON conversation_intake_sessions(phone);
    CREATE INDEX IF NOT EXISTS intake_sessions_company_idx      ON conversation_intake_sessions(company_id);
    CREATE INDEX IF NOT EXISTS intake_sessions_status_idx       ON conversation_intake_sessions(status);
    CREATE INDEX IF NOT EXISTS intake_sessions_phone_status_idx ON conversation_intake_sessions(phone, status);
    CREATE INDEX IF NOT EXISTS intake_sessions_intent_idx       ON conversation_intake_sessions(intent_code);
    ALTER TABLE data_templates ADD COLUMN IF NOT EXISTS use_mini_form  BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE data_templates ADD COLUMN IF NOT EXISTS mini_form_type TEXT;
    ALTER TABLE data_templates ADD COLUMN IF NOT EXISTS mini_form_route TEXT;
    ALTER TABLE data_templates ADD COLUMN IF NOT EXISTS intake_mode    TEXT NOT NULL DEFAULT 'conversation';
    ALTER TABLE conversation_intake_sessions ADD COLUMN IF NOT EXISTS mini_form_type      TEXT;
    ALTER TABLE conversation_intake_sessions ADD COLUMN IF NOT EXISTS form_token          TEXT;
    ALTER TABLE conversation_intake_sessions ADD COLUMN IF NOT EXISTS form_sent_at        TIMESTAMPTZ;
    CREATE INDEX IF NOT EXISTS intake_sessions_form_token_idx ON conversation_intake_sessions(form_token);
    ALTER TABLE conversation_intake_sessions ADD COLUMN IF NOT EXISTS vendor_id           TEXT;
    ALTER TABLE conversation_intake_sessions ADD COLUMN IF NOT EXISTS required_fields     JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE conversation_intake_sessions ADD COLUMN IF NOT EXISTS confidence_score    NUMERIC(5,2);
    ALTER TABLE conversation_intake_sessions ADD COLUMN IF NOT EXISTS completion_pct      NUMERIC(5,2) NOT NULL DEFAULT 0;
    ALTER TABLE conversation_intake_sessions ADD COLUMN IF NOT EXISTS needs_admin_review  BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE conversation_intake_sessions ADD COLUMN IF NOT EXISTS ai_summary          TEXT;
    ALTER TABLE conversation_intake_sessions ADD COLUMN IF NOT EXISTS last_message_at     TIMESTAMPTZ;
    CREATE INDEX IF NOT EXISTS intake_sessions_company_phone_idx  ON conversation_intake_sessions(company_id, phone);
    CREATE INDEX IF NOT EXISTS intake_sessions_company_status_idx ON conversation_intake_sessions(company_id, status);
    CREATE INDEX IF NOT EXISTS intake_sessions_company_intent_idx ON conversation_intake_sessions(company_id, intent_code);
  `)
  .then(() => logger.info("Sprint 9A startup migrations OK"))
  .catch((err: unknown) => logger.warn({ err }, "Sprint 9A startup migration warning (may already exist)"));
}

export default app;
