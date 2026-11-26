import test from "node:test";
import assert from "node:assert/strict";
import { registerHashCommand } from "./register.mjs";

const principal = { verified: true, subject: "user-01", tenantId: "tenant-01", role: "owner" };
const handshake = async ({ principal, sourceConversationId }) => ({
  valid: true,
  subject: principal.subject,
  tenantId: principal.tenantId,
  sourceConversationId,
  attestationId: "att-01",
});
const stored = new Map();
const registry = {
  async findOrCreate(input) {
    const key = [input.provider,input.sourceConversationId,input.subject].join(":");
    if (stored.has(key)) return { ...stored.get(key), created: false };
    const rec = { registrationId: "reg-01", conversationId: "conv-01", created: true };
    stored.set(key, rec);
    return rec;
  },
};
const request = { message: "#", principal, sourceConversationId: "source-01", registry, handshake };

test("ignores ordinary messages", async () => {
  assert.deepEqual(await registerHashCommand({ ...request, message: "hello" }), { handled: false });
});
test("rejects missing verified login", async () => {
  const r = await registerHashCommand({ ...request, principal: { subject: "user-01" } });
  assert.equal(r.code, "UNAUTHORIZED");
});
test("rejects absent source conversation binding", async () => {
  const r = await registerHashCommand({ ...request, sourceConversationId: "" });
  assert.equal(r.code, "UNVERIFIED_CONVERSATION");
});
test("rejects mismatched attestation", async () => {
  const r = await registerHashCommand({ ...request, handshake: async () => ({ valid: true, subject: "other", sourceConversationId:"source-01", tenantId:"tenant-01" }) });
  assert.equal(r.code, "HANDSHAKE_REJECTED");
});
test("requires registry ACK", async () => {
  const r = await registerHashCommand({ ...request, registry: { findOrCreate: async () => ({}) } });
  assert.equal(r.code, "REGISTRATION_NOT_ACKNOWLEDGED");
});
test("registration is idempotent", async () => {
  const a = await registerHashCommand(request);
  const b = await registerHashCommand(request);
  assert.equal(a.code, "REGISTERED");
  assert.equal(a.created, true);
  assert.equal(b.created, false);
  assert.equal(a.conversationId, b.conversationId);
});
