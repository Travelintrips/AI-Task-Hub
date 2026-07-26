/**
 * Storage Helper — Supabase bucket "exportimport"
 * Digunakan untuk upload dokumen freight/PPJK (Commercial Invoice, Packing List).
 *
 * Functions:
 *   uploadToSupabase(file, folder)   — upload file buffer ke bucket "exportimport"
 *   getPublicUrl(filePath)           — public URL untuk file di bucket "exportimport"
 *   getAccessibleExportImportUrl()   — verifikasi URL publik, fallback ke signed URL 7 hari
 *   sendWhatsAppMedia(...)           — kirim pesan + attachment via Fonnte
 */

import { logger } from "./logger";
import { supabase } from "./supabase";

export const EXPORTIMPORT_BUCKET = "exportimport";

// ── Bucket setup ──────────────────────────────────────────────────────────────

/**
 * Pastikan bucket "exportimport" ada. Dipanggil saat server startup.
 * Idempotent — aman dipanggil berkali-kali.
 */
export async function ensureExportImportBucket(): Promise<void> {
  if (!supabase) return;
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    const exists = buckets?.some((b) => b.name === EXPORTIMPORT_BUCKET);
    if (!exists) {
      const { error } = await supabase.storage.createBucket(EXPORTIMPORT_BUCKET, {
        public: true,
        fileSizeLimit: 10 * 1024 * 1024, // 10MB
        allowedMimeTypes: ["application/pdf", "image/jpeg", "image/png", "image/jpg"],
      });
      if (error) {
        logger.error({ error }, `storage: gagal membuat bucket ${EXPORTIMPORT_BUCKET}`);
      } else {
        logger.info({ bucket: EXPORTIMPORT_BUCKET }, "storage: bucket exportimport berhasil dibuat");
      }
    } else {
      logger.info({ bucket: EXPORTIMPORT_BUCKET }, "storage: bucket exportimport sudah ada");
    }
  } catch (err) {
    logger.warn({ err }, "storage: ensureExportImportBucket error (non-fatal)");
  }
}

// ── Upload ────────────────────────────────────────────────────────────────────

/**
 * Upload file (dari multer buffer) ke Supabase Storage bucket "exportimport".
 *
 * @param file   - File object dari multer (memoryStorage)
 * @param folder - Sub-folder di dalam bucket (default: "freight-documents")
 * @returns      - Storage path (bukan URL) — gunakan getPublicUrl() untuk URL
 */
export async function uploadToSupabase(
  file: Express.Multer.File,
  folder: string = "freight-documents",
): Promise<string> {
  if (!supabase) throw new Error("Supabase tidak dikonfigurasi — SUPABASE_SERVICE_ROLE_KEY belum diset");

  // Sanitasi nama file: hapus karakter non-ASCII dan spasi
  const safeName = file.originalname
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_");

  const objectPath = `${folder}/${Date.now()}_${safeName}`;

  logger.info(
    { bucket: EXPORTIMPORT_BUCKET, objectPath, size: file.size, mimetype: file.mimetype },
    "storage: uploading file ke Supabase",
  );

  const { error } = await supabase.storage
    .from(EXPORTIMPORT_BUCKET)
    .upload(objectPath, file.buffer, {
      contentType: file.mimetype,
      upsert: false,
    });

  if (error) {
    logger.error({ error, objectPath }, "storage: upload gagal");
    throw new Error(`Upload gagal: ${error.message}`);
  }

  logger.info({ objectPath }, "storage: upload berhasil");
  return objectPath;
}

// ── URL helpers ───────────────────────────────────────────────────────────────

/**
 * Dapatkan public URL untuk file di bucket "exportimport".
 * Catatan: getPublicUrl() SELALU mengembalikan URL — bahkan jika bucket private.
 * Gunakan getAccessibleExportImportUrl() untuk memverifikasi aksesibilitas.
 */
export function getPublicUrl(filePath: string): string {
  if (!supabase) throw new Error("Supabase tidak dikonfigurasi");

  const { data } = supabase.storage
    .from(EXPORTIMPORT_BUCKET)
    .getPublicUrl(filePath);

  return data.publicUrl;
}

/**
 * Verifikasi public URL benar-benar accessible (HEAD request).
 * Jika gagal (bucket private / policy), generate signed URL 7 hari sebagai fallback.
 * Gunakan ini sebelum mengirim URL ke Fonnte.
 */
