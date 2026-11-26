import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  OWNER_LEDGER_ORIGIN,
  ORIGINAL_OWNER_CHALLENGE_ID,
  ORIGINAL_OWNER_LEDGER_PATH,
  OriginalOwnerLedgerReadError,
  getOriginalOwnerLedgerErrorMessage,
  parseOriginalOwnerLedgerReceipt,
  readOriginalOwnerLedger,
} from "../../artifacts/ai-task-center/src/lib/gpt02-original-owner-ledger.ts";

// Synthetic session and receipt only; no live login, fetch, or ledger access.
const TOKEN = "synthetic-session-for-unit-test-only";
const PRIVATE_DIAGNOSTIC = "PRIVATE_UPSTREAM_DIAGNOSTIC_MUST_NOT_BE_RENDERED";
const context = () => ({ origin: OWNER_LEDGER_ORIGIN, role: "super_admin", getToken: () => TOKEN });
const receipt = () => ({
  challengeId: ORIGINAL_OWNER_CHALLENGE_ID,
  scope: "GPT02_RELOCK_CST_DEV",
  status: "CONSUMED",
  decision: "APPROVED",
  manifestSha256: "a".repeat(64),
  decidedAt: "2026-11-20T01:02:03.004Z",
  readOnly: true,
  executionPermitted: false,
  signingPermitted: false,
  dispatchPermitted: false,
  releaseDecision: "NO_GO",
});
const rejectCode = (code) => (cause) => {
  assert.ok(cause instanceof OriginalOwnerLedgerReadError);
  assert.equal(cause.code, code);
  assert.ok(!cause.message.includes(PRIVATE_DIAGNOSTIC));
  assert.ok(!cause.message.includes(TOKEN));
  return true;
};

test("one explicit read uses the original challenge, existing bearer, and no cookies or redirects", async () => {
  const sourceReceipt = receipt();
  const requests = [];
  const result = await readOriginalOwnerLedger(context(), async (path, options) => {
    requests.push({ path, options });
    return { status: 200, json: async () => sourceReceipt };
  });
  assert.equal(ORIGINAL_OWNER_CHALLENGE_ID, "9c4f21e1-48af-4f7f-9830-931b84e3e846");
  assert.equal(ORIGINAL_OWNER_LEDGER_PATH, "/api/gpt02-owner-ledger/decision/9c4f21e1-48af-4f7f-9830-931b84e3e846");
  assert.equal(requests.length, 1);
  const [{ path, options }] = requests;
  assert.equal(path, ORIGINAL_OWNER_LEDGER_PATH);
  assert.deepEqual({ ...options, signal: undefined }, {
    method: "GET", credentials: "omit", cache: "no-store", redirect: "error",
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" }, signal: undefined,
  });
  assert.ok(options.signal instanceof AbortSignal);
  assert.deepEqual(result, sourceReceipt);
  assert.notEqual(result, sourceReceipt);
  assert.equal(Object.keys(result).length, 11);
  assert.equal(result.releaseDecision, "NO_GO");
  assert.equal(result.executionPermitted, false);
  assert.equal(result.signingPermitted, false);
  assert.equal(result.dispatchPermitted, false);
  assert.ok(!JSON.stringify(result).includes(TOKEN));
});

test("wrong origin or non-Owner role is denied before touching the stored session", async () => {
  for (const [changes, code] of [
    [{ origin: "https://ai-task.cstlogistic.co.id" }, "ORIGIN_REQUIRED"],
    [{ origin: "http://dev-ai-task.cstlogistic.co.id" }, "ORIGIN_REQUIRED"],
    [{ role: "admin" }, "OWNER_REQUIRED"],
    [{ role: "owner" }, "OWNER_REQUIRED"],
  ]) {
    await assert.rejects(readOriginalOwnerLedger({
      ...context(), ...changes,
      getToken: () => assert.fail("session must not be read before origin/role guard"),
    }, async () => assert.fail("request must not run before origin/role guard")), rejectCode(code));
  }
});

test("missing session never calls the endpoint or fabricates authentication", async () => {
  await assert.rejects(readOriginalOwnerLedger({ ...context(), getToken: () => null },
    async () => assert.fail("missing session must not cause a request")), rejectCode("SESSION_REQUIRED"));
});

test("receipt parser rejects altered challenge, identity extras, malformed evidence, and new authority", () => {
  const invalid = [
    null,
    [],
    { ...receipt(), challengeId: "00000000-0000-4000-8000-000000000001" },
    { ...receipt(), ownerEmail: PRIVATE_DIAGNOSTIC },
    { ...receipt(), scope: "TASK190_RECOVERY" },
    { ...receipt(), status: "PENDING" },
    { ...receipt(), decision: "REJECTED" },
    { ...receipt(), manifestSha256: "A".repeat(64) },
    { ...receipt(), decidedAt: "2026-02-30T01:02:03.004Z" },
    { ...receipt(), decidedAt: "2026-11-20T01:02:03+00:00" },
    { ...receipt(), readOnly: false },
    { ...receipt(), executionPermitted: true },
    { ...receipt(), signingPermitted: true },
    { ...receipt(), dispatchPermitted: true },
    { ...receipt(), releaseDecision: "GO" },
  ];
  for (const value of invalid) assert.throws(() => parseOriginalOwnerLedgerReceipt(value), rejectCode("RESPONSE_INVALID"));
});

