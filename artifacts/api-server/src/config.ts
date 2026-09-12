const SUPABASE_PROJECT_REF = "nzdweipzckfszczzqtuw";
const SUPABASE_PROJECT_REF_DEV = "xssrfshdrtdfupgqwfdw";
const OBJECT_STORAGE_BUCKET_ID = "replit-objstore-e357cc66-19c3-4d73-9ca9-3069d78355d1";

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

const PRODUCTION_PUBLIC_BASE_URL = "https://ai-task.travelintrips.co.id";

/**
 * Resolve the canonical origin for every public link sent by AI Task Hub.
 *
 * Production uses the configured canonical domain and refuses to fall back to
 * a generated Replit hostname. Development intentionally uses the current
 * runtime domain so preview links continue to work, even if a production
 * PUBLIC_APP_BASE_URL is present in a shared environment.
 */
export function getPublicBaseUrl(): string {
  if (process.env.NODE_ENV === "production") {
    const configuredBaseUrl = normalizeBaseUrl(
      process.env.PUBLIC_APP_BASE_URL || PRODUCTION_PUBLIC_BASE_URL,
    );
    if (configuredBaseUrl !== PRODUCTION_PUBLIC_BASE_URL) {
      throw new Error(
        `PUBLIC_APP_BASE_URL must be ${PRODUCTION_PUBLIC_BASE_URL} in production`,
      );
    }
    return configuredBaseUrl;
  }

  const runtimeDomain =
    process.env.REPLIT_DEV_DOMAIN?.trim() ||
    process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (runtimeDomain) return `https://${runtimeDomain}`;

  return "http://localhost:8080";
}

/**
 * Build a public URL from the same canonical origin used by all customer-facing
 * links. Callers own the route path; the base origin stays config-driven here.
 */
export function getPublicUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${getPublicBaseUrl()}${normalizedPath}`;
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
