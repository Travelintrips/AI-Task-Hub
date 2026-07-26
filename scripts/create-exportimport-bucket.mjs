/**
 * Buat bucket Supabase Storage "exportimport" untuk dokumen freight/PPJK.
 * Jalankan: node scripts/create-exportimport-bucket.mjs
 *
 * Env vars yang dibutuhkan (set di Replit Secrets atau .env lokal):
 *   SUPABASE_URL                  — URL project Supabase (prod)
 *   SUPABASE_SERVICE_ROLE_KEY     — Service role key (prod)
 *   atau
 *   SUPABASE_URL_DEV              — URL project dev
 *   SUPABASE_SERVICE_ROLE_KEY_DEV — Service role key dev
 */

import { createClient } from "@supabase/supabase-js";

const BUCKET_NAME = "exportimport";

const supabaseUrl =
  process.env.SUPABASE_URL ||
  process.env.SUPABASE_URL_DEV ||
  "https://xssrfshdrtdfupgqwfdw.supabase.co"; // dev fallback

const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY_DEV;

if (!supabaseKey) {
  console.error(
    "ERROR: SUPABASE_SERVICE_ROLE_KEY atau SUPABASE_SERVICE_ROLE_KEY_DEV harus diset."
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log(`Supabase URL: ${supabaseUrl}`);
  console.log(`Membuat bucket: ${BUCKET_NAME} ...`);

  // Cek apakah bucket sudah ada
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) {
    console.error("Gagal list buckets:", listError.message);
    process.exit(1);
  }

  const exists = buckets?.some((b) => b.name === BUCKET_NAME);
  if (exists) {
    console.log(`✅ Bucket "${BUCKET_NAME}" sudah ada — tidak perlu dibuat ulang.`);
  } else {
    const { error: createError } = await supabase.storage.createBucket(BUCKET_NAME, {
      public: true,
      fileSizeLimit: 10 * 1024 * 1024, // 10MB
      allowedMimeTypes: ["application/pdf", "image/jpeg", "image/png", "image/jpg"],
    });

    if (createError) {
      console.error("❌ Gagal membuat bucket:", createError.message);
      process.exit(1);
    }

    console.log(`✅ Bucket "${BUCKET_NAME}" berhasil dibuat (public, max 10MB, PDF/JPG/PNG).`);
  }

  // Tampilkan info RLS — bucket public Supabase otomatis memberikan read access publik.
  // Upload memerlukan service role key (sudah dihandle di server).
  console.log(`
📋 Info Bucket:
   Nama         : ${BUCKET_NAME}
   Visibilitas  : Public (URL langsung dapat diakses tanpa auth)
   Maks ukuran  : 10 MB per file
   Tipe diizinkan: PDF, JPG, PNG
   RLS Upload   : Hanya via service_role key (server-side)
   RLS Read     : Public — siapapun bisa download via URL langsung

🔗 Base URL file: ${supabaseUrl}/storage/v1/object/public/${BUCKET_NAME}/
  `);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
