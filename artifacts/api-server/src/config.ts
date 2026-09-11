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
    // Priority: Replit AI Integration proxy → fallback OPENAI_BASE_URL env → direct OpenAI
    baseUrl: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || process.env.OPENAI_BASE_URL || undefined,
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "_NOT_CONFIGURED_",
  },
  objectStorage: {
    bucketId: process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID || OBJECT_STORAGE_BUCKET_ID,
    privateDir:
      process.env.PRIVATE_OBJECT_DIR || `/${OBJECT_STORAGE_BUCKET_ID}/.private`,
    publicSearchPaths:
      process.env.PUBLIC_OBJECT_SEARCH_PATHS || `/${OBJECT_STORAGE_BUCKET_ID}/public`,
  },
  paymentProofShortLinkBaseUrl:
    process.env.PAYMENT_PROOF_SHORT_LINK_BASE_URL ||
    "https://e19fd6b8-6047-4953-aa51-f3b409d0c291-00-ydyf55pkhd6d.sisko.replit.dev",
} as const;
