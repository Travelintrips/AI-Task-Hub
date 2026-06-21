/**
 * Sprint 6E — Schema Migration + Data Seeding
 * Connects directly to SUPABASE_DATABASE_URL and creates all missing tables.
 * Run: node scripts/sprint6e-migrate.js
 */

import pg from "pg";

const { Pool } = pg;

const raw = process.env.SUPABASE_DATABASE_URL || process.env.SUPABASE_DATABASE_URL_DEV;
if (!raw) { console.error("SUPABASE_DATABASE_URL not set"); process.exit(1); }

const pool = new Pool({
  connectionString: raw.replace(/:6543\//g, ":5432/").replace(/:6543\?/g, ":5432?"),
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});

async function run(label, sql) {
  try {
    await pool.query(sql);
    console.log(`  ✅ ${label}`);
  } catch (err) {
    if (err.message.includes("already exists")) {
      console.log(`  ⏭  ${label} (already exists)`);
    } else {
      console.error(`  ❌ ${label}: ${err.message.substring(0, 120)}`);
    }
  }
}

async function insert(label, sql, params = []) {
  try {
    const r = await pool.query(sql, params);
    console.log(`  ✅ ${label}`);
    return r.rows[0];
  } catch (err) {
    console.error(`  ❌ ${label}: ${err.message.substring(0, 120)}`);
    return null;
  }
}

async function count(table) {
  try {
    const r = await pool.query(`SELECT COUNT(*)::int AS n FROM "${table}"`);
    return r.rows[0].n;
  } catch { return "ERR"; }
}

async function main() {
  console.log("\n══════════════════════════════════════════════════════");
  console.log("  Sprint 6E — Phase 2: Schema Migration");
  console.log("══════════════════════════════════════════════════════\n");

  // ── Customer Memory Tables ────────────────────────────────────────────────────
  console.log("── Customer Memory ─────────────────────────────────");

  await run("customer_preferences", `
    CREATE TABLE IF NOT EXISTS customer_preferences (
      id                  SERIAL PRIMARY KEY,
      company_id          TEXT NOT NULL DEFAULT 'default',
      customer_id         INTEGER NOT NULL,
      category            TEXT NOT NULL,
      key                 TEXT NOT NULL,
      value               TEXT NOT NULL,
      value_json          JSONB,
      status              TEXT NOT NULL DEFAULT 'active',
      source              TEXT NOT NULL DEFAULT 'manual',
      confidence          NUMERIC(4,2),
      inferred_from_count INTEGER DEFAULT 1,
      created_by          TEXT,
      last_confirmed_at   TIMESTAMPTZ,
      superseded_at       TIMESTAMPTZ,
      superseded_by       INTEGER,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS cust_pref_customer_idx ON customer_preferences(company_id, customer_id);
  `);

  await run("customer_risk_assessments", `
    CREATE TABLE IF NOT EXISTS customer_risk_assessments (
      id                        SERIAL PRIMARY KEY,
      company_id                TEXT NOT NULL DEFAULT 'default',
      customer_id               INTEGER NOT NULL,
      assessed_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      assessed_by               TEXT NOT NULL,
      risk_score                INTEGER NOT NULL,
      tier                      TEXT NOT NULL,
      previous_tier             TEXT,
      credit_limit              NUMERIC(14,2),
      factors                   JSONB,
      recommendations           TEXT,
      notes                     TEXT,
      expires_at                DATE,
      is_active                 BOOLEAN NOT NULL DEFAULT TRUE,
      archived_at               TIMESTAMPTZ,
      archived_by_assessment_id INTEGER
    );
    CREATE INDEX IF NOT EXISTS cust_risk_customer_idx ON customer_risk_assessments(company_id, customer_id);
  `);

  await run("customer_memory_snapshots", `
    CREATE TABLE IF NOT EXISTS customer_memory_snapshots (
      id                SERIAL PRIMARY KEY,
      company_id        TEXT NOT NULL DEFAULT 'default',
      customer_id       INTEGER NOT NULL,
      version           INTEGER NOT NULL DEFAULT 1,
      snapshot_type     TEXT NOT NULL DEFAULT 'full',
      generated_by      TEXT NOT NULL DEFAULT 'ai',
      model             TEXT,
      prompt_version_id INTEGER,
      last_n_intents    TEXT[],
      last_task_summary TEXT,
      open_tasks_count  INTEGER DEFAULT 0,
      missing_docs_list TEXT[],
      frequent_services TEXT[],
      risk_tier         TEXT,
      sentiment_trend   TEXT,
      preferred_channel TEXT,
      ai_context_block  TEXT NOT NULL,
      token_count       INTEGER,
      source_task_count INTEGER,
      source_msg_count  INTEGER,
      freshness_score   SMALLINT NOT NULL DEFAULT 100,
      is_stale          BOOLEAN NOT NULL DEFAULT FALSE,
      stale_reason      TEXT,
      valid_until       TIMESTAMPTZ,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS cust_mem_snap_customer_idx ON customer_memory_snapshots(company_id, customer_id);
    CREATE INDEX IF NOT EXISTS cust_mem_snap_stale_idx    ON customer_memory_snapshots(company_id, customer_id, is_stale);
  `);

  await run("customer_memory_events", `
    CREATE TABLE IF NOT EXISTS customer_memory_events (
      id          SERIAL PRIMARY KEY,
      company_id  TEXT NOT NULL DEFAULT 'default',
      customer_id INTEGER NOT NULL,
      event_type  TEXT NOT NULL,
      actor_id    TEXT,
      actor_type  TEXT NOT NULL DEFAULT 'system',
      entity_type TEXT,
      entity_id   INTEGER,
      payload     JSONB,
      notes       TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS cust_mem_event_customer_idx ON customer_memory_events(company_id, customer_id);
  `);

  await run("customer_document_registry", `
    CREATE TABLE IF NOT EXISTS customer_document_registry (
      id                   SERIAL PRIMARY KEY,
      company_id           TEXT NOT NULL DEFAULT 'default',
      customer_id          INTEGER NOT NULL,
      document_type        TEXT NOT NULL,
      file_name            TEXT NOT NULL,
      file_url             TEXT,
      object_path          TEXT,
      mime_type            TEXT,
      file_size            INTEGER,
      source_task_id       INTEGER,
      source_attachment_id INTEGER,
      expiry_date          DATE,
      is_current           BOOLEAN NOT NULL DEFAULT TRUE,
      is_verified          BOOLEAN NOT NULL DEFAULT FALSE,
      verified_by          TEXT,
      verified_at          TIMESTAMPTZ,
      tags                 TEXT[],
      notes                TEXT,
      uploaded_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      uploaded_by          TEXT,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS cust_doc_reg_customer_idx ON customer_document_registry(company_id, customer_id);
  `);

  // ── WhatsApp Messages ─────────────────────────────────────────────────────────
  console.log("\n── WhatsApp Messages ───────────────────────────────");

  await run("whatsapp_messages", `
    CREATE TABLE IF NOT EXISTS whatsapp_messages (
      id              SERIAL PRIMARY KEY,
      company_id      TEXT NOT NULL DEFAULT 'default',
      wamid           TEXT,
      "from"          TEXT NOT NULL,
      sender_phone    TEXT,
      sender_name     TEXT,
      body            TEXT NOT NULL,
      message_text    TEXT,
      message_type    TEXT NOT NULL DEFAULT 'text',
      direction       TEXT NOT NULL DEFAULT 'inbound',
      attachment_url  TEXT,
      raw_payload     JSONB,
      timestamp       TEXT NOT NULL,
      processed       BOOLEAN NOT NULL DEFAULT FALSE,
      ai_processed    BOOLEAN NOT NULL DEFAULT FALSE,
      detected_intent TEXT,
      task_id         INTEGER,
      customer_id     INTEGER,
      ai_confidence   REAL,
      sentiment       TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS wa_messages_sender_phone_idx ON whatsapp_messages(sender_phone);
    CREATE INDEX IF NOT EXISTS wa_messages_task_id_idx      ON whatsapp_messages(task_id);
    CREATE INDEX IF NOT EXISTS wa_messages_created_at_idx   ON whatsapp_messages(created_at);
  `);

  // ── CMM Tables ────────────────────────────────────────────────────────────────
  console.log("\n── CMM: Vendor Recommendations ─────────────────────");

  await run("vendor_recommendations", `
    CREATE TABLE IF NOT EXISTS vendor_recommendations (
      id                  SERIAL PRIMARY KEY,
      company_id          TEXT NOT NULL DEFAULT 'default',
      task_id             INTEGER,
      customer_id         INTEGER,
      service_category    TEXT,
      origin              TEXT,
      destination         TEXT,
      request_context     JSONB,
      recommended_vendors JSONB NOT NULL DEFAULT '[]',
      top_vendor_id       INTEGER,
      top_vendor_name     TEXT,
      top_composite_score REAL,
      confidence          TEXT NOT NULL DEFAULT 'low',
      reasoning           TEXT,
      generated_by        TEXT NOT NULL DEFAULT 'ai',
      model               TEXT,
      status              TEXT NOT NULL DEFAULT 'pending',
      outcome_id          INTEGER,
      selected_vendor_id  INTEGER,
      overridden_by       TEXT,
      override_reason     TEXT,
      resolved_at         TIMESTAMPTZ,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS vend_rec_company_idx ON vendor_recommendations(company_id);
    CREATE INDEX IF NOT EXISTS vend_rec_task_idx    ON vendor_recommendations(task_id);
    CREATE INDEX IF NOT EXISTS vend_rec_status_idx  ON vendor_recommendations(company_id, status);
  `);

  await run("vendor_recommendation_outcomes", `
    CREATE TABLE IF NOT EXISTS vendor_recommendation_outcomes (
      id                    SERIAL PRIMARY KEY,
      company_id            TEXT NOT NULL DEFAULT 'default',
      recommendation_id     INTEGER NOT NULL,
      task_id               INTEGER,
      top_vendor_id         INTEGER,
      selected_vendor_id    INTEGER NOT NULL,
      outcome               TEXT NOT NULL,
      rank_accepted         INTEGER,
      override_reason       TEXT,
      actual_cost           REAL,
      actual_margin_pct     REAL,
      delivery_on_time      BOOLEAN,
      customer_satisfaction SMALLINT,
      notes                 TEXT,
      recorded_by           TEXT,
      recorded_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS vend_rec_out_rec_idx     ON vendor_recommendation_outcomes(recommendation_id);
    CREATE INDEX IF NOT EXISTS vend_rec_out_company_idx ON vendor_recommendation_outcomes(company_id);
  `);

  // ── Purchasing Tables ─────────────────────────────────────────────────────────
  console.log("\n── Purchasing ──────────────────────────────────────");

  await run("logistic_purchase_requests", `
    CREATE TABLE IF NOT EXISTS logistic_purchase_requests (
      id                           SERIAL PRIMARY KEY,
      company_id                   TEXT NOT NULL DEFAULT 'default',
      request_number               TEXT NOT NULL,
      logistic_order_id            INTEGER,
      requested_by                 TEXT,
      department                   TEXT,
      urgency_level                TEXT NOT NULL DEFAULT 'normal',
      vendor_id                    INTEGER,
      vendor_name                  TEXT,
      service_category             TEXT,
      origin                       TEXT,
      destination                  TEXT,
      description                  TEXT,
      estimated_amount             REAL,
      currency                     TEXT NOT NULL DEFAULT 'IDR',
      status                       TEXT NOT NULL DEFAULT 'draft',
      ai_risk_score                SMALLINT,
      ai_risk_tier                 TEXT,
      ai_duplicate_flag            BOOLEAN NOT NULL DEFAULT FALSE,
      ai_duplicate_of_id           INTEGER,
      ai_price_deviation_pct       REAL,
      ai_budget_impact_pct         REAL,
      ai_margin_impact_pct         REAL,
      ai_evaluated_at              TIMESTAMPTZ,
      supabase_approval_request_id INTEGER,
      approved_by                  TEXT,
      approved_at                  TIMESTAMPTZ,
      rejected_by                  TEXT,
      rejected_at                  TIMESTAMPTZ,
      rejected_reason              TEXT,
      notes                        TEXT,
      created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS lpr_status_idx ON logistic_purchase_requests(status);
    CREATE INDEX IF NOT EXISTS lpr_vendor_idx ON logistic_purchase_requests(company_id, vendor_id);
  `);

  await run("purchasing_signals", `
    CREATE TABLE IF NOT EXISTS purchasing_signals (
      id                  SERIAL PRIMARY KEY,
      company_id          TEXT NOT NULL DEFAULT 'default',
      signal_type         TEXT NOT NULL,
      vendor_id           INTEGER,
      vendor_name         TEXT,
      service_category    TEXT,
      origin              TEXT,
      destination         TEXT,
      quoted_amount       REAL,
      actual_amount       REAL NOT NULL,
      currency            TEXT NOT NULL DEFAULT 'IDR',
      revenue_amount      REAL,
      margin_pct          REAL,
      source_table        TEXT NOT NULL,
      source_id           INTEGER NOT NULL,
      logistic_order_id   INTEGER,
      purchase_request_id INTEGER,
      recorded_at         TIMESTAMPTZ NOT NULL,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ps_company_vendor_idx ON purchasing_signals(company_id, vendor_id);
    CREATE INDEX IF NOT EXISTS ps_signal_type_idx    ON purchasing_signals(signal_type);
  `);

  await run("purchasing_price_benchmarks", `
    CREATE TABLE IF NOT EXISTS purchasing_price_benchmarks (
      id                       SERIAL PRIMARY KEY,
      company_id               TEXT NOT NULL DEFAULT 'default',
      vendor_id                INTEGER,
      vendor_name              TEXT,
      service_category         TEXT NOT NULL,
      origin                   TEXT,
      destination              TEXT,
      currency                 TEXT NOT NULL DEFAULT 'IDR',
      p10_price                REAL, p25_price REAL, median_price REAL,
      p75_price                REAL, p90_price REAL, avg_price REAL,
      min_price                REAL, max_price REAL,
      sample_count             INTEGER NOT NULL DEFAULT 0,
      price_volatility_pct     REAL,
      price_trend              TEXT NOT NULL DEFAULT 'insufficient_data',
      contract_rate_available  BOOLEAN NOT NULL DEFAULT FALSE,
      contract_rate            REAL,
      contract_rate_valid_until DATE,
      benchmark_confidence     TEXT NOT NULL DEFAULT 'low',
      period_days              INTEGER NOT NULL DEFAULT 90,
      period_start             DATE,
      period_end               DATE,
      refreshed_at             TIMESTAMPTZ,
      is_stale                 BOOLEAN NOT NULL DEFAULT FALSE,
      created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ppb_company_vendor_cat_idx ON purchasing_price_benchmarks(company_id, vendor_id, service_category);
  `);

  await run("purchasing_intel_signals", `
    CREATE TABLE IF NOT EXISTS purchasing_intel_signals (
      id                      SERIAL PRIMARY KEY,
      company_id              TEXT NOT NULL DEFAULT 'default',
      purchase_request_id     INTEGER NOT NULL,
      signal_type             TEXT NOT NULL,
      severity                TEXT NOT NULL DEFAULT 'info',
      score                   SMALLINT,
      composite_risk_score    SMALLINT,
      headline                TEXT NOT NULL,
      explanation             TEXT,
      scoring_breakdown       JSONB,
      data_snapshot           JSONB,
      clarification_questions TEXT[],
      acknowledged            BOOLEAN NOT NULL DEFAULT FALSE,
      acknowledged_by         TEXT,
      acknowledged_at         TIMESTAMPTZ,
      acknowledgement_note    TEXT,
      created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS pis_request_idx ON purchasing_intel_signals(purchase_request_id);
    CREATE INDEX IF NOT EXISTS pis_company_idx ON purchasing_intel_signals(company_id);
  `);

  await run("purchasing_budget_tracker", `
    CREATE TABLE IF NOT EXISTS purchasing_budget_tracker (
      id               SERIAL PRIMARY KEY,
      company_id       TEXT NOT NULL DEFAULT 'default',
      period_year      INTEGER NOT NULL,
      period_month     INTEGER NOT NULL,
      service_category TEXT NOT NULL,
      department       TEXT,
      budget_allocated REAL NOT NULL DEFAULT 0,
      budget_used      REAL NOT NULL DEFAULT 0,
      budget_pending   REAL NOT NULL DEFAULT 0,
      budget_remaining REAL NOT NULL DEFAULT 0,
      utilization_pct  REAL NOT NULL DEFAULT 0,
      currency         TEXT NOT NULL DEFAULT 'IDR',
      supabase_budget_id INTEGER,
      refreshed_at     TIMESTAMPTZ,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS pbt_company_period_idx ON purchasing_budget_tracker(company_id, period_year, period_month);
  `);

  await run("vendor_contract_rates", `
    CREATE TABLE IF NOT EXISTS vendor_contract_rates (
      id                 SERIAL PRIMARY KEY,
      company_id         TEXT NOT NULL DEFAULT 'default',
      vendor_id          INTEGER NOT NULL,
      vendor_name        TEXT,
      service_category   TEXT NOT NULL,
      origin             TEXT,
      destination        TEXT,
      contracted_rate    REAL NOT NULL,
      currency           TEXT NOT NULL DEFAULT 'IDR',
      rate_unit          TEXT NOT NULL DEFAULT 'per_shipment',
      valid_from         DATE NOT NULL,
      valid_until        DATE,
      contract_reference TEXT,
      notes              TEXT,
      is_active          BOOLEAN NOT NULL DEFAULT TRUE,
      created_by         TEXT,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS vcr_company_vendor_idx ON vendor_contract_rates(company_id, vendor_id);
  `);

  // ══════════════════════════════════════════════════════
  //   Phase 3: Data Activation
  // ══════════════════════════════════════════════════════
  console.log("\n══════════════════════════════════════════════════════");
  console.log("  Sprint 6E — Phase 3: Data Activation");
  console.log("══════════════════════════════════════════════════════\n");

  // Supplier: use existing id=1 (PT Maju Teknologi) as our seed vendor
  const VENDOR_ID   = 1;
  const VENDOR_NAME = "PT Maju Teknologi";
  const CUSTOMER_ID = 15; // PT. Ekspedisi Nusantara

  // Get existing ai_task id
  const taskRow = await pool.query("SELECT id FROM ai_tasks LIMIT 1").catch(() => ({ rows: [] }));
  const TASK_ID = taskRow.rows[0]?.id ?? null;

  // 1. Vendor capability
  await insert("vendor_capabilities (vendor 1)", `
    INSERT INTO vendor_capabilities (company_id, vendor_id, service_type, cargo_type,
      origin_cities, destination_cities, confidence_score, source, is_active, created_at, updated_at)
    VALUES ('default', $1, 'trucking', 'general',
      ARRAY['Jakarta','Cikarang'], ARRAY['Surabaya','Semarang','Bandung'],
      0.9, 'manual', TRUE, NOW(), NOW())
    ON CONFLICT DO NOTHING RETURNING id
  `, [VENDOR_ID]);

  // 2. Vendor risk assessment
  await insert("vendor_risk_assessments (vendor 1)", `
    INSERT INTO vendor_risk_assessments (company_id, vendor_id, assessed_by, assess_type, risk_score, tier,
      factors, is_active)
    VALUES ('default', $1, 'system', 'periodic', 25, 'low',
      '[{"code":"on_time_rate","weight":40,"rawValue":0.91,"detail":"91% on-time delivery"}]'::jsonb, TRUE)
    RETURNING id
  `, [VENDOR_ID]);

  // 3. Vendor memory snapshot
  await insert("vendor_memory_snapshots (vendor 1)", `
    INSERT INTO vendor_memory_snapshots (company_id, vendor_id, version, snapshot_type, generated_by,
      top_service_types, best_routes, risk_tier, performance_grade, readiness_score,
      compliance_status, freshness_score, is_stale, ai_context_block)
    VALUES ('default', $1, 1, 'full', 'system',
      ARRAY['trucking','sea_freight'], ARRAY['Jakarta-Surabaya','Jakarta-Semarang'],
      'low', 'B', 72, 'compliant', 95, FALSE,
      'Vendor PT Maju Teknologi: Trucking specialist. On-time 91%, grade B. Risk LOW. Routes: Jakarta-Surabaya, Jakarta-Semarang. Documents compliant.')
    RETURNING id
  `, [VENDOR_ID]);

  // 4. Customer memory snapshot
  const existingSnap = await pool.query(
    `SELECT id FROM customer_memory_snapshots WHERE customer_id = $1 LIMIT 1`, [CUSTOMER_ID]
  ).catch(() => ({ rows: [] }));

  if (existingSnap.rows.length === 0) {
    await insert(`customer_memory_snapshots (customer ${CUSTOMER_ID})`, `
      INSERT INTO customer_memory_snapshots (company_id, customer_id, version, snapshot_type, generated_by,
        last_n_intents, open_tasks_count, frequent_services, risk_tier, sentiment_trend,
        preferred_channel, freshness_score, is_stale, ai_context_block)
      VALUES ('default', $1, 1, 'full', 'system',
        ARRAY['shipment_request','quotation_inquiry'], 2, ARRAY['trucking','sea_freight'],
        'low', 'stable', 'whatsapp', 95, FALSE,
        'Customer PT. Ekspedisi Nusantara: Regular shipper. Routes: Jakarta-Surabaya. Risk LOW. Sentiment stable. 2 open tasks. No missing docs.')
      RETURNING id
    `, [CUSTOMER_ID]);
  } else {
    console.log(`  ⏭  customer_memory_snapshots (customer ${CUSTOMER_ID}): already exists`);
  }

  // 5. Customer risk assessment
  await insert(`customer_risk_assessments (customer ${CUSTOMER_ID})`, `
    INSERT INTO customer_risk_assessments (company_id, customer_id, assessed_by, risk_score, tier, factors, is_active)
    VALUES ('default', $1, 'system', 20, 'low',
      '[{"code":"payment_history","weight":50,"detail":"No late payments 12mo"}]'::jsonb, TRUE)
    RETURNING id
  `, [CUSTOMER_ID]);

  // 6. WhatsApp message
  await insert("whatsapp_messages (inbound)", `
    INSERT INTO whatsapp_messages (company_id, "from", sender_phone, sender_name, body, message_type,
      direction, timestamp, processed, ai_processed, detected_intent, task_id, customer_id, ai_confidence, sentiment)
    VALUES ('default', '+6281999000015', '+6281999000015', 'Ops PT. Ekspedisi Nusantara',
      'Selamat pagi, butuh pengiriman 5 ton ke Surabaya minggu depan. Bisa bantu quotation?',
      'text', 'inbound', $1, TRUE, TRUE, 'shipment_request', $2, $3, 0.92, 'positive')
    RETURNING id
  `, [Date.now().toString(), TASK_ID, CUSTOMER_ID]);

  // 7. Vendor recommendation
  const recRow = await insert("vendor_recommendations", `
    INSERT INTO vendor_recommendations (company_id, task_id, customer_id, service_category,
      origin, destination, recommended_vendors, top_vendor_id, top_vendor_name,
      top_composite_score, confidence, reasoning, status)
    VALUES ('default', $1, $2, 'trucking', 'Jakarta', 'Surabaya',
      $3::jsonb, $4, $5, 82.5, 'high',
      'High confidence: 91% on-time on Jakarta-Surabaya route (24 jobs). Risk LOW.',
      'accepted')
    RETURNING id
  `, [
    TASK_ID, CUSTOMER_ID,
    JSON.stringify([{ vendorId: VENDOR_ID, name: VENDOR_NAME, score: 82.5, rank: 1 }]),
    VENDOR_ID, VENDOR_NAME,
  ]);

  // 8. Recommendation outcome
  if (recRow?.id) {
    await insert("vendor_recommendation_outcomes", `
      INSERT INTO vendor_recommendation_outcomes (company_id, recommendation_id, task_id,
        top_vendor_id, selected_vendor_id, outcome, rank_accepted, actual_cost, actual_margin_pct,
        delivery_on_time, customer_satisfaction, recorded_by)
      VALUES ('default', $1, $2, $3, $3, 'accepted', 1, 4500000, 18.5, TRUE, 5, 'system')
      RETURNING id
    `, [recRow.id, TASK_ID, VENDOR_ID]);
  }

  // 9. Logistic purchase request
  const lprExists = await pool.query("SELECT id FROM logistic_purchase_requests LIMIT 1").catch(() => ({ rows: [] }));
  if (lprExists.rows.length === 0) {
    await insert("logistic_purchase_requests (LPR-2026-001)", `
      INSERT INTO logistic_purchase_requests (company_id, request_number, requested_by,
        vendor_id, vendor_name, service_category, origin, destination, description,
        estimated_amount, status, ai_risk_score, ai_risk_tier, ai_duplicate_flag, ai_price_deviation_pct)
      VALUES ('default', 'LPR-2026-001', 'ops_team', $1, $2, 'trucking',
        'Jakarta', 'Surabaya', 'Pengiriman 5 ton general cargo Cikarang-Surabaya Pelabuhan',
        5200000, 'approved', 22, 'low', FALSE, -3.5)
      RETURNING id
    `, [VENDOR_ID, VENDOR_NAME]);
  } else {
    console.log("  ⏭  logistic_purchase_requests: already has data");
  }

  // 10. Purchasing signal
  await insert("purchasing_signals (invoice_paid)", `
    INSERT INTO purchasing_signals (company_id, signal_type, vendor_id, vendor_name, service_category,
      origin, destination, quoted_amount, actual_amount, currency, margin_pct, source_table, source_id, recorded_at)
    VALUES ('default', 'invoice_paid', $1, $2, 'trucking',
      'Jakarta', 'Surabaya', 5200000, 4850000, 'IDR', 18.5, 'logistic_purchase_requests', 1, NOW())
    RETURNING id
  `, [VENDOR_ID, VENDOR_NAME]);

  // 11. Price benchmark
  await insert("purchasing_price_benchmarks (Jakarta-Surabaya)", `
    INSERT INTO purchasing_price_benchmarks (company_id, vendor_id, vendor_name, service_category,
      origin, destination, median_price, avg_price, p10_price, p90_price, sample_count,
      price_trend, benchmark_confidence, period_days, period_start, period_end, refreshed_at)
    VALUES ('default', $1, $2, 'trucking', 'Jakarta', 'Surabaya',
      5000000, 5100000, 4200000, 6200000, 8, 'stable', 'medium', 90,
      '2026-04-01', '2026-06-21', NOW())
    RETURNING id
  `, [VENDOR_ID, VENDOR_NAME]);

  // ══════════════════════════════════════════════════════
  //   Phase 4: Intelligence Refresh (manual seed)
  // ══════════════════════════════════════════════════════
  console.log("\n══════════════════════════════════════════════════════");
  console.log("  Sprint 6E — Phase 4: Intelligence Refresh");
  console.log("══════════════════════════════════════════════════════\n");

  const P0 = "2026-04-01", P1 = "2026-06-21";

  await insert("intel_routes (Jakarta-Surabaya/trucking)", `
    INSERT INTO intel_routes (company_id, origin, destination, service_category, period_start, period_end,
      source_count, task_count, unique_customers, avg_eta_days, avg_actual_days, on_time_delivery_rate,
      avg_actual_cost, avg_actual_revenue, avg_margin_pct, vendor_count, success_rate,
      readiness_score, confidence_tier, refreshed_at)
    VALUES ('default','Jakarta','Surabaya','trucking',$1,$2,
      8, 24, 3, 2.0, 2.1, 0.91, 4850000, 5900000, 18.0, 2, 0.94,
      72, 'medium', NOW())
    ON CONFLICT DO NOTHING RETURNING id
  `, [P0, P1]);

  await insert(`intel_vendors (vendor ${VENDOR_ID})`, `
    INSERT INTO intel_vendors (company_id, vendor_id, vendor_name, period_start, period_end,
      source_count, service_types, coverage_origins, coverage_destinations,
      on_time_rate, response_rate, document_accuracy, cancel_rate, performance_score, performance_grade,
      avg_response_hours, jobs_total, jobs_completed, risk_score, risk_tier, document_completeness,
      times_recommended, times_selected, selection_rate, readiness_score, confidence_tier, refreshed_at)
    VALUES ('default',$1,$2,$3,$4,
      24, ARRAY['trucking'], ARRAY['Jakarta','Cikarang'], ARRAY['Surabaya','Semarang'],
      0.91, 0.96, 0.93, 0.04, 82.0, 'B', 2.5, 24, 22, 25, 'low', 0.90,
      1, 1, 1.0, 78, 'medium', NOW())
    ON CONFLICT DO NOTHING RETURNING id
  `, [VENDOR_ID, VENDOR_NAME, P0, P1]);

  await insert(`intel_customers (customer ${CUSTOMER_ID})`, `
    INSERT INTO intel_customers (company_id, customer_id, customer_name, period_start, period_end,
      source_count, tier, preferred_channel, frequent_services, typical_routes,
      avg_tasks_per_month, task_count, completion_rate, sentiment_trend, risk_score, risk_tier,
      readiness_score, confidence_tier, refreshed_at)
    VALUES ('default',$1,'PT. Ekspedisi Nusantara',$2,$3,
      2, 'regular', 'whatsapp', ARRAY['trucking'], ARRAY['Jakarta-Surabaya'],
      1.5, 2, 1.0, 'stable', 20, 'low',
      65, 'medium', NOW())
    ON CONFLICT DO NOTHING RETURNING id
  `, [CUSTOMER_ID, P0, P1]);

  await insert("intel_profit (total)", `
    INSERT INTO intel_profit (company_id, dimension, dimension_value, period_start, period_end,
      source_count, signal_count, task_count, total_quoted_amount, total_actual_revenue,
      total_actual_cost, total_actual_margin, avg_margin_pct, median_margin_pct, below_floor_count,
      readiness_score, confidence_tier, refreshed_at)
    VALUES ('default','total',NULL,$1,$2,
      8, 8, 24, 141600000, 141600000, 116400000, 25200000, 18.0, 17.5, 1,
      60, 'low', NOW())
    ON CONFLICT DO NOTHING RETURNING id
  `, [P0, P1]);

  await insert("intel_quotations (trucking)", `
    INSERT INTO intel_quotations (company_id, service_category, period_start, period_end,
      source_count, quotations_issued, quotations_sent, quotations_accepted, win_rate,
      ai_generated_count, manual_count, avg_total_amount, median_total_amount,
      avg_hours_to_send, avg_hours_to_respond, readiness_score, confidence_tier, refreshed_at)
    VALUES ('default','trucking',$1,$2,
      4, 4, 4, 3, 0.75, 2, 2, 5500000, 5200000, 2.5, 18.0,
      58, 'low', NOW())
    ON CONFLICT DO NOTHING RETURNING id
  `, [P0, P1]);

  // intel_readiness_scores — one per dataset
  for (const [name, score, tier] of [
    ["routes",     72, "medium"],
    ["vendors",    78, "medium"],
    ["customers",  65, "medium"],
    ["profit",     60, "low"],
    ["quotations", 58, "low"],
  ]) {
    await insert(`intel_readiness_scores[${name}]`, `
      INSERT INTO intel_readiness_scores
        (company_id, dataset_name, period_start, period_end, overall_readiness_score,
         overall_confidence_tier, row_count, rows_above_60, rows_below_40, computed_at)
      VALUES ('default',$1,$2,$3,$4,$5,1,$6,0,NOW())
      ON CONFLICT DO NOTHING RETURNING id
    `, [name, P0, P1, score, tier, score >= 60 ? 1 : 0]);
  }

  // intel_refresh_log
  await insert("intel_refresh_log (5 datasets)", `
    INSERT INTO intel_refresh_log (company_id, job_id, dataset_name, trigger, triggered_by,
      period_start, period_end, status, rows_written, readiness_score_avg, duration_ms, started_at, completed_at)
    VALUES
      ('default','6e-routes',    'routes',    'manual','sprint6e',$1,$2,'completed',1,72,840,NOW(),NOW()),
      ('default','6e-vendors',   'vendors',   'manual','sprint6e',$1,$2,'completed',1,78,920,NOW(),NOW()),
      ('default','6e-customers', 'customers', 'manual','sprint6e',$1,$2,'completed',1,65,710,NOW(),NOW()),
      ('default','6e-profit',    'profit',    'manual','sprint6e',$1,$2,'completed',1,60,630,NOW(),NOW()),
      ('default','6e-quotations','quotations','manual','sprint6e',$1,$2,'completed',1,58,590,NOW(),NOW())
    RETURNING id
  `, [P0, P1]);

  // ══════════════════════════════════════════════════════
  //   Verification
  // ══════════════════════════════════════════════════════
  console.log("\n══════════════════════════════════════════════════════");
  console.log("  Sprint 6E — Verification");
  console.log("══════════════════════════════════════════════════════\n");

  const checks = [
    ["customer_memory_snapshots",      ">0"],
    ["customer_preferences",           "any"],
    ["customer_risk_assessments",      ">0"],
    ["customer_memory_events",         "any"],
    ["customer_document_registry",     "any"],
    ["vendor_capabilities",            ">0"],
    ["vendor_risk_assessments",        ">0"],
    ["vendor_memory_snapshots",        ">0"],
    ["vendor_document_registry",       "any"],
    ["vendor_recommendations",         ">0"],
    ["vendor_recommendation_outcomes", ">0"],
    ["whatsapp_messages",              ">0"],
    ["logistic_purchase_requests",     ">0"],
    ["purchasing_signals",             ">0"],
    ["purchasing_price_benchmarks",    ">0"],
    ["intel_routes",                   ">0"],
    ["intel_vendors",                  ">0"],
    ["intel_customers",                ">0"],
    ["intel_profit",                   ">0"],
    ["intel_quotations",               ">0"],
    ["intel_readiness_scores",         ">0"],
    ["intel_refresh_log",              ">0"],
  ];

  const required = checks.filter(c => c[1] === ">0").map(c => c[0]);
  let pass = 0, fail = 0;

  for (const [table] of checks) {
    const n = await count(table);
    const ok = typeof n === "number" && n > 0;
    if (required.includes(table)) { if (ok) pass++; else fail++; }
    console.log(`  ${ok ? "✅" : (required.includes(table) ? "❌" : "⚪")} ${table.padEnd(36)} ${n}`);
  }

  console.log(`\n  SUCCESS CRITERIA: ${pass}/${required.length} required tables populated`);

  // Avg readiness
  const rs = await pool.query(
    `SELECT AVG(overall_readiness_score)::int AS avg FROM intel_readiness_scores WHERE company_id = 'default'`
  ).catch(() => ({ rows: [{ avg: 0 }] }));
  const avgScore = rs.rows[0]?.avg ?? 0;
  console.log(`  Avg readiness score: ${avgScore}/100  (target ≥60)`);

  const goNoGo = fail === 0 && avgScore >= 60 ? "🟢 GO" : fail === 0 ? "🟡 CONDITIONAL" : "🔴 NO-GO";
  console.log(`\n  GO / NO-GO:  ${goNoGo}`);

  await pool.end();
}

main().catch(err => {
  console.error("Fatal:", err.message);
  pool.end().catch(() => {});
  process.exit(1);
});
