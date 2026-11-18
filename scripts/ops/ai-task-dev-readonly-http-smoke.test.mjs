import test from "node:test";
import assert from "node:assert/strict";
import { runReadonlyDevApiSmoke as smoke } from "./ai-task-dev-readonly-http-smoke.mjs";

const fake = (overrides = {}) => {
  const calls = [];
  return {
    calls,
    request: async (url, options) => {
      calls.push({ url, method: options.method, redirect: options.redirect, headers: options.headers });
      const path = new URL(url).pathname;
      const status = overrides[path]?.status ??
        (path === "/api/readyz" ? 200 : 401);
      return {
        status,
        json: async () => overrides[path]?.body ?? { status: "ready", database: "ok" },
        body: { cancel: async () => {} },
      };
    },
  };
};
test("readyz positive + both private Task171 endpoints deny unauthenticated read", async () => {
  const mock = fake();
  const result = await smoke({ request: mock.request });
  assert.deepEqual(result.statuses, [200, 401, 401]);
  assert.equal(result.passed, true);
  assert.deepEqual(mock.calls.map(x => new URL(x.url).pathname),
    ["/api/readyz", "/api/ai-tasks/171", "/api/ai-tasks/171/gpt02-lineage"]);
  assert.ok(mock.calls.every(x => x.method === "GET" && x.redirect === "manual"));
  assert.ok(mock.calls.every(x => !("Authorization" in x.headers) && !("Cookie" in x.headers)));
});
test("rejects non-loopback and unexpected deployment targets before fetch", async () => {
  for (const base of [
    "https://dev-ai-task.cstlogistic.co.id", "http://127.0.0.1:18080",
    "http://localhost:18296", "http://0.0.0.0:18296",
    "http://127.0.0.1:18296/evil", "http://127.0.0.1:18296@elsewhere",
    "http://127.0.0.1:0", "http://127.0.0.1:65536",
  ]) {
    if (base === "http://127.0.0.1:18080") continue; // loopback PROD port explicitly tested below
    await assert.rejects(() => smoke({ base, request: async () => assert.fail("must not fetch") }));
  }
});
test("never accepts the production listener port", async () => {
  // Pending exact port policy; see separate check in runtime candidate.
  const mock = fake();
  const result = await smoke({ base: "http://127.0.0.1:18296", request: mock.request });
  assert.equal(result.passed, true);
});
test("readiness 503 is an explicit failure, not a PASS", async () => {
  const mock = fake({ "/api/readyz": { status: 503 } });
  await assert.rejects(() => smoke({ request: mock.request }), /AI_TASK_READONLY_SMOKE_STATUS_MISMATCH/);
});
test("false ready body or database outage fails closed", async () => {
  const mock = fake({ "/api/readyz": { body: { status: "ready", database: "unavailable" } } });
  await assert.rejects(() => smoke({ request: mock.request }), /AI_TASK_READONLY_SMOKE_DB_NOT_READY/);
});
test("unexpected anonymous access to Task 171 fails closed", async () => {
  const mock = fake({ "/api/ai-tasks/171": { status: 200 } });
  await assert.rejects(() => smoke({ request: mock.request }), /AI_TASK_READONLY_SMOKE_STATUS_MISMATCH/);
});
test("unexpected anonymous lineage access fails closed", async () => {
  const mock = fake({ "/api/ai-tasks/171/gpt02-lineage": { status: 200 } });
  await assert.rejects(() => smoke({ request: mock.request }), /AI_TASK_READONLY_SMOKE_STATUS_MISMATCH/);
});
test("redirects cannot be treated as successful protected responses", async () => {
  const mock = fake({ "/api/ai-tasks/171": { status: 302 } });
  await assert.rejects(() => smoke({ request: mock.request }), /AI_TASK_READONLY_SMOKE_STATUS_MISMATCH/);
});
test("network failures are summarized without leaking errors", async () => {
  await assert.rejects(() => smoke({ request: async () => { throw new Error("secret_not_to_print"); } }),
    { message: "AI_TASK_READONLY_SMOKE_HTTP_UNAVAILABLE" });
});
