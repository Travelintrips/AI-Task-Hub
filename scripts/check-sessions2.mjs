import pg from 'pg';
const { Pool } = pg;

// Coba tanpa SSL dulu
const pool = new Pool({ connectionString: process.env.SUPABASE_DATABASE_URL });

try {
  const { rows } = await pool.query(`
    SELECT id, phone, intent_code, status, created_at
    FROM conversation_intake_sessions
    WHERE status IN ('active','collecting','form_sent')
    ORDER BY created_at DESC LIMIT 10
  `);
  console.log('Sessions di Supabase:', rows.length);
  rows.forEach(r => console.log(`  #${r.id} | ${r.phone} | ${r.intent_code} | ${r.status}`));
  if (rows.length > 0) {
    const ids = rows.map(r => r.id);
    await pool.query(`UPDATE conversation_intake_sessions SET status='cancelled' WHERE id = ANY($1)`, [ids]);
    console.log(`✅ ${ids.length} sesi dibatalkan`);
  }
} catch(e) {
  console.error('Supabase error:', e.message);
  // Coba DATABASE_URL (heliumdb)
  const pool2 = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool2.query(`
      SELECT id, phone, intent_code, status, created_at
      FROM conversation_intake_sessions
      WHERE status IN ('active','collecting','form_sent')
      ORDER BY created_at DESC LIMIT 10
    `);
    console.log('Sessions di heliumdb:', rows.length);
    rows.forEach(r => console.log(`  #${r.id} | ${r.phone} | ${r.intent_code} | ${r.status}`));
    if (rows.length > 0) {
      const ids = rows.map(r => r.id);
      await pool2.query(`UPDATE conversation_intake_sessions SET status='cancelled' WHERE id = ANY($1)`, [ids]);
      console.log(`✅ ${ids.length} sesi dibatalkan di heliumdb`);
    }
    await pool2.end();
  } catch(e2) { console.error('heliumdb error:', e2.message); }
}
await pool.end().catch(()=>{});
