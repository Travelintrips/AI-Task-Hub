/**
 * Membuat user diva@admin.com / admin123 di database (dev + prod jika ada).
 * Run: node scripts/create-admin-user.mjs
 */

import bcrypt from "bcryptjs";
import pg from "pg";

const { Client } = pg;

const EMAIL    = "diva@admin.com";
const PASSWORD = "admin123";
const ROLE     = "super_admin";
const COMPANY_ID = 3; // PT Diva Servis

async function upsertUser(connStr, label) {
  const client = new Client({ connectionString: connStr });
  await client.connect();

  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  // Cek apakah user sudah ada
  const existing = await client.query("SELECT id, email FROM users WHERE email = $1", [EMAIL]);

  if (existing.rowCount > 0) {
    // Update password + role agar pasti bisa login
    await client.query(
      `UPDATE users SET password_hash = $1, role = $2, company_id = $3, is_active = true
       WHERE email = $4`,
      [passwordHash, ROLE, COMPANY_ID, EMAIL],
    );
    console.log(`[${label}] Updated existing user: ${EMAIL}`);
  } else {
    // Insert baru
    const id = crypto.randomUUID();
    await client.query(
      `INSERT INTO users (id, name, email, password_hash, role, company_id, is_active, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, true, NOW())`,
      [id, "Diva Admin", EMAIL, passwordHash, ROLE, COMPANY_ID],
    );
    console.log(`[${label}] Created new user: ${EMAIL} (id=${id})`);
  }

  // Verifikasi
  const check = await client.query(
    "SELECT id, email, role, company_id, is_active, LENGTH(password_hash) as hash_len FROM users WHERE email = $1",
    [EMAIL],
  );
  console.log(`[${label}] Verified:`, JSON.stringify(check.rows[0]));

  await client.end();
}

// Dev database (Supabase dev)
const devUrl = process.env.SUPABASE_DATABASE_URL_DEV;
if (devUrl) {
  console.log("=== DEV (Supabase) ===");
  await upsertUser(devUrl, "DEV");
} else {
  console.warn("SUPABASE_DATABASE_URL_DEV not set — skipping dev DB");
}

// Production database (jika ada env terpisah)
const prodUrl = process.env.SUPABASE_DATABASE_URL_PROD || process.env.DATABASE_URL_PROD;
if (prodUrl && prodUrl !== devUrl) {
  console.log("\n=== PROD ===");
  await upsertUser(prodUrl, "PROD");
} else {
  console.log("\n[INFO] No separate PROD database URL found — dev and prod share the same Supabase instance.");
}

console.log("\nDone. Login dengan:");
console.log("  Email   :", EMAIL);
console.log("  Password:", PASSWORD);
