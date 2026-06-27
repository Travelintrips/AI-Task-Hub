import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.SUPABASE_DATABASE_URL_DEV,
  ssl: { rejectUnauthorized: false }
});

const sql = `
CREATE TABLE IF NOT EXISTS escalation_rules (
  id SERIAL PRIMARY KEY,
  company_id INTEGER,
  intent_code TEXT,
  category TEXT,
  priority TEXT DEFAULT 'medium',
  trigger_hours INTEGER NOT NULL DEFAULT 24,
  escalate_to TEXT,
  notify_channel TEXT DEFAULT 'whatsapp',
  message_template TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO escalation_rules (intent_code, category, priority, trigger_hours, escalate_to, notify_channel, message_template, is_active)
VALUES
  ('general_inquiry', 'Umum', 'low', 24, 'admin', 'whatsapp', 'Task {task_number} belum direspons dalam {hours} jam', true),
  ('sport_center_inquiry', 'Sport Center', 'medium', 12, 'admin', 'whatsapp', 'Permintaan Sport Center {task_number} perlu perhatian', true),
  ('logistic_inquiry', 'Logistik', 'high', 4, 'admin', 'whatsapp', 'Permintaan Logistik {task_number} urgent', true)
ON CONFLICT DO NOTHING;
`;

try {
  await pool.query(sql);
  console.log('✅ escalation_rules table created');
} catch (e) {
  console.error('❌', e.message);
} finally {
  await pool.end();
}
