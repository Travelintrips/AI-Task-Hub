import assert from "node:assert/strict";
import { registerVerifiedChatgptReceipt } from "./register-verified-chatgpt-receipt.mjs";

const conversationId = "12345678-1234-1234-1234-123456789012";
const receipt = { conversationId, verifiedAssistantReply: true, evidenceFingerprint: "a".repeat(64), verifiedAt: new Date().toISOString() };
const aiTaskSession = { userJwt: "test-jwt", userId: 42, companyId: "test-tenant" };
const relaySecret = "test-secret-longer-than-thirty-two-bytes";
const originalFetch = globalThis.fetch;
let calls = 0;
globalThis.fetch = async (_url, options) => {
  calls++;
  assert.equal(options.headers.authorization, "Bearer test-jwt");
  return new Response(JSON.stringify({ ok: true, ack: true, registrationId: "test", conversationId: "test", created: true }), { status: 201 });
};
try {
  const args = { receipt, expectedConversationId: conversationId, aiTaskSession, relaySecret };
  await assert.rejects(registerVerifiedChatgptReceipt({ ...args, receipt: { ...receipt, verifiedAssistantReply: false } }), /Verified ChatGPT browser receipt required/);
  await assert.rejects(registerVerifiedChatgptReceipt({ ...args, receipt: { ...receipt, conversationId: "other" } }), /Verified ChatGPT browser receipt required/);
  await assert.rejects(registerVerifiedChatgptReceipt({ ...args, aiTaskSession: { ...aiTaskSession, userJwt: "" } }), /Authenticated AI Task user session required/);
  assert.equal(calls, 0);
  assert.equal((await registerVerifiedChatgptReceipt(args)).ack, true);
  assert.equal(calls, 1);
  console.log("PASS: fail-closed browser receipt and authenticated user handoff (mock)");
} finally { globalThis.fetch = originalFetch; }
