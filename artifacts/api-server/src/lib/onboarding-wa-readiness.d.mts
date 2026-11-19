export interface WhatsappOnboardingInput {
  fonnteConfigured?: boolean;
  metaConfigured?: boolean;
  devGatewayOperational?: boolean;
}
export interface WhatsappOnboardingResult {
  pct: 0 | 50 | 100;
  done: boolean;
  productionChannelReady: boolean;
  operationalChannel: "fonnte" | "ai_core_dev" | "meta_partial" | "none";
}
export declare function summarizeWhatsAppOnboarding(
  input?: WhatsappOnboardingInput,
): WhatsappOnboardingResult;
