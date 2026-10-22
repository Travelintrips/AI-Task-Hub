import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { registerChatgptConversation } from "./register-chatgpt-conversation.mjs";

const secret = "test-only-secret-with-at-least-32-characters";
const requests = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const body = JSON.parse(options.body);
  const headers = options.headers;
  assert.equal(new URL(url).pathname, "/api/chatgpt/conversations/register");
  assert.equal(headers.authorization, "Bearer test-authenticated-jwt");
  assert.equal(body.command, "#");
  const signed = [headers["x-chat-relay-timestamp"], "chatgpt", body.sourceConversationId, "42", "test-tenant", headers["x-chat-relay-nonce"]].join("\n");
  assert.equal(headers["x-chat-relay-signature"], createHmac("sha256", secret).update(signed).digest("hex"));
  requests.push(headers["x-chat-relay-nonce"]);
  return new Response(JSON.stringify({ ok: true, ack: true, registrationId: "test-registration", conversationId: "test-registration", created: true }), { status: 201 });
};
try {
  const args = { sourceConversationId: "verified-conversation-123", userJwt: "test-authenticated-jwt", userId: 42, companyId: "test-tenant", secret };
  assert.equal((await registerChatgptConversation(args)).ack, true);
  assert.equal((await registerChatgptConversation(args)).ack, true);
  assert.notEqual(requests[0], requests[1], "Each request must use a fresh nonce");
  await assert.rejects(registerChatgptConversation({ ...args, sourceConversationId: "bad" }), /Invalid verified conversation ID/);
  await assert.rejects(registerChatgptConversation({ ...args, baseUrl: "https://example.com" }), /DEV loopback only/);
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, code: "RELAY_REPLAY_REJECTED" }), { status: 409 });
  await assert.rejects(registerChatgptConversation(args), /RELAY_REPLAY_REJECTED/);
  console.log("PASS: signed request, ACK, unique nonce, invalid identity, remote URL, replay rejection response (mock)");
} finally {
  globalThis.fetch = originalFetch;
}
