import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FOREIGN_CHALLENGE_ID, verifyForeignChallengeDenied,
} from "../../artifacts/ai-task-center/src/lib/gpt02-foreign-challenge-probe.ts";
import { OWNER_LEDGER_ORIGIN, ORIGINAL_OWNER_CHALLENGE_ID } from
  "../../artifacts/ai-task-center/src/lib/gpt02-original-owner-ledger.ts";

const TOKEN = "synthetic-only-browser-token";
const context = () => ({
  origin: OWNER_LEDGER_ORIGIN, role: "super_admin", getToken: () => TOKEN,
});
const response = (status, contentType = "application/json; charset=utf-8",
                  cacheControl = "no-store") => ({
  status, headers: new Headers({ "content-type": contentType, "cache-control": cacheControl }),
  json: () => assert.fail("Never read an error body"),
});

test("one browser GET uses a separate fixed UUID, exact bearer and no cookies", async () => {
  assert.notEqual(FOREIGN_CHALLENGE_ID, ORIGINAL_OWNER_CHALLENGE_ID);
  let calls = 0;
  const outcome = await verifyForeignChallengeDenied(context(), async (path, opts) => {
    calls++;
    assert.equal(path, "/api/gpt02-owner-ledger/decision/" + FOREIGN_CHALLENGE_ID);
    assert.equal(opts.method, "GET");
    assert.equal(opts.credentials, "omit");
    assert.equal(opts.redirect, "error");
    assert.equal(opts.cache, "no-store");
    assert.equal(opts.headers.Authorization, "Bearer " + TOKEN);
    assert.ok(opts.signal instanceof AbortSignal);
    return response(404);
  });
  assert.equal(outcome, "DENIED_404");
  assert.equal(calls, 1);
});

test("rejects wrong origin, non-admin and absent sessions before fetch", async () => {
  for (const c of [
    { ...context(), origin: "https://different.invalid" },
    { ...context(), role: "viewer" },
    { ...context(), getToken: () => null },
  ]) {
    await assert.rejects(
      verifyForeignChallengeDenied(c, async () => assert.fail("No HTTP call expected")),
    );
  }
});

test("only JSON no-store HTTP404 can PASS; no other status is accepted", async () => {
  for (const r of [
    response(200), response(401), response(403), response(503),
    response(404, "text/html"), response(404, "application/json", "public"),
  ]) {
    await assert.rejects(verifyForeignChallengeDenied(context(), async () => r),
      /GPT02_NEGATIVE_TEST_NOT_PROVEN/);
  }
});

test("network errors do not return PASS and never leak session contents", async () => {
  await assert.rejects(
    verifyForeignChallengeDenied(context(), async () => { throw Error("synthetic network failure"); }),
  );
});
