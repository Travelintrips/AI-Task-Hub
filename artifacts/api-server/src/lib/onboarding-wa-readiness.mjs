/**
 * Existing provider completeness, with a DEV-only read-only AI Core gateway
 * signal. A healthy DEV gateway never implies production WA readiness.
 */
export function summarizeWhatsAppOnboarding({
  fonnteConfigured = false,
  metaConfigured = false,
  devGatewayOperational = false,
} = {}) {
  const fonnte = fonnteConfigured === true;
  const meta = metaConfigured === true;
  const dev = devGatewayOperational === true;
  const pct = fonnte || dev ? 100 : meta ? 50 : 0;
  return {
    pct,
    done: pct === 100,
    productionChannelReady: fonnte,
    operationalChannel: fonnte ? "fonnte" : dev ? "ai_core_dev" : meta ? "meta_partial" : "none",
  };
}
