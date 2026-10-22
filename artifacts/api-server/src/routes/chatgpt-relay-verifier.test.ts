import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyRelayBinding } from "./chatgpt-relay-verifier";

const secret = "unit-test-secret-that-is-long-enough-32-bytes";
function signed(now: number, overrides: Partial<{ sourceConversationId:string; userId:string; companyId:string; timestamp:string }> = {}) {
  const x = { sourceConversationId:"source-123456", userId:"user-1", companyId:"tenant-1", timestamp:String(now), ...overrides };
  const payload = [x.timestamp,"chatgpt",x.sourceConversationId,x.userId,x.companyId].join("\n");
  return { ...x, signature:createHmac("sha256",secret).update(payload).digest("hex") };
}
test("accepts a valid, recent relay binding", () => {
  const now = Date.now();
  assert.equal(verifyRelayBinding(signed(now),secret,now).ok,true);
});
test("rejects missing or weak secret", () => {
  assert.equal(verifyRelayBinding(signed(Date.now()),undefined).ok,false);
  assert.equal(verifyRelayBinding(signed(Date.now()),"short").ok,false);
});
test("rejects expired timestamp", () => {
  const now = Date.now();
  assert.equal(verifyRelayBinding(signed(now-6*60*1000),secret,now).ok,false);
});
test("rejects tampered conversation ID", () => {
  const now=Date.now(); const x=signed(now); x.sourceConversationId="other-source-123";
  assert.equal(verifyRelayBinding(x,secret,now).ok,false);
});
test("rejects tampered signature", () => {
  const now=Date.now(); const x=signed(now); x.signature="0".repeat(64);
  assert.equal(verifyRelayBinding(x,secret,now).ok,false);
});
