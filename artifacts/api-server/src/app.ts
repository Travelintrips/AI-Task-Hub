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
import { startExecutiveBriefingScheduler } from "./lib/executive-briefing";
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

// Sprint 10A-5: Executive Daily Briefing — 07:00 WIB
startExecutiveBriefingScheduler();

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

  // ── Sprint 9C startup migrations (idempotent) ─────────────────────────────
  supabasePool.query(`
    CREATE TABLE IF NOT EXISTS document_intake_audits (
      id                SERIAL PRIMARY KEY,
      company_id        TEXT NOT NULL DEFAULT 'default',
      task_id           INTEGER,
      intake_session_id INTEGER,
      customer_id       INTEGER,
      vendor_id         INTEGER,
      fleet_unit_id     INTEGER,
      document_type     TEXT NOT NULL,
      file_name         TEXT NOT NULL,
      file_url          TEXT NOT NULL,
      object_path       TEXT,
      extracted_fields  JSONB NOT NULL DEFAULT '{}',
      required_fields   JSONB NOT NULL DEFAULT '[]',
      missing_fields    TEXT[] NOT NULL DEFAULT '{}',
      validation_status TEXT NOT NULL DEFAULT 'needs_review',
      confidence_score  NUMERIC(5,4) NOT NULL DEFAULT 0,
      issue_summary     TEXT,
      ai_notes          TEXT,
      reviewed_by       TEXT,
      reviewed_at       TIMESTAMPTZ,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS doc_intake_audits_company_idx ON document_intake_audits(company_id);
    CREATE INDEX IF NOT EXISTS doc_intake_audits_task_idx    ON document_intake_audits(task_id);
    CREATE INDEX IF NOT EXISTS doc_intake_audits_session_idx ON document_intake_audits(intake_session_id);
    CREATE INDEX IF NOT EXISTS doc_intake_audits_status_idx  ON document_intake_audits(validation_status);
    CREATE INDEX IF NOT EXISTS doc_intake_audits_type_idx    ON document_intake_audits(document_type);

    CREATE TABLE IF NOT EXISTS document_validation_rules (
      id                SERIAL PRIMARY KEY,
      company_id        TEXT NOT NULL DEFAULT 'default',
      document_type     TEXT NOT NULL,
      intent_code       TEXT,
      required_fields   TEXT[] NOT NULL DEFAULT '{}',
      optional_fields   TEXT[] NOT NULL DEFAULT '{}',
      validation_prompt TEXT,
      is_active         TEXT NOT NULL DEFAULT 'true',
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS doc_validation_rules_company_idx ON document_validation_rules(company_id);
    CREATE INDEX IF NOT EXISTS doc_validation_rules_type_idx    ON document_validation_rules(document_type);

    INSERT INTO document_validation_rules (company_id, document_type, required_fields, optional_fields, validation_prompt, is_active)
    SELECT 'default', r.doc_type, r.req_fields, r.opt_fields, r.prompt, 'true'
    FROM (VALUES
      ('commercial_invoice',   ARRAY['invoice_number','invoice_date','seller_name','buyer_name','total_amount','currency','item_description'],
                               ARRAY['payment_terms','incoterms','port_of_loading','port_of_discharge'],
                               'Ini adalah Commercial Invoice ekspor/impor. Ekstrak: nomor invoice, tanggal, nama penjual, nama pembeli, total nilai, mata uang, deskripsi barang.'),
      ('packing_list',         ARRAY['packing_list_number','shipper_name','consignee_name','total_packages','total_gross_weight','total_net_weight'],
                               ARRAY['marks_and_numbers','package_type','dimensions'],
                               'Ini adalah Packing List. Ekstrak: nomor packing list, nama shipper, nama consignee, jumlah kemasan, berat bruto total, berat neto total.'),
      ('bl_awb',               ARRAY['bl_number','shipper_name','consignee_name','port_of_loading','port_of_discharge','description_of_goods'],
                               ARRAY['vessel_name','voyage_number','notify_party','freight_terms'],
                               'Ini adalah Bill of Lading atau Airway Bill. Ekstrak: nomor B/L atau AWB, shipper, consignee, pelabuhan muat, pelabuhan bongkar, deskripsi barang.'),
      ('hs_code',              ARRAY['hs_code','product_description'],
                               ARRAY['country_of_origin','chapter','heading'],
                               'Ini adalah dokumen HS Code. Ekstrak: kode HS (minimal 6 digit), deskripsi produk.'),
      ('msds',                 ARRAY['product_name','manufacturer','hazard_classification','handling_instructions','emergency_contact'],
                               ARRAY['un_number','flash_point','storage_conditions'],
                               'Ini adalah Material Safety Data Sheet (MSDS/SDS). Ekstrak: nama produk, produsen, klasifikasi bahaya, instruksi penanganan, kontak darurat.'),
      ('damage_photo',         ARRAY['damage_visible','photo_description'],
                               ARRAY['location','item_damaged','severity'],
                               'Ini adalah foto kerusakan barang/kargo. Pastikan foto menunjukkan kerusakan yang jelas. Deskripsikan: jenis kerusakan, lokasi, tingkat keparahan.'),
      ('stnk',                 ARRAY['plate_number','vehicle_type','owner_name','expiry_date'],
                               ARRAY['engine_number','chassis_number','color'],
                               'Ini adalah STNK kendaraan. Ekstrak: nomor plat, jenis kendaraan, nama pemilik, tanggal kadaluarsa.'),
      ('kir',                  ARRAY['vehicle_plate','inspection_date','expiry_date','inspection_result'],
                               ARRAY['inspector_name','vehicle_type'],
                               'Ini adalah KIR (Kartu Uji Berkala) kendaraan. Ekstrak: nomor plat, tanggal inspeksi, tanggal kadaluarsa, hasil inspeksi.'),
      ('insurance',            ARRAY['policy_number','insured_name','coverage_amount','start_date','end_date'],
                               ARRAY['insurance_company','coverage_type','premium'],
                               'Ini adalah polis asuransi. Ekstrak: nomor polis, nama tertanggung, nilai pertanggungan, tanggal mulai, tanggal berakhir.'),
      ('fuel_receipt',         ARRAY['transaction_date','fuel_type','quantity_liters','total_amount','station_name'],
                               ARRAY['vehicle_plate','driver_name','price_per_liter'],
                               'Ini adalah struk/nota BBM. Ekstrak: tanggal transaksi, jenis BBM, jumlah liter, total harga, nama SPBU.'),
      ('maintenance_invoice',  ARRAY['invoice_number','invoice_date','workshop_name','vehicle_plate','total_amount','service_description'],
                               ARRAY['parts_replaced','labor_cost','parts_cost','warranty_period'],
                               'Ini adalah invoice bengkel/perawatan kendaraan. Ekstrak: nomor invoice, tanggal, nama bengkel, nomor plat, total biaya, deskripsi layanan.'),
      ('cash_advance_receipt', ARRAY['receipt_date','recipient_name','amount','purpose'],
                               ARRAY['approver_name','reference_number','repayment_deadline'],
                               'Ini adalah kwitansi kasbon/uang muka. Ekstrak: tanggal, nama penerima, jumlah, keperluan.'),
      ('vendor_license',       ARRAY['company_name','nib_number','business_type','issue_date'],
                               ARRAY['expiry_date','address','authorized_signatory'],
                               'Ini adalah SIUP/NIB/izin usaha vendor. Ekstrak: nama perusahaan, nomor NIB/SIUP, jenis usaha, tanggal terbit.'),
      ('surat_jalan',          ARRAY['sj_number','sj_date','sender_name','recipient_name','goods_description','destination'],
                               ARRAY['driver_name','vehicle_plate','quantity','weight'],
                               'Ini adalah Surat Jalan pengiriman barang. Ekstrak: nomor surat jalan, tanggal, nama pengirim, nama penerima, deskripsi barang, tujuan.'),
      ('foto_barang',          ARRAY['goods_visible','condition_description'],
                               ARRAY['quantity_visible','label_visible','damage_notes'],
                               'Ini adalah foto barang/produk. Pastikan barang terlihat jelas. Deskripsikan: kondisi barang, apakah label terlihat, estimasi jumlah yang terlihat.'),
      ('draft_pib_peb',        ARRAY['document_type','importer_exporter_name','customs_office','total_value','currency','hs_code'],
                               ARRAY['consignee','document_date','payment_method','insurance_value'],
                               'Ini adalah Draft PIB (Pemberitahuan Impor Barang) atau PEB (Pemberitahuan Ekspor Barang). Ekstrak: jenis dokumen, nama importir/eksportir, kantor pabean, nilai total, mata uang, HS Code.')
    ) AS r(doc_type, req_fields, opt_fields, prompt)
    WHERE NOT EXISTS (
      SELECT 1 FROM document_validation_rules dvr
      WHERE dvr.company_id = 'default' AND dvr.document_type = r.doc_type
    );
  `)
  .then(() => logger.info("Sprint 9C startup migrations OK"))
  .catch((err: unknown) => logger.warn({ err }, "Sprint 9C startup migration warning (may already exist)"));
}