test("HTTP denials never consume the upstream body or automatically retry", async () => {
  for (const [status, code] of [
    [401, "SESSION_REQUIRED"], [403, "OWNER_REQUIRED"], [404, "NOT_FOUND"],
    [503, "UNAVAILABLE"], [500, "REQUEST_FAILED"], [201, "REQUEST_FAILED"],
  ]) {
    let calls = 0;
    await assert.rejects(readOriginalOwnerLedger(context(), async () => {
      calls += 1;
      return { status, json: () => assert.fail("error body must not be read") };
    }), rejectCode(code));
    assert.equal(calls, 1);
  }
});

test("a success-shaped response with extra secret data never becomes a receipt", async () => {
  await assert.rejects(readOriginalOwnerLedger(context(), async () => ({
    status: 200, json: async () => ({ ...receipt(), token: PRIVATE_DIAGNOSTIC }),
  })), rejectCode("RESPONSE_INVALID"));
});

test("invalid JSON, HTML fallback, session errors, and network errors remain redacted", async () => {
  await assert.rejects(readOriginalOwnerLedger(context(), async () => ({
    status: 200, json: async () => { throw new SyntaxError(`<html>${PRIVATE_DIAGNOSTIC}</html>`); },
  })), rejectCode("RESPONSE_INVALID"));
  await assert.rejects(readOriginalOwnerLedger({
    ...context(), getToken: () => { throw new Error(PRIVATE_DIAGNOSTIC); },
  }, async () => assert.fail("failed token lookup must not request")), rejectCode("REQUEST_FAILED"));
  let calls = 0;
  await assert.rejects(readOriginalOwnerLedger(context(), async () => {
    calls += 1;
    throw new Error(`${PRIVATE_DIAGNOSTIC} ${TOKEN}`);
  }), rejectCode("REQUEST_FAILED"));
  assert.equal(calls, 1);
  for (const cause of [new Error(PRIVATE_DIAGNOSTIC), PRIVATE_DIAGNOSTIC, { message: PRIVATE_DIAGNOSTIC }]) {
    assert.equal(getOriginalOwnerLedgerErrorMessage(cause), getOriginalOwnerLedgerErrorMessage(new OriginalOwnerLedgerReadError("REQUEST_FAILED")));
  }
});

test("the bounded read aborts at ten seconds and clears its timer", async (t) => {
  let expire;
  const handle = {};
  let cleared = false;
  t.mock.method(globalThis, "setTimeout", (callback, delay) => {
    assert.equal(delay, 10_000);
    expire = callback;
    return handle;
  });
  t.mock.method(globalThis, "clearTimeout", (value) => {
    assert.equal(value, handle);
    cleared = true;
  });
  const pending = readOriginalOwnerLedger(context(), async (_path, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error(PRIVATE_DIAGNOSTIC)), { once: true });
  }));
  expire();
  await assert.rejects(pending, rejectCode("TIMEOUT"));
  assert.equal(cleared, true);
});

test("the existing page wires only the explicit reader click to the existing session getter", () => {
  const src = readFileSync("artifacts/ai-task-center/src/pages/gpt02-owner-approval.tsx", "utf8");
  const start = src.indexOf("const readOriginalLedger = async () => {");
  assert.notEqual(start, -1);
  const end = src.indexOf("\n  };", start);
  assert.ok(end > start);
  const handler = src.slice(start, end);
  assert.match(handler, /readOriginalOwnerLedger\(\{/);
  assert.match(handler, /origin:\s*window\.location\.origin/);
  assert.match(handler, /role:\s*user\.role/);
  assert.match(handler, /getToken:\s*getStoredToken/);
  assert.doesNotMatch(handler, /\b(?:fetch|prepare|approve)\s*\(|\/prepare|\/approve|method:\s*["']POST/);
  assert.match(handler, /ledgerReadGeneration\.current === generation/);
  assert.equal((src.match(/\breadOriginalOwnerLedger\s*\(/g) ?? []).length, 1);
  assert.equal((src.match(/\breadOriginalLedger\b/g) ?? []).length, 2);
  const effects = [...src.matchAll(/useEffect\(\(\)\s*=>\s*\{([\s\S]*?)\},\s*\[[\s\S]*?\]\);/g)];
  assert.ok(effects.length > 0);
  for (const effect of effects) assert.doesNotMatch(effect[1], /\breadOriginal(?:Owner)?Ledger\s*\(/);
  const card = src.slice(src.indexOf('<Card data-testid="gpt02-original-owner-ledger">'));
  const readerCard = card.slice(0, card.indexOf("</Card>") + "</Card>".length);
  assert.match(readerCard, /onClick=\{readOriginalLedger\}/);
  assert.match(readerCard, /window\.location\.origin !== OWNER_LEDGER_ORIGIN/);
  assert.doesNotMatch(readerCard, /APPROVAL_UI_ENABLED|onClick=\{(?:prepare|approve)\}/);
  assert.match(readerCard, /ledgerReceipt\.releaseDecision/);
  assert.match(readerCard, /Execution: OFF/);
  assert.match(readerCard, /Signer: OFF/);
  assert.match(readerCard, /Dispatch: OFF/);
});
