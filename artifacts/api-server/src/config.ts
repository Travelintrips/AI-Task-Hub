const SUPABASE_PROJECT_REF = "nzdweipzckfszczzqtuw";
const SUPABASE_PROJECT_REF_DEV = "xssrfshdrtdfupgqwfdw";
const OBJECT_STORAGE_BUCKET_ID = "replit-objstore-e357cc66-19c3-4d73-9ca9-3069d78355d1";

export const config = {
  supabase: {
    url: process.env.SUPABASE_URL || `https://${SUPABASE_PROJECT_REF}.supabase.co`,
    urlDev: process.env.SUPABASE_URL_DEV || `https://${SUPABASE_PROJECT_REF_DEV}.supabase.co`,
    storageBucket:
      process.env.SUPABASE_STORAGE_BUCKET ||
      `https://${SUPABASE_PROJECT_REF}.storage.supabase.co/storage/v1/s3`,
  },
  openai: {
    baseUrl: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || undefined,
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "_NOT_CONFIGURED_",
  },
  objectStorage: {
    bucketId: process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID || OBJECT_STORAGE_BUCKET_ID,
    privateDir:
      process.env.PRIVATE_OBJECT_DIR || `/${OBJECT_STORAGE_BUCKET_ID}/.private`,
    publicSearchPaths:
      process.env.PUBLIC_OBJECT_SEARCH_PATHS || `/${OBJECT_STORAGE_BUCKET_ID}/public`,
  },
} as const;