export async function getAccessibleExportImportUrl(
  storagePath: string,
  publicUrl: string,
): Promise<string> {
  if (!supabase) return publicUrl;

  // 1. HEAD check
  try {
    const headRes = await fetch(publicUrl, { method: "HEAD" });
    if (headRes.ok) {
      logger.info({ storagePath, mode: "public" }, "storage: public URL accessible");
      return publicUrl;
    }
    logger.warn({ storagePath, status: headRes.status }, "storage: public URL tidak accessible — fallback ke signed URL");
  } catch (err) {
    logger.warn({ storagePath, err }, "storage: HEAD request gagal — fallback ke signed URL");
  }

  // 2. Fallback: signed URL 7 hari
  const { data, error } = await supabase.storage
    .from(EXPORTIMPORT_BUCKET)
    .createSignedUrl(storagePath, 60 * 60 * 24 * 7);

  if (!error && data?.signedUrl) {
    logger.info({ storagePath, mode: "signed" }, "storage: signed URL 7 hari berhasil dibuat");
    return data.signedUrl;
  }

  logger.error({ storagePath, error }, "storage: signed URL gagal — pakai original URL");
  return publicUrl;
}

// ── WhatsApp Media ────────────────────────────────────────────────────────────

/**
 * Kirim pesan WhatsApp dengan attachment file via Fonnte.
 *
 * Fonnte mendukung pengiriman teks + file dalam satu request:
 * POST https://api.fonnte.com/send
 * { target, message, url: fileUrl, filename: fileName }
 *
 * @param target   - Nomor HP (format internasional, tanpa "+") atau Group JID (@g.us)
 * @param message  - Teks pesan yang menyertai file
 * @param fileUrl  - Public URL file di Supabase Storage
 * @param fileName - Nama file yang ditampilkan di WhatsApp
 */
export async function sendWhatsAppMedia({
  target,
  message,
  fileUrl,
  fileName,
}: {
  target: string;
  message: string;
  fileUrl: string;
  fileName: string;
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  // Ambil token terbaik yang tersedia
  const token = resolveToken(target);
  if (!token) {
    logger.warn({ target }, "sendWhatsAppMedia: FONNTE_TOKEN tidak dikonfigurasi — dilewati");
    return { success: false, error: "FONNTE_TOKEN tidak dikonfigurasi" };
  }

  const params = new URLSearchParams({
    target,
    message,
    url: fileUrl,
    filename: fileName,
  });

  logger.info(
    { target, fileName, fileUrl, messagePreview: message.slice(0, 80) },
    "sendWhatsAppMedia: mengirim ke Fonnte",
  );

  try {
    const res = await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: {
        Authorization: token,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const responseText = await res.text();

    if (!res.ok) {
      logger.error({ target, fileName, status: res.status, responseText }, "sendWhatsAppMedia: HTTP error");
      return { success: false, error: `Fonnte HTTP ${res.status}: ${responseText}` };
    }

    let data: { status?: boolean; id?: string; reason?: string };
    try {
      data = JSON.parse(responseText) as { status?: boolean; id?: string; reason?: string };
    } catch {
      return { success: false, error: `Fonnte response tidak valid: ${responseText}` };
    }

    if (!data.status) {
      logger.warn({ target, fileName, data }, "sendWhatsAppMedia: Fonnte status=false");
      return { success: false, error: data.reason ?? "Fonnte menolak pesan" };
    }

    logger.info({ target, fileName, messageId: data.id }, "sendWhatsAppMedia: berhasil dikirim");
    return { success: true, messageId: data.id };
  } catch (err) {
    logger.error({ err, target, fileName }, "sendWhatsAppMedia: exception");
    return { success: false, error: err instanceof Error ? err.message : "Network error" };
  }
}

// ── Token resolution (internal) ───────────────────────────────────────────────

/**
 * Pilih token Fonnte terbaik yang tersedia.
 * Untuk grup (@g.us): token pertama yang ada.
 * Untuk personal: token default, atau token pertama sebagai fallback.
 */
function resolveToken(target: string): string | undefined {
  // Default token (paling umum dipakai)
  const defaultToken = process.env.FONNTE_TOKEN;
  if (defaultToken) return defaultToken;

  // Fallback: cari FONNTE_TOKEN_1 sampai _10
  for (let i = 1; i <= 10; i++) {
    const t = process.env[`FONNTE_TOKEN_${i}`];
    if (t) return t;
  }

  return undefined;
}
