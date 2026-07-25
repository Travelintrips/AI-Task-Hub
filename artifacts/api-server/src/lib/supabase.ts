import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { logger } from "./logger";

import { config } from "../config";

const supabaseUrl =
  process.env.SUPABASE_SERVICE_ROLE_KEY
    ? config.supabase.url
    : config.supabase.urlDev;
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY_DEV;

if (!supabaseUrl || !supabaseServiceKey) {
  logger.warn("Supabase credentials not set — storage features will be unavailable");
}

export const supabase = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, {
      realtime: { transport: ws as unknown as typeof WebSocket },
    })
  : null;

const BUCKET = "ai-task-center-documents";

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

  // Gunakan getPublicUrl (bucket dibuat public: true) agar URL permanen tanpa expiry.
  // Fonnte perlu mengunduh file dari URL ini — public URL jauh lebih andal karena:
  // - Tidak ada token JWT yang bisa expire
  // - Tidak ada query string yang bisa gagal di-decode
  // - Bekerja konsisten dari server mana pun (termasuk Fonnte)
  const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(path);

  // Fallback: jika bucket belum public, gunakan signed read URL (7 hari)
  if (!publicData.publicUrl || !publicData.publicUrl.includes("/public/")) {
    const { data: signedReadData, error: signedReadError } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, 60 * 60 * 24 * 7); // 7 hari
    if (!signedReadError && signedReadData) {
      logger.info({ path, mode: "signed" }, "getUploadUrl: using signed read URL (bucket may not be public)");
      return {
        uploadUrl: data.signedUrl,
        publicUrl: signedReadData.signedUrl,
        path,
      };
    }
  }

  logger.info({ path, publicUrl: publicData.publicUrl, mode: "public" }, "getUploadUrl: using public URL");
  return {
    uploadUrl: data.signedUrl,
    publicUrl: publicData.publicUrl,
    path,
  };
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
