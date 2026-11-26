/**
 * Explicit DEV-only CST WhatsApp Gateway adapter.
 * Never falls back to PROD or Fonnte. Uses separate, scoped DEV credentials only.
 */
const PHONE = /^[0-9]{8,16}$/;

export function jobWaRecipient(): string | null {
  const recipient = process.env.AI_CORE_JOB_WA_PHONE?.trim() ?? "";
  // Direct phone only until the DEV group registry can verify group ownership.
  return PHONE.test(recipient) && !(process.env.AI_CORE_JOB_WA_GROUP_JID?.trim()) ? recipient : null;
}

function allowedDevGatewayUrl(): string | null {
  const raw = process.env.AI_CORE_JOB_WA_GATEWAY_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" || url.hostname !== "cst-wa-gateway-dev-api-dev-1" ||
        url.port !== "8080" || url.pathname !== "/" || url.search || url.hash ||
        url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function jobWaConfig() {
  const enabled = process.env.AI_CORE_JOB_WA_ENABLED === "true";
  const groupConfigured = Boolean(process.env.AI_CORE_JOB_WA_GROUP_JID?.trim());
  const phoneConfigured = Boolean(jobWaRecipient());
  const gatewayConfigured = Boolean(allowedDevGatewayUrl() && process.env.AI_CORE_JOB_WA_API_TOKEN?.trim());
  return { enabled, groupConfigured, phoneConfigured, gatewayConfigured, ready: enabled && phoneConfigured && gatewayConfigured };
}

export type JobWaSendResult = { accepted: boolean; messageId?: string; reason?: string };
export type JobWaReceipt = { status: string; sentAt?: string; deliveredAt?: string; readAt?: string };

export async function probeJobWaDevGateway(): Promise<{ reachable: boolean; operational: boolean; onlineWorkers: number }> {
  const base = allowedDevGatewayUrl();
  if (!base) return { reachable: false, operational: false, onlineWorkers: 0 };
  try {
    const response = await fetch(`${base}/v1/status`, { signal: AbortSignal.timeout(4000) });
    const body = await response.json() as Record<string, unknown>;
    const onlineWorkers = Number(body.onlineWorkers ?? 0);
    return {
      reachable: true,
      operational: response.ok && onlineWorkers > 0 && body.overallStatus !== "degraded",
      onlineWorkers: Number.isFinite(onlineWorkers) ? onlineWorkers : 0,
    };
  } catch {
    return { reachable: false, operational: false, onlineWorkers: 0 };
  }
}

export async function sendJobViaDevWaGateway(
  recipientPhone: string,
  message: string,
  idempotencyKey: string,
): Promise<JobWaSendResult> {
  const base = allowedDevGatewayUrl();
  const token = process.env.AI_CORE_JOB_WA_API_TOKEN?.trim();
  if (!jobWaConfig().ready || !base || !token || !PHONE.test(recipientPhone) ||
      recipientPhone !== jobWaRecipient())
    return { accepted: false, reason: "DEV WhatsApp self-recipient or gateway is not configured" };
  const operational = await probeJobWaDevGateway();
  if (!operational.operational)
    return { accepted: false, reason: "DEV WhatsApp worker unavailable; no message enqueued" };
  try {
    const response = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({ type: "text", deviceId: "ai-core-dev-sender-01", to: recipientPhone, text: message, clientMessageId: idempotencyKey }),
      signal: AbortSignal.timeout(12_000),
    });
    const body = await response.json() as Record<string, unknown>;
    const accepted = response.ok && (body.status === "queued" || body.status === "duplicate");
    return {
      accepted,
      messageId: accepted && typeof body.messageId === "string" ? body.messageId : undefined,
      reason: accepted ? undefined : `WA gateway HTTP ${response.status}: ${String(body.error ?? "request not queued").slice(0, 160)}`,
    };
  } catch (error) {
    return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Read provider/worker-confirmed delivery state; queue accepted is not delivery. */
export async function fetchJobWaDevDeliveryReceipt(messageId: string): Promise<JobWaReceipt | null> {
  const base = allowedDevGatewayUrl();
  const token = process.env.AI_CORE_JOB_WA_API_TOKEN?.trim();
  if (!base || !token || !/^[0-9a-f-]{36}$/i.test(messageId)) return null;
  try {
    const response = await fetch(`${base}/v1/messages/${messageId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return null;
    const body = await response.json() as Record<string, unknown>;
    const status = typeof body.status === "string" ? body.status.toLowerCase() : "";
    if (!["queued", "processing", "sent", "delivered", "read", "failed"].includes(status)) return null;
    return {
      status,
      sentAt: typeof body.sentAt === "string" ? body.sentAt : undefined,
      deliveredAt: typeof body.deliveredAt === "string" ? body.deliveredAt : undefined,
      readAt: typeof body.readAt === "string" ? body.readAt : undefined,
    };
  } catch {
    return null;
  }
}
