import crypto from "node:crypto";
import { logger } from "./logger";

type RecentInboundItem = {
  messageId: string;
  providerMessageId?: string | null;
  deviceId: string | null;
  peer: string;
  body: string | null;
  messageType?: string | null;
  status?: string | null;
  createdAt: string;
};

function config() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("EMPLOYEE_KASBON_WA_GATEWAY_PROD_DISABLED");
  }
  const rawUrl = process.env.EMPLOYEE_KASBON_WA_GATEWAY_URL?.trim() || "";
  const token = process.env.EMPLOYEE_KASBON_WA_GATEWAY_TOKEN?.trim() || "";
  const deviceId = process.env.EMPLOYEE_KASBON_WA_DEVICE_ID?.trim() || "";
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("EMPLOYEE_KASBON_WA_GATEWAY_URL_INVALID");
  }
  const allowedLocal =
    url.protocol === "http:" &&
    ["127.0.0.1", "localhost"].includes(url.hostname) &&
    url.port === "8080";
  if (!allowedLocal) throw new Error("EMPLOYEE_KASBON_WA_GATEWAY_URL_NOT_ALLOWED");
  if (token.length < 32) throw new Error("EMPLOYEE_KASBON_WA_GATEWAY_TOKEN_MISSING");
  if (deviceId !== "ai-core") throw new Error("EMPLOYEE_KASBON_WA_DEVICE_NOT_ALLOWED");
  return { baseUrl: url.origin, token, deviceId };
}

function normalizePhone(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = "62" + digits.slice(1);
  if (digits.startsWith("8")) digits = "62" + digits;
  return digits;
}

export function employeeKasbonGatewayConfigured(): boolean {
  try {
    config();
    return true;
  } catch {
    return false;
  }
}

export async function sendEmployeeKasbonWa(input: {
  to: string;
  text: string;
  idempotencyKey?: string;
}): Promise<{ messageId: string }> {
  const { baseUrl, token, deviceId } = config();
  const to = normalizePhone(input.to);
  if (to.length < 10 || to.length > 16) throw new Error("EMPLOYEE_KASBON_WA_TO_INVALID");
  const idempotencyKey =
    input.idempotencyKey ||
    "kasbon-" + crypto.createHash("sha256").update(deviceId + "|" + to + "|" + input.text).digest("hex").slice(0, 40);
  const response = await fetch(baseUrl + "/v1/messages", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ to, type: "text", text: input.text, deviceId }),
    signal: AbortSignal.timeout(8_000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (response.status !== 202 || payload.status !== "queued" || typeof payload.messageId !== "string") {
    logger.warn({ status: response.status, error: payload.error }, "employee-kasbon gateway send rejected");
    throw new Error("EMPLOYEE_KASBON_WA_SEND_HTTP_" + response.status);
  }
  return { messageId: payload.messageId };
}

export async function readRecentEmployeeKasbonInbound(since: string, limit = 50): Promise<RecentInboundItem[]> {
  const { baseUrl, token, deviceId } = config();
  const url = new URL(baseUrl + "/v1/inbound-events/recent");
  url.searchParams.set("limit", String(Math.max(1, Math.min(100, Math.trunc(limit)))));
  url.searchParams.set("since", since);
  const response = await fetch(url, {
    headers: { Authorization: "Bearer " + token },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("EMPLOYEE_KASBON_WA_INBOUND_HTTP_" + response.status);
  const payload = await response.json() as { items?: RecentInboundItem[] };
  return (payload.items ?? []).filter((item) => item.deviceId === deviceId);
}
