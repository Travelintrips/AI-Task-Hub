import pg from "pg";
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.SUPABASE_DATABASE_URL });
const client = await pool.connect();
try {
  console.log("Creating driver_portal_tokens...");
  await client.query(`
    CREATE TABLE IF NOT EXISTS driver_portal_tokens (
      id SERIAL PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      driver_id INTEGER,
      phone TEXT NOT NULL,
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      used_at TIMESTAMP WITH TIME ZONE,
      is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS drv_portal_tkn_phone_idx ON driver_portal_tokens(phone);
    CREATE INDEX IF NOT EXISTS drv_portal_tkn_token_idx ON driver_portal_tokens(token);
  `);
  console.log("Creating driver_documents...");
  await client.query(`
    CREATE TABLE IF NOT EXISTS driver_documents (
      id SERIAL PRIMARY KEY,
      company_id TEXT NOT NULL DEFAULT 'default',
      driver_id INTEGER NOT NULL,
      document_type TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_url TEXT,
      object_path TEXT,
      mime_type TEXT,
      file_size_bytes INTEGER,
      expiry_date DATE,
      is_current BOOLEAN NOT NULL DEFAULT TRUE,
      is_verified BOOLEAN NOT NULL DEFAULT FALSE,
      verification_notes TEXT,
      uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS drv_docs_driver_idx ON driver_documents(driver_id);
    CREATE INDEX IF NOT EXISTS drv_docs_type_idx ON driver_documents(driver_id, document_type);
    CREATE INDEX IF NOT EXISTS drv_docs_current_idx ON driver_documents(driver_id, is_current);
  `);
  console.log("Migration complete ✅");
} finally {
  client.release();
  await pool.end();
}
