/**
 * Seed logo_design intent, keywords, dan data template ke Supabase.
 * Jalankan: node scripts/seed-logo-design.mjs
 */
import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.SUPABASE_DATABASE_URL_DEV || process.env.DATABASE_URL,
});

async function run() {
  console.log("🎨 Seeding logo_design intent ke Supabase...");

  // ── intent_master ──────────────────────────────────────────────────────────
  await pool.query(
    `DELETE FROM intent_master WHERE intent_code = 'logo_design' AND company_id = 'default'`,
  );
  await pool.query(`
    INSERT INTO intent_master
      (company_id, intent_code, intent_name, category, suggested_category, suggested_division, suggested_priority, sla_hours, is_active, created_at, updated_at)
    VALUES
      ('default', 'logo_design', 'Pembuatan Logo / Desain Brand', 'Creative AI', 'Creative AI', 'Creative', 'medium', 24, true, NOW(), NOW())
  `);
  console.log("  ✅ intent_master: logo_design inserted");

  // ── keyword_rules ──────────────────────────────────────────────────────────
  await pool.query(
    `DELETE FROM keyword_rules WHERE intent_code = 'logo_design' AND company_id = 'default'`,
  );
  const keywords = [
    ["logo", 3.5],
    ["buat logo", 4.0],
    ["bikin logo", 4.0],
    ["desain logo", 4.0],
    ["design logo", 4.0],
    ["buatkan logo", 4.0],
    ["logo perusahaan", 3.5],
    ["logo usaha", 3.5],
    ["logo brand", 3.5],
    ["logo toko", 3.5],
    ["logo bisnis", 3.5],
    ["brand identity", 3.0],
    ["identitas brand", 3.0],
    ["brand design", 3.0],
    ["lambang perusahaan", 3.0],
    ["buat brand", 3.0],
    ["desain brand", 3.0],
    ["generate logo", 4.0],
    ["ai logo", 3.5],
    ["logo ai", 3.5],
  ];
  for (const [kw, weight] of keywords) {
    await pool.query(
      `INSERT INTO keyword_rules (company_id, intent_code, keyword, weight, is_active, created_at)
       VALUES ('default', 'logo_design', $1, $2, true, NOW())`,
      [kw, weight],
    );
  }
  console.log(`  ✅ keyword_rules: ${keywords.length} keywords inserted`);

  // ── data_templates ─────────────────────────────────────────────────────────
  const existing = await pool.query(
    `SELECT id FROM data_templates WHERE intent_code = 'logo_design' AND company_id = 'default'`,
  );
  if (existing.rows.length > 0) {
    const id = existing.rows[0].id;
    await pool.query(`DELETE FROM data_template_fields WHERE template_id = $1`, [id]);
    await pool.query(`DELETE FROM data_templates WHERE id = $1`, [id]);
    console.log("  🗑️  Existing logo_design template removed");
  }

  const tmpl = await pool.query(`
    INSERT INTO data_templates
      (company_id, intent_code, name, category, description, is_active, use_mini_form, mini_form_type, intake_mode, created_at, updated_at)
    VALUES
      ('default', 'logo_design', 'Brief Desain Logo AI', 'Creative AI',
       'Kumpulkan brief untuk generate logo dengan AI (FLUX.1 via Together.ai)', true, false, null, 'conversational', NOW(), NOW())
    RETURNING id
  `);
  const templateId = tmpl.rows[0].id;

  // ── data_template_fields ───────────────────────────────────────────────────
  const fields = [
    ["brand_name",        "Nama Brand / Perusahaan", "text", true,  1, "Nama brand atau perusahaan yang akan dibuatkan logo",                     "PT Cahaya Sejati"],
    ["industry",          "Jenis Bisnis / Industri",  "text", true,  2, "Bidang usaha atau industri bisnis Anda",                                   "Logistik / Teknologi / Kuliner"],
    ["style_preference",  "Gaya Logo",                "text", true,  3, "Pilih gaya: minimalis, modern, klasik, tegas, elegan, playful, futuristik", "Minimalis modern"],
    ["color_preference",  "Preferensi Warna",         "text", false, 4, "Warna utama yang diinginkan. Ketik 'bebas' jika tidak ada preferensi",      "Biru dan putih"],
    ["tagline",           "Tagline / Slogan",         "text", false, 5, "Tagline singkat jika ingin disertakan. Ketik 'tidak ada' jika tidak perlu", "Terpercaya & Profesional"],
    ["additional_notes",  "Catatan Tambahan",         "text", false, 6, "Referensi, inspirasi, atau keterangan khusus lainnya",                     "Modern seperti logo Apple"],
  ];

  for (const [field_name, field_label, field_type, is_required, sort_order, help_text, sample_value] of fields) {
    await pool.query(
      `INSERT INTO data_template_fields
         (template_id, field_name, field_label, field_type, is_required, sort_order, help_text, sample_value, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
      [templateId, field_name, field_label, field_type, is_required, sort_order, help_text, sample_value],
    );
  }
  console.log(`  ✅ data_template_fields: ${fields.length} fields inserted (template_id=${templateId})`);
  console.log("\n✅ Seeding selesai!");
}

run().catch((e) => { console.error("❌ Seed gagal:", e.message); process.exit(1); }).finally(() => pool.end());
