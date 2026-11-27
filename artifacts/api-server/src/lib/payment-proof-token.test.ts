import assert from "node:assert/strict";
import {
  generatePaymentProofToken,
  generatePaymentProofTokenWithCollisionRetry,
  isPaymentProofTokenFormat,
  isReservedCstDevOnboardingToken,
  isRootPaymentProofTokenFormat,
} from "./payment-proof-token";

const generatedTokens = Array.from({ length: 100 }, generatePaymentProofToken);
for (const token of generatedTokens) {
  assert.equal(token.length, 10);
  assert.match(token, /^[A-Za-z0-9_-]{10}$/);
}

assert.equal(isPaymentProofTokenFormat("K7mQ2xN8aP"), true);
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
  () => (collisionAttempts === 0 ? "AAAAAAAAAA" : "BBBBBBBBBB"),
);
assert.equal(reservedToken, "BBBBBBBBBB");
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

const cstDevEnv = {
  NODE_ENV: "development",
  PUBLIC_APP_BASE_URL: "https://dev-ai-task.cstlogistic.co.id",
  SUPABASE_URL_DEV: "https://xssrfshdrtdfupgqwfdw.supabase.co",
};
assert.equal(isRootPaymentProofTokenFormat("onboarding"), true);
assert.equal(isPaymentProofTokenFormat("onboarding"), true);
assert.equal(isReservedCstDevOnboardingToken("onboarding", cstDevEnv), true);
assert.equal(isReservedCstDevOnboardingToken("onboarding", {...cstDevEnv, APP_ENV: "development"}), true);
for (const token of ["K7mQ2xN8aP", "ONBOARDING", "onboarding/", "onboardingx", "/onboarding"]) {
  assert.equal(isReservedCstDevOnboardingToken(token, cstDevEnv), false);
}
for (const env of [
  {...cstDevEnv, NODE_ENV: "production"},
  {...cstDevEnv, NODE_ENV: "test"},
  {...cstDevEnv, APP_ENV: "production"},
  {...cstDevEnv, APP_ENV: ""},
  {...cstDevEnv, PUBLIC_APP_BASE_URL: "https://wrong.invalid"},
  {...cstDevEnv, SUPABASE_URL_DEV: "https://wrong.supabase.co"},
  {},
]) {
  assert.equal(isReservedCstDevOnboardingToken("onboarding", env), false);
}
let generated = 0;
const reservations: string[] = [];
assert.equal(await generatePaymentProofTokenWithCollisionRetry(
  async token => { reservations.push(token); },
  () => (++generated === 1 ? "onboarding" : "K7mQ2xN8aP"),
  cstDevEnv,
), "K7mQ2xN8aP");
assert.deepEqual(reservations, ["K7mQ2xN8aP"]);
let rejectedReservations = 0;
await assert.rejects(() => generatePaymentProofTokenWithCollisionRetry(
  async () => { rejectedReservations++; },
  () => "onboarding",
  cstDevEnv,
), /Unable to create payment proof short link/);
assert.equal(rejectedReservations, 0);
const prodReservations: string[] = [];
assert.equal(await generatePaymentProofTokenWithCollisionRetry(
  async token => { prodReservations.push(token); },
  () => "onboarding",
  {...cstDevEnv, NODE_ENV: "production"},
), "onboarding");
assert.deepEqual(prodReservations, ["onboarding"]);

console.log("Payment proof short-link token and CST-DEV reserved-route tests passed");