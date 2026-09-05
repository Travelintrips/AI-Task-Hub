import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { logger } from "./logger";

import { config } from "../config";

const isProduction = process.env.NODE_ENV === "production";
const supabaseUrl = isProduction ? config.supabase.url : config.supabase.urlDev;
const supabaseServiceKey = isProduction
  ? process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY_DEV
  : process.env.SUPABASE_SERVICE_ROLE_KEY_DEV || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  logger.warn("Supabase credentials not set — storage features will be unavailable");
}

export const supabase = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, {
      realtime: { transport: ws as unknown as typeof WebSocket },
    })
  : null;

const BUCKET = "ai-task-center-documents";
export const PAYMENT_PROOF_BUCKET = "payment-proofs";

export async function ensureBucket(): Promise<void> {
  if (!supabase) return;
  const { data: buckets } = await supabase.storage.listBuckets();
  const exists = buckets?.some((b) => b.name === BUCKET);
  if (!exists) {
    const { error } = await supabase.storage.createBucket(BUCKET, { public: true });
    if (error) {
      logger.error({ error }, "Failed to create Supabase bucket");
    } else {
      logger.info({ bucket: BUCKET }, "Created Supabase storage bucket");
    }
  }
}

/**
 * Pastikan bucket bukti pembayaran ada di project Supabase aktif.
 * Project aktif otomatis mengikuti environment server:
 * CST-DEV saat development dan Supabase Production saat production.
 */
export async function ensurePaymentProofBucket(): Promise<void> {
  if (!supabase) return;
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) {
    throw new Error(`Gagal memeriksa bucket ${PAYMENT_PROOF_BUCKET}: ${listError.message}`);
  }

  const exists = buckets?.some((bucket) => bucket.name === PAYMENT_PROOF_BUCKET);
  if (!exists) {
    const { error } = await supabase.storage.createBucket(PAYMENT_PROOF_BUCKET, {
      public: true,
      fileSizeLimit: 10 * 1024 * 1024,
      allowedMimeTypes: ["application/pdf", "image/jpeg", "image/png", "image/webp"],
    });
    if (error) {
      throw new Error(`Gagal membuat bucket ${PAYMENT_PROOF_BUCKET}: ${error.message}`);
    }
    logger.info({ bucket: PAYMENT_PROOF_BUCKET }, "Created payment proof storage bucket");
  }
}

export async function getUploadUrl(filename: string, _mimeType: string): Promise<{ uploadUrl: string; publicUrl: string; path: string }> {
  if (!supabase) {
    throw new Error("Supabase not configured");
  }

  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `uploads/${Date.now()}_${safeName}`;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data) {
    throw new Error(`Failed to create signed upload URL: ${error?.message}`);
  }

  // Coba public URL dulu — bucket dibuat dengan public: true.
  // PENTING: getPublicUrl() SELALU mengembalikan URL (bahkan jika bucket private),
  // jadi kita TIDAK bisa mengandalkan format URL saja. Kita harus cek aksesibilitas
  // setelah file di-upload (lihat getAccessibleUrl).
  const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(path);

  logger.info({ path, publicUrl: publicData.publicUrl, mode: "public" }, "getUploadUrl: signed upload URL created, public URL generated");
  return {
    uploadUrl: data.signedUrl,
    publicUrl: publicData.publicUrl,
    path,
  };
}

/**
 * Setelah file berhasil di-upload, verifikasi public URL benar-benar accessible.
 * Jika HEAD request gagal (bucket private/policy restricted), generate signed URL 7 hari
 * yang bisa diakses Fonnte tanpa login.
 *
 * Gunakan fungsi ini sebelum kirim URL ke Fonnte.
 */
export async function getAccessibleUrl(
  storagePath: string,
  originalUrl: string,
  bucketName: string = BUCKET,
): Promise<{ url: string; mode: "public" | "signed" | "original" }> {
  if (!supabase) {
    return { url: originalUrl, mode: "original" };
  }

  // 1. HEAD check pada public URL
  try {
    const headRes = await fetch(originalUrl, { method: "HEAD" });
    if (headRes.ok) {
      logger.info({ storagePath, status: headRes.status, mode: "public" }, "getAccessibleUrl: public URL OK");
      return { url: originalUrl, mode: "public" };
    }
    logger.warn(
      { storagePath, httpStatus: headRes.status, url: originalUrl },
      "getAccessibleUrl: public URL tidak accessible — fallback ke signed URL",
    );
  } catch (headErr) {
    logger.warn(
      { storagePath, headErr, url: originalUrl },
      "getAccessibleUrl: HEAD request gagal — fallback ke signed URL",
    );
  }

  // 2. Fallback: signed URL 7 hari (dapat diakses Fonnte tanpa auth)
  const { data: signedData, error: signedErr } = await supabase.storage
    .from(bucketName)
    .createSignedUrl(storagePath, 60 * 60 * 24 * 7);

  if (!signedErr && signedData?.signedUrl) {
    logger.info({ storagePath, mode: "signed" }, "getAccessibleUrl: signed URL 7 hari berhasil dibuat");
    return { url: signedData.signedUrl, mode: "signed" };
  }

  logger.error(
    { storagePath, signedErr },
    "getAccessibleUrl: signed URL gagal dibuat — pakai original URL sebagai fallback terakhir",
  );
  return { url: originalUrl, mode: "original" };
}

/**
 * Ekstrak storage path dari Supabase public URL.
 * Format: https://{project}.supabase.co/storage/v1/object/public/{bucket}/{path}
 * Returns: "uploads/..." atau null jika format tidak dikenali.
 */
export function extractStoragePath(publicUrl: string): string | null {
  try {
    const bucketName = extractStorageBucket(publicUrl);
    if (!bucketName) return null;
    const marker = `/object/public/${bucketName}/`;
    const idx = publicUrl.indexOf(marker);
    if (idx === -1) return null;
    const pathWithQuery = publicUrl.slice(idx + marker.length);
    return pathWithQuery.split("?")[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Return the Supabase Storage bucket encoded in a public object URL.
 * Payment proofs use a separate bucket from the regular task documents.
 */
export function extractStorageBucket(publicUrl: string): string | null {
  try {
    for (const bucketName of [BUCKET, PAYMENT_PROOF_BUCKET]) {
      if (publicUrl.includes(`/object/public/${bucketName}/`)) {
        return bucketName;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function uploadBuffer(
  buffer: Buffer,
  objectPath: string,
  mimeType: string,
): Promise<{ publicUrl: string; path: string }> {
  if (!supabase) throw new Error("Supabase not configured");

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(objectPath, buffer, { contentType: mimeType, upsert: true });

  if (error) throw new Error(`Upload failed: ${error.message}`);

  const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(objectPath);
  return { publicUrl: publicData.publicUrl, path: objectPath };
}

export async function uploadPaymentProofBuffer(
  buffer: Buffer,
  objectPath: string,
  mimeType: string,
): Promise<{ publicUrl: string; path: string }> {
  if (!supabase) throw new Error("Supabase not configured");

  const { error } = await supabase.storage
    .from(PAYMENT_PROOF_BUCKET)
    .upload(objectPath, buffer, { contentType: mimeType, upsert: false });

  if (error) throw new Error(`Payment proof upload failed: ${error.message}`);

  const { data: publicData } = supabase.storage
    .from(PAYMENT_PROOF_BUCKET)
    .getPublicUrl(objectPath);
  return { publicUrl: publicData.publicUrl, path: objectPath };
}
