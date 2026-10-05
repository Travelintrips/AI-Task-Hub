function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

const isProduction = process.env.NODE_ENV === "production";

export function getPublicBaseUrl(): string {
  const configuredBaseUrl = process.env.PUBLIC_APP_BASE_URL?.trim();
  if (configuredBaseUrl) return normalizeBaseUrl(configuredBaseUrl);

  if (isProduction) {
    throw new Error("PUBLIC_APP_BASE_URL must be set in production");
  }

  return `http://localhost:${process.env.PORT ?? "8080"}`;
}

export function getPublicUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${getPublicBaseUrl()}${normalizedPath}`;
}

export function getPaymentProofShortLinkBaseUrl(): string {
  const override = process.env.PAYMENT_PROOF_SHORT_LINK_BASE_URL?.trim();
  return normalizeBaseUrl(override || getPublicBaseUrl());
}

const publicBaseUrl = getPublicBaseUrl();
const paymentProofShortLinkBaseUrl = getPaymentProofShortLinkBaseUrl();

export const config = {
  supabase: {
    url: process.env.SUPABASE_URL?.trim() || "",
    urlDev: process.env.SUPABASE_URL_DEV?.trim() || "",
  },
  openai: {
    baseUrl: process.env.OPENAI_BASE_URL?.trim() || undefined,
    apiKey: process.env.OPENAI_API_KEY?.trim() || "_NOT_CONFIGURED_",
  },
  publicBaseUrl,
  paymentProofShortLinkBaseUrl,
} as const;
