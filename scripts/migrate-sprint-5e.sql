-- Sprint 5E — Intelligence Readiness Layer
-- Run this script to create all 7 intel tables.
-- Safe to re-run: uses CREATE TABLE IF NOT EXISTS.

-- 1. intel_routes
CREATE TABLE IF NOT EXISTS intel_routes (
  id                       SERIAL PRIMARY KEY,
  company_id               TEXT    NOT NULL DEFAULT 'default',
  origin                   TEXT    NOT NULL,
  destination              TEXT    NOT NULL,
  service_category         TEXT    NOT NULL,
  period_start             DATE    NOT NULL,
  period_end               DATE    NOT NULL,
  dataset_version          INTEGER NOT NULL DEFAULT 1,

  source_count             SMALLINT DEFAULT 0,
  source_last_updated_at   TIMESTAMPTZ,

  task_count               INTEGER DEFAULT 0,
  unique_customers         INTEGER DEFAULT 0,
  repeat_customer_rate     REAL,
  avg_tasks_per_month      REAL,

  avg_eta_days             REAL,
  avg_actual_days          REAL,
  on_time_delivery_rate    REAL,
  catalog_estimated_days   TEXT,

  catalog_base_price       REAL,
  avg_quoted_amount        REAL,
  avg_actual_cost          REAL,
  avg_actual_revenue       REAL,
  avg_margin_pct           REAL,
  cost_variance_pct        REAL,
  price_signal_count       INTEGER DEFAULT 0,

  vendor_count             INTEGER DEFAULT 0,
  avg_vendor_selection_rate REAL,
  top_vendor_ids           TEXT[],

  avg_customer_satisfaction REAL,
  success_rate             REAL,

  readiness_score          SMALLINT DEFAULT 0,
  confidence_tier          TEXT     NOT NULL DEFAULT 'insufficient',
  readiness_flags          TEXT[],
  refreshed_at             TIMESTAMPTZ,
  is_stale                 BOOLEAN  NOT NULL DEFAULT FALSE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS intel_routes_route_idx
  ON intel_routes (company_id, origin, destination, service_category, period_start);
CREATE INDEX IF NOT EXISTS intel_routes_category_idx
  ON intel_routes (company_id, service_category);
CREATE INDEX IF NOT EXISTS intel_routes_readiness_idx
  ON intel_routes (company_id, readiness_score);
CREATE INDEX IF NOT EXISTS intel_routes_stale_idx
  ON intel_routes (company_id, is_stale);

-- 2. intel_vendors
CREATE TABLE IF NOT EXISTS intel_vendors (
  id                             SERIAL PRIMARY KEY,
  company_id                     TEXT    NOT NULL DEFAULT 'default',
  vendor_id                      INTEGER NOT NULL,
  vendor_name                    TEXT,
  period_start                   DATE    NOT NULL,
  period_end                     DATE    NOT NULL,
  dataset_version                INTEGER NOT NULL DEFAULT 1,

  source_count                   SMALLINT DEFAULT 0,
  source_last_updated_at         TIMESTAMPTZ,

  service_types                  TEXT[],
  cargo_types                    TEXT[],
  coverage_origins               TEXT[],
  coverage_destinations          TEXT[],
  certifications                 TEXT[],
  has_hazmat                     BOOLEAN DEFAULT FALSE,
  has_cold_chain                 BOOLEAN DEFAULT FALSE,

  on_time_rate                   REAL,
  response_rate                  REAL,
  document_accuracy              REAL,
  cancel_rate                    REAL,
  performance_score              REAL,
  performance_grade              TEXT,
  avg_response_hours             REAL,
  jobs_total                     INTEGER DEFAULT 0,
  jobs_completed                 INTEGER DEFAULT 0,

  risk_score                     INTEGER,
  risk_tier                      TEXT,
  risk_factor_codes              TEXT[],
  risk_assessment_age            INTEGER,

  document_completeness          REAL,
  expired_doc_count              INTEGER DEFAULT 0,
  missing_doc_types              TEXT[],
  critical_docs_missing          BOOLEAN DEFAULT FALSE,

  times_recommended              INTEGER DEFAULT 0,
  times_recommended_rank1        INTEGER DEFAULT 0,
  times_selected                 INTEGER DEFAULT 0,
  selection_rate                 REAL,
  rank1_acceptance_rate          REAL,
  avg_cmm_composite_score        REAL,
  recommendation_acceptance_rate REAL,
  recommendation_win_rate        REAL,

  purchasing_signal_count        INTEGER DEFAULT 0,
  avg_actual_cost                REAL,
  avg_margin_pct                 REAL,
  cost_std_dev                   REAL,
  cost_predictability_tier       TEXT,

  avg_customer_satisfaction      REAL,
  satisfaction_sample_count      INTEGER DEFAULT 0,

  readiness_score                SMALLINT DEFAULT 0,
  confidence_tier                TEXT     NOT NULL DEFAULT 'insufficient',
  readiness_flags                TEXT[],
  refreshed_at                   TIMESTAMPTZ,
  is_stale                       BOOLEAN  NOT NULL DEFAULT FALSE,
  created_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS intel_vendors_vendor_idx
  ON intel_vendors (company_id, vendor_id, period_start);
CREATE INDEX IF NOT EXISTS intel_vendors_risk_idx
  ON intel_vendors (company_id, risk_tier);
CREATE INDEX IF NOT EXISTS intel_vendors_grade_idx
  ON intel_vendors (company_id, performance_grade);
CREATE INDEX IF NOT EXISTS intel_vendors_readiness_idx
  ON intel_vendors (company_id, readiness_score);
CREATE INDEX IF NOT EXISTS intel_vendors_stale_idx
  ON intel_vendors (company_id, is_stale);

-- 3. intel_customers
CREATE TABLE IF NOT EXISTS intel_customers (
  id                        SERIAL PRIMARY KEY,
  company_id                TEXT    NOT NULL DEFAULT 'default',
  customer_id               INTEGER NOT NULL,
  customer_name             TEXT,
  period_start              DATE    NOT NULL,
  period_end                DATE    NOT NULL,
  dataset_version           INTEGER NOT NULL DEFAULT 1,

  source_count              SMALLINT DEFAULT 0,
  source_last_updated_at    TIMESTAMPTZ,

  tier                      TEXT,
  industry                  TEXT,
  preferred_channel         TEXT,
  preferred_language        TEXT,

  frequent_services         TEXT[],
  typical_routes            TEXT[],
  typical_cargo_types       TEXT[],
  avg_tasks_per_month       REAL,
  task_count                INTEGER DEFAULT 0,
  last_task_at              TIMESTAMPTZ,
  days_since_last_task      INTEGER,

  completion_rate           REAL,
  on_track_rate             REAL,
  sla_breach_rate           REAL,
  avg_follow_up_count       REAL,

  sentiment_trend           TEXT,
  avg_sentiment_score       REAL,
  positive_sentiment_pct    REAL,

  risk_score                INTEGER,
  risk_tier                 TEXT,
  credit_limit              REAL,
  risk_factor_codes         TEXT[],
  risk_assessment_age       INTEGER,

  avg_customer_satisfaction  REAL,
  satisfaction_sample_count  INTEGER DEFAULT 0,
  satisfaction_trend         TEXT,

  missing_doc_frequency     REAL,
  typical_missing_docs      TEXT[],

  readiness_score           SMALLINT DEFAULT 0,
  confidence_tier           TEXT     NOT NULL DEFAULT 'insufficient',
  readiness_flags           TEXT[],
  refreshed_at              TIMESTAMPTZ,
  is_stale                  BOOLEAN  NOT NULL DEFAULT FALSE,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS intel_customers_cust_idx
  ON intel_customers (company_id, customer_id, period_start);
CREATE INDEX IF NOT EXISTS intel_customers_tier_idx
  ON intel_customers (company_id, tier);
CREATE INDEX IF NOT EXISTS intel_customers_risk_idx
  ON intel_customers (company_id, risk_tier);
CREATE INDEX IF NOT EXISTS intel_customers_readiness_idx
  ON intel_customers (company_id, readiness_score);
CREATE INDEX IF NOT EXISTS intel_customers_stale_idx
  ON intel_customers (company_id, is_stale);

-- 4. intel_profit
CREATE TABLE IF NOT EXISTS intel_profit (
  id                          SERIAL PRIMARY KEY,
  company_id                  TEXT    NOT NULL DEFAULT 'default',
  dimension                   TEXT    NOT NULL,
  dimension_value             TEXT,
  period_start                DATE    NOT NULL,
  period_end                  DATE    NOT NULL,
  dataset_version             INTEGER NOT NULL DEFAULT 1,

  source_count                SMALLINT DEFAULT 0,
  source_last_updated_at      TIMESTAMPTZ,

  signal_count                INTEGER DEFAULT 0,
  task_count                  INTEGER DEFAULT 0,
  quotation_count             INTEGER DEFAULT 0,
  quotation_accepted_count    INTEGER DEFAULT 0,
  quotation_win_rate          REAL,

  total_quoted_amount         REAL DEFAULT 0,
  total_actual_revenue        REAL DEFAULT 0,
  avg_revenue_per_task        REAL,

  total_actual_cost           REAL DEFAULT 0,
  avg_cost_per_task           REAL,
  catalog_base_price          REAL,
  cost_vs_catalog_pct         REAL,

  total_actual_margin         REAL DEFAULT 0,
  avg_margin_pct              REAL,
  median_margin_pct           REAL,
  p10_margin_pct              REAL,
  p90_margin_pct              REAL,
  margin_std_dev              REAL,
  below_floor_count           INTEGER DEFAULT 0,
  below_floor_pct             REAL,
  below_margin_floor_count    INTEGER DEFAULT 0,

  avg_profit_variance         REAL,
  positive_profit_variance_pct REAL,

  revenue_growth_pct          REAL,
  margin_growth_pct           REAL,
  prev_period_avg_margin_pct  REAL,

  readiness_score             SMALLINT DEFAULT 0,
  confidence_tier             TEXT     NOT NULL DEFAULT 'insufficient',
  readiness_flags             TEXT[],
  refreshed_at                TIMESTAMPTZ,
  is_stale                    BOOLEAN  NOT NULL DEFAULT FALSE,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS intel_profit_dim_idx
  ON intel_profit (company_id, dimension, dimension_value, period_start);
CREATE INDEX IF NOT EXISTS intel_profit_period_idx
  ON intel_profit (company_id, dimension, period_start);
CREATE INDEX IF NOT EXISTS intel_profit_readiness_idx
  ON intel_profit (company_id, readiness_score);
CREATE INDEX IF NOT EXISTS intel_profit_stale_idx
  ON intel_profit (company_id, is_stale);

-- 5. intel_quotations
CREATE TABLE IF NOT EXISTS intel_quotations (
  id                           SERIAL PRIMARY KEY,
  company_id                   TEXT    NOT NULL DEFAULT 'default',
  service_category             TEXT    NOT NULL,
  period_start                 DATE    NOT NULL,
  period_end                   DATE    NOT NULL,
  dataset_version              INTEGER NOT NULL DEFAULT 1,

  source_count                 SMALLINT DEFAULT 0,
  source_last_updated_at       TIMESTAMPTZ,

  quotations_issued            INTEGER DEFAULT 0,
  quotations_sent              INTEGER DEFAULT 0,
  quotations_accepted          INTEGER DEFAULT 0,
  quotations_rejected          INTEGER DEFAULT 0,
  win_rate                     REAL,
  ai_generated_count           INTEGER DEFAULT 0,
  manual_count                 INTEGER DEFAULT 0,

  avg_total_amount             REAL,
  median_total_amount          REAL,
  p10_total_amount             REAL,
  p90_total_amount             REAL,
  catalog_base_price           REAL,
  avg_premium_over_catalog     REAL,

  avg_profit_variance          REAL,
  quotes_too_low               INTEGER DEFAULT 0,
  quotes_too_low_pct           REAL,
  quotes_too_high              INTEGER DEFAULT 0,

  avg_hours_to_send            REAL,
  avg_hours_to_respond         REAL,
  avg_total_cycle_days         REAL,

  ai_win_rate                  REAL,
  manual_win_rate              REAL,
  ai_avg_amount                REAL,
  manual_avg_amount            REAL,
  ai_avg_hours_to_send         REAL,
  manual_avg_hours_to_send     REAL,

  avg_intent_confidence_at_quote REAL,
  high_confidence_win_rate     REAL,
  low_confidence_win_rate      REAL,

  readiness_score              SMALLINT DEFAULT 0,
  confidence_tier              TEXT     NOT NULL DEFAULT 'insufficient',
  readiness_flags              TEXT[],
  refreshed_at                 TIMESTAMPTZ,
  is_stale                     BOOLEAN  NOT NULL DEFAULT FALSE,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS intel_quot_cat_idx
  ON intel_quotations (company_id, service_category, period_start);
CREATE INDEX IF NOT EXISTS intel_quot_readiness_idx
  ON intel_quotations (company_id, readiness_score);
CREATE INDEX IF NOT EXISTS intel_quot_stale_idx
  ON intel_quotations (company_id, is_stale);

-- 6. intel_readiness_scores
CREATE TABLE IF NOT EXISTS intel_readiness_scores (
  id                       SERIAL PRIMARY KEY,
  company_id               TEXT     NOT NULL DEFAULT 'default',
  dataset_name             TEXT     NOT NULL,
  period_start             DATE     NOT NULL,
  period_end               DATE     NOT NULL,
  dataset_version          INTEGER  NOT NULL DEFAULT 1,

  overall_readiness_score  SMALLINT DEFAULT 0,
  overall_confidence_tier  TEXT     NOT NULL DEFAULT 'insufficient',
  row_count                INTEGER  DEFAULT 0,
  rows_above_80            INTEGER  DEFAULT 0,
  rows_above_60            INTEGER  DEFAULT 0,
  rows_below_40            INTEGER  DEFAULT 0,
  top_flags                TEXT[],
  avg_completeness         REAL,
  avg_freshness            REAL,
  avg_coverage             REAL,
  avg_volume               REAL,
  computed_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS intel_readiness_dataset_idx
  ON intel_readiness_scores (company_id, dataset_name, period_start);

-- 7. intel_refresh_log
CREATE TABLE IF NOT EXISTS intel_refresh_log (
  id                   SERIAL PRIMARY KEY,
  company_id           TEXT    NOT NULL DEFAULT 'default',
  job_id               TEXT    NOT NULL,
  dataset_name         TEXT    NOT NULL,
  trigger              TEXT    NOT NULL DEFAULT 'scheduled',
  triggered_by         TEXT    DEFAULT 'system',
  period_start         DATE    NOT NULL,
  period_end           DATE    NOT NULL,
  status               TEXT    NOT NULL DEFAULT 'running',
  rows_written         INTEGER DEFAULT 0,
  rows_stale_cleared   INTEGER DEFAULT 0,
  readiness_score_avg  REAL,
  duration_ms          INTEGER,
  error_message        TEXT,
  started_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS intel_refresh_log_ds_idx
  ON intel_refresh_log (company_id, dataset_name, started_at);
CREATE INDEX IF NOT EXISTS intel_refresh_log_status_idx
  ON intel_refresh_log (company_id, status);
CREATE INDEX IF NOT EXISTS intel_refresh_log_job_idx
  ON intel_refresh_log (job_id);
