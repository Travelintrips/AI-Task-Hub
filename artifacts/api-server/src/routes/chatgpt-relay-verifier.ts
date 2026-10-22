import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Request } from "express";

const MAX_AGE_MS = 5 * 60 * 1000;
const SOURCE_ID = /^[a-zA-Z0-9_-]{6,160}$/;
const NONCE = /^[a-zA-Z0-9_-]{16,128}$/;

export type RelayBinding = {
  sourceConversationId: string;
  userId: string;
  companyId: string;
  timestamp: string;
  nonce: string;
  signature: string;
};

export function verifyRelayBinding(
  input: RelayBinding,
  secret: string | undefined,
  nowMs = Date.now(),
): { ok: true; nonceHash: string } | { ok: false; code: string } {
  if (!secret || Buffer.byteLength(secret) < 32) return { ok: false, code: "RELAY_NOT_CONFIGURED" };
  if (!SOURCE_ID.test(input.sourceConversationId)) return { ok: false, code: "INVALID_SOURCE_ID" };
  if (!NONCE.test(input.nonce)) return { ok: false, code: "INVALID_NONCE" };
  if (!/^\d{13}$/.test(input.timestamp) || !/^[a-f0-9]{64}$/i.test(input.signature)) {
    return { ok: false, code: "INVALID_SIGNATURE_FORMAT" };
  }
  const age = Math.abs(nowMs - Number(input.timestamp));
  if (!Number.isFinite(age) || age > MAX_AGE_MS) return { ok: false, code: "RELAY_TIMESTAMP_EXPIRED" };
  const payload = [input.timestamp, "chatgpt", input.sourceConversationId, input.userId, input.companyId, input.nonce].join("\n");
  const expected = createHmac("sha256", secret).update(payload).digest();
  const supplied = Buffer.from(input.signature, "hex");
  if (supplied.length !== expected.length || !timingSafeEqual(expected, supplied)) {
    return { ok: false, code: "RELAY_SIGNATURE_INVALID" };
  }
  return { ok: true, nonceHash: createHash("sha256").update(input.nonce).digest("hex") };
}

export function readRelayBinding(req: Request, sourceConversationId: string, userId: string, companyId: string) {
  return {
    sourceConversationId,
    userId,
    companyId,
    timestamp: req.header("x-chat-relay-timestamp") ?? "",
    nonce: req.header("x-chat-relay-nonce") ?? "",
    signature: req.header("x-chat-relay-signature") ?? "",
  };
}