// ── Sprint 10A-1 startup migrations (idempotent) ──────────────────────────────
if (supabasePool) {
  supabasePool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_commands (
      id          SERIAL PRIMARY KEY,
      command     TEXT NOT NULL,
      description TEXT NOT NULL,
      user_type   TEXT NOT NULL,
      enabled     BOOLEAN NOT NULL DEFAULT true,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS wa_commands_user_type_idx ON whatsapp_commands(user_type);
    CREATE INDEX IF NOT EXISTS wa_commands_enabled_idx   ON whatsapp_commands(enabled);

    CREATE TABLE IF NOT EXISTS whatsapp_command_logs (
      id            SERIAL PRIMARY KEY,
      company_id    TEXT NOT NULL DEFAULT 'default',
      phone         TEXT NOT NULL,
      role          TEXT NOT NULL,
      command       TEXT NOT NULL,
      args          TEXT,
      result        TEXT NOT NULL DEFAULT 'ok',
      reply_preview TEXT,
      duration_ms   INTEGER,
      executed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS wa_cmd_logs_phone_idx    ON whatsapp_command_logs(phone);
    CREATE INDEX IF NOT EXISTS wa_cmd_logs_command_idx  ON whatsapp_command_logs(command);
    CREATE INDEX IF NOT EXISTS wa_cmd_logs_role_idx     ON whatsapp_command_logs(role);
    CREATE INDEX IF NOT EXISTS wa_cmd_logs_company_idx  ON whatsapp_command_logs(company_id);
    CREATE INDEX IF NOT EXISTS wa_cmd_logs_executed_idx ON whatsapp_command_logs(executed_at);

    CREATE TABLE IF NOT EXISTS whatsapp_usage_metrics (
      id             SERIAL PRIMARY KEY,
      company_id     TEXT NOT NULL DEFAULT 'default',
      metric_date    TEXT NOT NULL,
      role           TEXT NOT NULL,
      command        TEXT NOT NULL,
      exec_count     INTEGER NOT NULL DEFAULT 0,
      unique_phones  INTEGER NOT NULL DEFAULT 0,
      success_count  INTEGER NOT NULL DEFAULT 0,
      error_count    INTEGER NOT NULL DEFAULT 0,
      avg_duration_ms REAL,
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS wa_usage_date_idx         ON whatsapp_usage_metrics(metric_date);
    CREATE INDEX IF NOT EXISTS wa_usage_role_idx         ON whatsapp_usage_metrics(role);
    CREATE INDEX IF NOT EXISTS wa_usage_company_date_idx ON whatsapp_usage_metrics(company_id, metric_date);

    INSERT INTO whatsapp_commands (command, description, user_type, enabled)
    SELECT cmd, dsc, utype, true
    FROM (VALUES
      ('STATUS',        'Cek status pesanan',                     'customer'),
      ('DOCS',          'Cek dokumen pesanan',                    'customer'),
      ('HELP',          'Panduan perintah',                       'customer'),
      ('MENU',          'Tampilkan menu utama',                   'customer'),
      ('BBM',           'Log pengisian bahan bakar',              'driver'),
      ('RUSAK',         'Lapor kerusakan kendaraan',              'driver'),
      ('POSISI',        'Update posisi kendaraan',                'driver'),
      ('HELP DRIVER',   'Panduan perintah driver',                'driver'),
      ('DAFTAR VENDOR', 'Onboarding vendor baru',                 'vendor'),
      ('STATUS VENDOR', 'Status akun vendor',                     'vendor'),
      ('DOKUMEN VENDOR','Cek dokumen vendor',                     'vendor'),
      ('APPROVAL',      'Daftar approval menunggu',               'supervisor'),
      ('APPROVE',       'Setujui purchase request',               'supervisor'),
      ('KONFIRMASI',    'Konfirmasi approval',                    'supervisor'),
      ('REJECT',        'Tolak purchase request dengan alasan',   'supervisor'),
      ('DASHBOARD',     'Executive KPI dashboard',                'owner'),
      ('RISK',          'Top risiko hari ini',                    'owner'),
      ('BRIEFING',      'AI executive summary',                   'owner')
    ) AS t(cmd, dsc, utype)
    WHERE NOT EXISTS (
      SELECT 1 FROM whatsapp_commands wc WHERE wc.command = t.cmd AND wc.user_type = t.utype
    );
  `)
  .then(() => logger.info("Sprint 10A-1 startup migrations OK"))
  .catch((err: unknown) => logger.warn({ err }, "Sprint 10A-1 startup migration warning (may already exist)"));
}

// ── Sprint 10A-3 startup migrations (idempotent) ──────────────────────────────
if (supabasePool) {
  supabasePool.query(`
    CREATE TABLE IF NOT EXISTS vendor_portal_tokens (
      id             SERIAL PRIMARY KEY,
      token          TEXT NOT NULL UNIQUE,
      vendor_id      INTEGER,
      phone          TEXT NOT NULL,
      token_purpose  TEXT NOT NULL DEFAULT 'register',
      company_id     TEXT NOT NULL DEFAULT 'default',
      expires_at     TIMESTAMPTZ,
      used_at        TIMESTAMPTZ,
      is_revoked     BOOLEAN NOT NULL DEFAULT false,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS vp_tokens_token_idx  ON vendor_portal_tokens(token);
    CREATE INDEX IF NOT EXISTS vp_tokens_phone_idx  ON vendor_portal_tokens(phone);
    CREATE INDEX IF NOT EXISTS vp_tokens_vendor_idx ON vendor_portal_tokens(vendor_id);

    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS registration_status TEXT DEFAULT 'unregistered';
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS portal_phone         TEXT;
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS review_notes         TEXT;
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS coverage_area        TEXT;
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS vehicle_type         TEXT;
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS service_capacity     TEXT;
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS npwp                 TEXT;
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS nib                  TEXT;
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS admin_notes          TEXT;
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS reviewed_by          TEXT;
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS reviewed_at          TIMESTAMPTZ;
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS self_submitted        BOOLEAN DEFAULT false;
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS updated_at           TIMESTAMPTZ DEFAULT NOW();
  `)
  .then(() => logger.info("Sprint 10A-3 startup migrations OK"))
  .catch((err: unknown) => logger.warn({ err }, "Sprint 10A-3 startup migration warning (may already exist)"));
}

// ── Sprint 10A-4 startup migrations (idempotent, split per statement) ─────────
if (supabasePool) {
  const run10A4 = async () => {
    await supabasePool!.query(`
      CREATE TABLE IF NOT EXISTS driver_portal_tokens (
        id          SERIAL PRIMARY KEY,
        token       TEXT NOT NULL UNIQUE,
        driver_id   INTEGER,
        phone       TEXT NOT NULL,
        expires_at  TIMESTAMPTZ,
        is_revoked  BOOLEAN NOT NULL DEFAULT false,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await supabasePool!.query(`CREATE INDEX IF NOT EXISTS drv_portal_tokens_token_idx  ON driver_portal_tokens(token)`);
    await supabasePool!.query(`CREATE INDEX IF NOT EXISTS drv_portal_tokens_phone_idx  ON driver_portal_tokens(phone)`);
    await supabasePool!.query(`CREATE INDEX IF NOT EXISTS drv_portal_tokens_driver_idx ON driver_portal_tokens(driver_id)`);

    await supabasePool!.query(`
      CREATE TABLE IF NOT EXISTS driver_documents (
        id                  SERIAL PRIMARY KEY,
        driver_id           INTEGER NOT NULL,
        document_type       TEXT NOT NULL,
        file_name           TEXT NOT NULL,
        file_url            TEXT,
        object_path         TEXT,
        is_current          BOOLEAN NOT NULL DEFAULT true,
        is_verified         BOOLEAN NOT NULL DEFAULT false,
        verification_notes  TEXT,
        uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        verified_at         TIMESTAMPTZ,
        expires_at          TIMESTAMPTZ
      )
    `);
    await supabasePool!.query(`CREATE INDEX IF NOT EXISTS drv_docs_driver_idx  ON driver_documents(driver_id)`);
    await supabasePool!.query(`CREATE INDEX IF NOT EXISTS drv_docs_type_idx    ON driver_documents(document_type)`);
    await supabasePool!.query(`CREATE INDEX IF NOT EXISTS drv_docs_current_idx ON driver_documents(driver_id, is_current)`);

    await supabasePool!.query(`
      CREATE TABLE IF NOT EXISTS fleet_driver_performance (
        id                  SERIAL PRIMARY KEY,
        driver_id           INTEGER NOT NULL,
        company_id          TEXT NOT NULL DEFAULT 'default',
        period_month        TEXT NOT NULL,
        period_start        DATE,
        period_end          DATE,
        total_trips         INTEGER NOT NULL DEFAULT 0,
        total_distance_km   NUMERIC(10,2) NOT NULL DEFAULT 0,
        avg_fuel_efficiency NUMERIC(6,2),
        incidents_count     INTEGER NOT NULL DEFAULT 0,
        on_time_deliveries  INTEGER NOT NULL DEFAULT 0,
        overall_score       NUMERIC(5,2),
        safety_score        NUMERIC(5,2),
        punctuality_score   NUMERIC(5,2),
        fuel_score          NUMERIC(5,2),
        utilization_score   NUMERIC(5,2),
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await supabasePool!.query(`ALTER TABLE fleet_driver_performance ADD COLUMN IF NOT EXISTS period_start DATE`);
    await supabasePool!.query(`ALTER TABLE fleet_driver_performance ADD COLUMN IF NOT EXISTS period_end  DATE`);
    await supabasePool!.query(`ALTER TABLE fleet_driver_performance ADD COLUMN IF NOT EXISTS overall_score       NUMERIC(5,2)`);
    await supabasePool!.query(`ALTER TABLE fleet_driver_performance ADD COLUMN IF NOT EXISTS safety_score       NUMERIC(5,2)`);
    await supabasePool!.query(`ALTER TABLE fleet_driver_performance ADD COLUMN IF NOT EXISTS punctuality_score   NUMERIC(5,2)`);
    await supabasePool!.query(`ALTER TABLE fleet_driver_performance ADD COLUMN IF NOT EXISTS fuel_score          NUMERIC(5,2)`);
    await supabasePool!.query(`ALTER TABLE fleet_driver_performance ADD COLUMN IF NOT EXISTS utilization_score   NUMERIC(5,2)`);
    await supabasePool!.query(`CREATE INDEX IF NOT EXISTS drv_perf_driver_idx  ON fleet_driver_performance(driver_id)`);
    await supabasePool!.query(`CREATE INDEX IF NOT EXISTS drv_perf_company_idx ON fleet_driver_performance(company_id)`);
    await supabasePool!.query(`CREATE INDEX IF NOT EXISTS drv_perf_period_idx  ON fleet_driver_performance(period_end)`);

    await supabasePool!.query(`ALTER TABLE fleet_drivers ADD COLUMN IF NOT EXISTS emergency_contact TEXT`);
    await supabasePool!.query(`ALTER TABLE fleet_drivers ADD COLUMN IF NOT EXISTS onboarding_status TEXT NOT NULL DEFAULT 'pending'`);
    await supabasePool!.query(`ALTER TABLE fleet_drivers ADD COLUMN IF NOT EXISTS portal_phone      TEXT`);
  };
  run10A4()
    .then(() => logger.info("Sprint 10A-4 startup migrations OK"))
    .catch((err: unknown) => logger.warn({ err }, "Sprint 10A-4 startup migration warning"));

  const run10A5 = async () => {
    await supabasePool!.query(`
      CREATE TABLE IF NOT EXISTS executive_briefing_logs (
        id                SERIAL PRIMARY KEY,
        company_id        TEXT NOT NULL DEFAULT 'default',
        recipient_phone   TEXT NOT NULL,
        recipient_role    TEXT,
        status            TEXT NOT NULL DEFAULT 'pending',
        message_preview   TEXT,
        sent_at           TIMESTAMPTZ,
        error_message     TEXT,
        delivery_provider TEXT NOT NULL DEFAULT 'fonnte',
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await supabasePool!.query(`CREATE INDEX IF NOT EXISTS ebr_company_idx ON executive_briefing_logs(company_id)`);
    await supabasePool!.query(`CREATE INDEX IF NOT EXISTS ebr_created_idx ON executive_briefing_logs(created_at DESC)`);
    await supabasePool!.query(`ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS executive_briefing_enabled    BOOLEAN NOT NULL DEFAULT FALSE`);
    await supabasePool!.query(`ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS executive_briefing_time       TEXT NOT NULL DEFAULT '07:00'`);
    await supabasePool!.query(`ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS executive_briefing_recipients TEXT NOT NULL DEFAULT 'owner,super_admin,company_admin'`);
  };
  run10A5()
    .then(() => logger.info("Sprint 10A-5 startup migrations OK"))
    .catch((err: unknown) => logger.warn({ err }, "Sprint 10A-5 startup migration warning"));
}

// ── Core table startup migrations (idempotent) ─────────────────────────────────
// Creates essential Drizzle-managed tables if they don't exist.
// These are created via raw SQL (not Drizzle push) so they survive env resets.
if (supabasePool) {
  const runCoreMigrations = async () => {
    // whatsapp_messages — needed for every incoming message to be saved
    await supabasePool!.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_messages (
        id                SERIAL PRIMARY KEY,
        company_id        TEXT NOT NULL DEFAULT 'default',
        message_id        TEXT,
        from_phone        TEXT NOT NULL,
        to_phone          TEXT,
        sender_name       TEXT,
        message_type      TEXT NOT NULL DEFAULT 'text',
        body_text         TEXT,
        media_url         TEXT,
        media_id          TEXT,
        raw_payload       JSONB,
        direction         TEXT NOT NULL DEFAULT 'inbound',
        processed         BOOLEAN NOT NULL DEFAULT false,
        ai_processed      BOOLEAN NOT NULL DEFAULT false,
        detected_intent   TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await supabasePool!.query(`CREATE INDEX IF NOT EXISTS wa_msgs_company_idx  ON whatsapp_messages(company_id)`);
    await supabasePool!.query(`CREATE INDEX IF NOT EXISTS wa_msgs_from_idx     ON whatsapp_messages(from_phone)`);
    await supabasePool!.query(`CREATE INDEX IF NOT EXISTS wa_msgs_created_idx  ON whatsapp_messages(created_at DESC)`);
    await supabasePool!.query(`CREATE INDEX IF NOT EXISTS wa_msgs_processed_idx ON whatsapp_messages(processed)`);
    await supabasePool!.query(`ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS body_text       TEXT`);
    await supabasePool!.query(`ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS detected_intent TEXT`);
    await supabasePool!.query(`ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS ai_processed    BOOLEAN NOT NULL DEFAULT false`);

    // ai_tasks — needed for task creation from WhatsApp intents
    await supabasePool!.query(`
      CREATE TABLE IF NOT EXISTS ai_tasks (
        id                       SERIAL PRIMARY KEY,
        company_id               TEXT NOT NULL DEFAULT 'default',
        task_number              TEXT,
        source                   TEXT NOT NULL DEFAULT 'manual',
        customer_id              INTEGER,
        customer_name            TEXT,
        customer_phone           TEXT,
        title                    TEXT NOT NULL,
        description              TEXT,
        category                 TEXT,
        division                 TEXT,
        priority                 TEXT NOT NULL DEFAULT 'medium',
        status                   TEXT NOT NULL DEFAULT 'new_inquiry',
        assigned_to              TEXT,
        assigned_to_id           INTEGER,
        assigned_role            TEXT,
        assigned_division        TEXT,
        assigned_vendor          TEXT,
        driver_name              TEXT,
        driver_phone             TEXT,
        plate_number             TEXT,
        quotation_amount         TEXT,
        quotation_notes          TEXT,
        due_date                 TIMESTAMPTZ,
        sla_hours                INTEGER,
        overdue_at               TIMESTAMPTZ,
        completed_at             TIMESTAMPTZ,
        sla_status               TEXT NOT NULL DEFAULT 'on_track',
        last_customer_reply_at   TIMESTAMPTZ,
        follow_up_count          INTEGER NOT NULL DEFAULT 0,
        ai_summary               TEXT,
        ai_intent                TEXT,
        missing_data             TEXT,
        required_action          TEXT,
        admin_notes              TEXT,
        ai_confidence_score      TEXT,
        customer_sentiment       TEXT,
        created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await supabasePool!.query(`CREATE INDEX IF NOT EXISTS ai_tasks_company_status_idx    ON ai_tasks(company_id, status)`);
    await supabasePool!.query(`CREATE INDEX IF NOT EXISTS ai_tasks_customer_phone_idx    ON ai_tasks(customer_phone)`);
    await supabasePool!.query(`CREATE INDEX IF NOT EXISTS ai_tasks_status_idx            ON ai_tasks(status)`);
    await supabasePool!.query(`CREATE INDEX IF NOT EXISTS ai_tasks_category_idx          ON ai_tasks(category)`);
    await supabasePool!.query(`CREATE INDEX IF NOT EXISTS ai_tasks_created_at_idx        ON ai_tasks(created_at DESC)`);

    // data_template_fields — needed for intake template field loading
    await supabasePool!.query(`
      CREATE TABLE IF NOT EXISTS data_template_fields (
        id           SERIAL PRIMARY KEY,
        template_id  INTEGER NOT NULL,
        field_name   TEXT NOT NULL,
        field_label  TEXT NOT NULL,
        field_type   TEXT NOT NULL DEFAULT 'text',
        is_required  BOOLEAN NOT NULL DEFAULT true,
        sort_order   INTEGER NOT NULL DEFAULT 0,
        help_text    TEXT,
        placeholder  TEXT,
        options      JSONB,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await supabasePool!.query(`CREATE INDEX IF NOT EXISTS dtf_template_idx ON data_template_fields(template_id)`);
    await supabasePool!.query(`CREATE INDEX IF NOT EXISTS dtf_sort_idx     ON data_template_fields(template_id, sort_order)`);

    // document_templates & document_template_fields — needed for intake doc requirements
    await supabasePool!.query(`
      CREATE TABLE IF NOT EXISTS document_templates (
        id           SERIAL PRIMARY KEY,
        company_id   TEXT NOT NULL DEFAULT 'default',
        name         TEXT NOT NULL,
        intent_code  TEXT,
        category     TEXT,
        description  TEXT,
        is_active    BOOLEAN NOT NULL DEFAULT true,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await supabasePool!.query(`CREATE INDEX IF NOT EXISTS doc_tpl_company_idx ON document_templates(company_id)`);
    await supabasePool!.query(`CREATE INDEX IF NOT EXISTS doc_tpl_intent_idx  ON document_templates(intent_code)`);

    await supabasePool!.query(`
      CREATE TABLE IF NOT EXISTS document_template_fields (
        id            SERIAL PRIMARY KEY,
        template_id   INTEGER NOT NULL,
        document_name TEXT NOT NULL,
        document_type TEXT,
        is_required   BOOLEAN NOT NULL DEFAULT true,
        description   TEXT,
        sort_order    INTEGER NOT NULL DEFAULT 0,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await supabasePool!.query(`CREATE INDEX IF NOT EXISTS doc_tpl_fields_tpl_idx ON document_template_fields(template_id)`);
  };
  runCoreMigrations()
    .then(() => logger.info("Core table migrations OK"))
    .catch((err: unknown) => logger.warn({ err }, "Core table migration warning"));
}

// ── Sprint 10A-1.1 startup schema validation ───────────────────────────────────
// Lightweight check — never fails startup, just logs drift summary.
import("./lib/schema-startup-check").then((m) => m.runSchemaStartupCheck()).catch(() => {});

export default app;
