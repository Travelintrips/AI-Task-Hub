import assert from "node:assert/strict";
import {
  generatePaymentProofToken,
  generatePaymentProofTokenWithCollisionRetry,
  isPaymentProofTokenFormat,
} from "./payment-proof-token";

const generatedTokens = Array.from({ length: 100 }, generatePaymentProofToken);
for (const token of generatedTokens) {
  assert.equal(token.length, 12);
  assert.match(token, /^[A-Za-z0-9_-]{12}$/);
}

assert.equal(isPaymentProofTokenFormat("K7mQ2xN8aP4z"), true);
assert.equal(isPaymentProofTokenFormat("A".repeat(24)), true);
assert.equal(isPaymentProofTokenFormat("A".repeat(11)), false);
assert.equal(isPaymentProofTokenFormat("A".repeat(13)), false);
assert.equal(isPaymentProofTokenFormat("A".repeat(25)), false);
assert.equal(isPaymentProofTokenFormat("not safe!12"), false);

let collisionAttempts = 0;
const reservedToken = await generatePaymentProofTokenWithCollisionRetry(
  async () => {
    collisionAttempts += 1;
    if (collisionAttempts === 1) {
      throw { code: "23505" };
    }
  },
  () => (collisionAttempts === 0 ? "AAAAAAAAAAAA" : "BBBBBBBBBBBB"),
);
assert.equal(reservedToken, "BBBBBBBBBBBB");
assert.equal(collisionAttempts, 2);

await assert.rejects(
  () =>
    generatePaymentProofTokenWithCollisionRetry(async () => {
      throw { code: "08006" };
    }),
  (error: unknown) =>
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "08006",
);

console.log("Payment proof short-link token tests passed");