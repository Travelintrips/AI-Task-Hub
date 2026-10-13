import { createHash, timingSafeEqual } from "node:crypto";

export const bridgeSources = ["AI_CORE", "CHATGPT", "OPENCLAW", "WHATSAPP", "WORKER"] as const;
export const sessionStates = ["IDLE", "RUNNING", "SUSPECTED_STALL", "DISCONNECTED", "AUTH_REQUIRED"] as const;
export const terminalStates = ["COMPLETED", "FAILED"] as const;

export function requiredString(value: unknown, limit = 128): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned.length > 0 && cleaned.length <= limit ? cleaned : null;
}

export function inList<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.some((item) => item === value);
}

export function safeUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function isTerminal(status: unknown): boolean {
  return inList(status, terminalStates);
}

// Constant-time equality even when lengths differ. Compare digests, not raw secrets.
export function matchServiceSecret(expected: string | undefined, candidate: string | undefined): boolean {
  if (!expected || expected.length < 32 || !candidate) return false;
  const a = createHash("sha256").update(expected).digest();
  const b = createHash("sha256").update(candidate).digest();
  return timingSafeEqual(a, b);
}

export function validLeaseSeconds(input: unknown): number | null {
  const value = input === undefined ? 180 : input;
  return typeof value === "number" && Number.isInteger(value) && value >= 30 && value <= 900
    ? value : null;
}
