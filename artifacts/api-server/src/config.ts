const SUPABASE_PROJECT_REF = "nzdweipzckfszczzqtuw";
const SUPABASE_PROJECT_REF_DEV = "xssrfshdrtdfupgqwfdw";
const OBJECT_STORAGE_BUCKET_ID = "replit-objstore-e357cc66-19c3-4d73-9ca9-3069d78355d1";

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

/**
 * Resolve the canonical origin for every public link sent by AI Task Hub.
 *
 * Production must provide PUBLIC_APP_BASE_URL so public links never fall back
 * to the generated Replit deployment hostname. Development intentionally uses
 * the current runtime domain so preview links continue to work.
 */
export function getPublicBaseUrl(): string {
  const configuredBaseUrl = process.env.PUBLIC_APP_BASE_URL?.trim();
  if (configuredBaseUrl) return normalizeBaseUrl(configuredBaseUrl);

  if (process.env.NODE_ENV === "production") {
    throw new Error("PUBLIC_APP_BASE_URL must be configured in production");
  }

  const runtimeDomain =
    process.env.REPLIT_DOMAINS?.split(",")[0]?.trim() ||
    process.env.REPLIT_DEV_DOMAIN?.trim();
  if (runtimeDomain) return `https://${runtimeDomain}`;

  return "http://localhost:8080";
}

const publicBaseUrl = getPublicBaseUrl();

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
  publicBaseUrl,
  paymentProofShortLinkBaseUrl: publicBaseUrl,
} as const;
