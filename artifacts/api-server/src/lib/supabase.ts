import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { logger } from "./logger";

import { config } from "../config";

const supabaseUrl = config.supabase.url;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

  const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(path);

  return {
    uploadUrl: data.signedUrl,
    publicUrl: publicData.publicUrl,
    path,
  };
}
