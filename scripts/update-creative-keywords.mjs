/**
 * Update keyword_rules untuk intent logo_design (id=35) di Supabase
 * agar semua 10 layanan kreatif terdeteksi dan redirect ke Sales AI.
 *
 * Run: node scripts/update-creative-keywords.mjs
 */

import pg from "pg";

const { Client } = pg;

const client = new Client({
  connectionString: process.env.SUPABASE_DATABASE_URL_DEV || process.env.DATABASE_URL,
});

await client.connect();

const INTENT_CODE = "logo_design";

// 1. Hapus keywords lama
const deleted = await client.query("DELETE FROM keyword_rules WHERE intent_code = $1", [INTENT_CODE]);
console.log(`Deleted ${deleted.rowCount} old keywords for intent_code=${INTENT_CODE}`);

// 2. Insert keywords baru — mencakup semua 10 layanan kreatif
const keywords = [
  // Logo & brand design
  ["logo", 4.0],
  ["buat logo", 4.0],
  ["bikin logo", 4.0],
  ["mau logo", 4.0],
  ["minta logo", 4.0],
  ["desain logo", 4.0],
  ["logo ai", 4.0],
  ["konsep logo", 4.0],
  ["logo brand", 4.0],
  ["brand identity", 4.0],
  ["identitas brand", 4.0],
  ["identitas merek", 4.0],
  ["branding", 3.5],
  ["desain brand", 3.5],
  ["paket identitas", 3.5],
  // Company Profile
  ["company profile", 4.0],
  ["profil perusahaan", 4.0],
  ["buat company profile", 4.0],
  ["bikin company profile", 4.0],
  ["company profile bisnis", 4.0],
  // Pitch Deck / Presentasi
  ["pitch deck", 4.0],
  ["presentasi bisnis", 3.5],
  ["slide presentasi", 3.5],
  ["buat presentasi", 3.5],
  ["bikin pitch deck", 4.0],
  // Desain Media Sosial
  ["desain media sosial", 4.0],
  ["social media design", 4.0],
  ["desain sosmed", 4.0],
  ["desain instagram", 3.5],
  ["feed instagram", 3.5],
  ["template sosmed", 3.5],
  // Konten Instagram (bulanan)
  ["konten instagram", 4.0],
  ["content instagram", 4.0],
  ["konten sosmed", 3.5],
  ["buat konten instagram", 4.0],
  // Packaging Design
  ["packaging", 4.0],
  ["packaging design", 4.0],
  ["desain kemasan", 4.0],
  ["desain packaging", 4.0],
  ["kemasan produk", 3.5],
  ["desain kotak", 3.5],
  // Copywriting
  ["copywriting", 4.0],
  ["copy writing", 4.0],
  ["penulisan konten", 3.5],
  ["jasa copywriting", 4.0],
  ["nulis konten", 3.0],
  // Pembuatan Gambar AI
  ["gambar ai", 4.0],
  ["ai image", 4.0],
  ["generate gambar", 4.0],
  ["buat gambar ai", 4.0],
  ["ilustrasi ai", 3.5],
  ["bikin gambar ai", 4.0],
  // Fashion Collection Brief
  ["fashion brief", 4.0],
  ["fashion collection", 4.0],
  ["koleksi fashion", 4.0],
  ["brief fashion", 4.0],
  ["desain fashion", 4.0],
  // General creative / Sales AI
  ["sales ai", 4.0],
  ["layanan kreatif", 4.0],
  ["creative service", 4.0],
  ["desain grafis", 3.5],
  ["graphic design", 3.5],
  ["jasa desain", 3.5],
  ["desain profesional", 3.5],
];

let inserted = 0;
for (const [keyword, weight] of keywords) {
  await client.query(
    "INSERT INTO keyword_rules (intent_code, company_id, keyword, weight, is_active, created_at) VALUES ($1, 'default', $2, $3, true, NOW())",
    [INTENT_CODE, keyword, weight],
  );
  inserted++;
}

console.log(`Inserted ${inserted} keywords for logo_design intent.`);

// 3. Verifikasi
const check = await client.query("SELECT COUNT(*) as total FROM keyword_rules WHERE intent_code = $1", [INTENT_CODE]);
console.log(`Total keywords now: ${check.rows[0].total}`);

await client.end();
console.log("Done.");
