/**
 * Read-only tenant normalization for the legacy numeric Customers ledger.
 * Only CST-DEV's exact `default` tenant can resolve to numeric company 1.
 * This NEVER assigns ownership to NULL customers or changes JWT identity.
 */
export interface OnboardingCustomerTenant {
  companyId: string;
  nodeEnv?: string;
  appEnv?: string;
  supabaseDevUrl?: string;
}

const CST_DEV_URL = "https://xssrfshdrtdfupgqwfdw.supabase.co";

export function resolveOnboardingCustomerCompanyId({
  companyId, nodeEnv, appEnv, supabaseDevUrl,
}: OnboardingCustomerTenant): number | null {
  if (companyId === "default") {
    return nodeEnv === "development" &&
      appEnv === "development" &&
      supabaseDevUrl?.trim().replace(/\/+$/, "") === CST_DEV_URL
      ? 1 : null;
  }
  if (!/^[1-9][0-9]*$/.test(companyId)) return null;
  const numericId = Number(companyId);
  return Number.isSafeInteger(numericId) ? numericId : null;
}
