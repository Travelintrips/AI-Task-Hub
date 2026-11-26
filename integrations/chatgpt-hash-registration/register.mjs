/**
 * AI Task "#" command handler (framework-neutral).
 *
 * Integration contract:
 * - principal must come from verified server auth; NEVER trust frontend metadata.
 * - sourceConversationId must come from authenticated ChatGPT connector / relay attestation.
 * - registry.findOrCreate must be atomic with UNIQUE (provider, sourceConversationId, principal.subject).
 * - registry owns the canonical conversation identifier and audit trail.
 * - caller must validate origin/authorization and rate-limit at the transport layer.
 *
 * This module does NOT intercept ChatGPT web messages on its own.
 */
export async function registerHashCommand({
  message,
  principal,
  sourceConversationId,
  provider = "chatgpt",
  registry,
  handshake,
  now = () => new Date().toISOString(),
}) {
  if (typeof message !== "string" || message.trim() !== "#") {
    return { handled: false };
  }
  if (!principal?.verified || !principal.subject || !principal.tenantId) {
    return { handled: true, ok: false, code: "UNAUTHORIZED" };
  }
  if (!sourceConversationId || typeof sourceConversationId !== "string") {
    return { handled: true, ok: false, code: "UNVERIFIED_CONVERSATION" };
  }
  if (typeof handshake !== "function" || typeof registry?.findOrCreate !== "function") {
    return { handled: true, ok: false, code: "INTEGRATION_UNAVAILABLE" };
  }
  try {
    const binding = await handshake({
      principal,
      provider,
      sourceConversationId,
    });
    if (!binding?.valid || binding.sourceConversationId !== sourceConversationId ||
        binding.subject !== principal.subject || binding.tenantId !== principal.tenantId) {
      return { handled: true, ok: false, code: "HANDSHAKE_REJECTED" };
    }
    const record = await registry.findOrCreate({
      provider,
      sourceConversationId,
      subject: principal.subject,
      tenantId: principal.tenantId,
      role: principal.role ?? null,
      boundAt: now(),
      attestationId: binding.attestationId ?? null,
    });
    if (!record?.conversationId || !record?.registrationId) {
      return { handled: true, ok: false, code: "REGISTRATION_NOT_ACKNOWLEDGED" };
    }
    return {
      handled: true,
      ok: true,
      code: "REGISTERED",
      conversationId: record.conversationId,
      registrationId: record.registrationId,
      created: record.created === true,
      ack: true,
    };
  } catch {
    return { handled: true, ok: false, code: "REGISTRATION_FAILED" };
  }
}
