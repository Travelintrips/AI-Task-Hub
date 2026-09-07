import pg from 'pg';
const { Pool } = pg;

// Cek via SUPABASE_DATABASE_URL
const pool = new Pool({ 
  connectionString: process.env.SUPABASE_DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

try {
  const { rows } = await pool.query(`
    SELECT id, phone, intent_code, status, created_at
    FROM conversation_intake_sessions
    WHERE status IN ('active','collecting','form_sent')
    ORDER BY created_at DESC LIMIT 10
  `);
  console.log('Sessions aktif di Supabase:', rows.length);
  rows.forEach(r => console.log(`  #${r.id} | ${r.phone} | ${r.intent_code} | ${r.status}`));
  
  if (rows.length > 0) {
    const ids = rows.map(r => r.id);
    await pool.query(`UPDATE conversation_intake_sessions SET status='cancelled' WHERE id = ANY($1)`, [ids]);
    console.log(`\n✅ ${ids.length} sesi dibatalkan`);
  }
} catch(e) {
  console.error('Error Supabase:', e.message);
}
await pool.end();
