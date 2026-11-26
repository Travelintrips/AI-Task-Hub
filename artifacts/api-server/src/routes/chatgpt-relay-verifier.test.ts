import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyRelayBinding } from "./chatgpt-relay-verifier";

const secret = "0123456789abcdef0123456789abcdef";
const now = 1_800_000_000_000;
function signed(overrides: Partial<{ sourceConversationId: string; userId: string; companyId: string; timestamp: string; nonce: string }> = {}) {
  const input = { sourceConversationId: "conv_123456", userId: "u1", companyId: "c1", timestamp: String(now), nonce: "nonce_1234567890123456", ...overrides };
  const payload = [input.timestamp, "chatgpt", input.sourceConversationId, input.userId, input.companyId, input.nonce].join("\n");
  return { ...input, signature: createHmac("sha256", secret).update(payload).digest("hex") };
}
test("accepts a valid signed nonce", () => {
  assert.equal(verifyRelayBinding(signed(), secret, now).ok, true);
});
test("rejects missing or weak secret", () => {
  assert.equal(verifyRelayBinding(signed(), undefined, now).ok, false);
  assert.equal(verifyRelayBinding(signed(), "short", now).ok, false);
});
test("rejects expired timestamps", () => {
  assert.equal(verifyRelayBinding(signed({ timestamp: String(now - 300001) }), secret, now).ok, false);
});
test("rejects tampered conversation, nonce and signature", () => {
  const valid = signed();
  assert.equal(verifyRelayBinding({ ...valid, sourceConversationId: "conv_other" }, secret, now).ok, false);
  assert.equal(verifyRelayBinding({ ...valid, nonce: "nonce_other_123456789" }, secret, now).ok, false);
  assert.equal(verifyRelayBinding({ ...valid, signature: "f".repeat(64) }, secret, now).ok, false);
});
test("rejects malformed nonce", () => {
  assert.equal(verifyRelayBinding(signed({ nonce: "short" }), secret, now).ok, false);
});
