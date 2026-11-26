import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const scratch = await mkdtemp(path.join(tmpdir(), "ai-job-wa-gateway-test-"));
const originalFetch = globalThis.fetch;
try {
  const outfile = path.join(scratch, "gateway.mjs");
  await build({
    entryPoints: [path.resolve(here, "../src/lib/ai-job-wa-gateway.ts")],
    platform: "node", format: "esm", bundle: true, outfile, logLevel: "silent",
  });
  const { jobWaConfig, probeJobWaDevGateway, sendJobViaDevWaGateway, fetchJobWaDevDeliveryReceipt } = await import(pathToFileURL(outfile).href);
  process.env.AI_CORE_JOB_WA_ENABLED = "true";
  process.env.AI_CORE_JOB_WA_PHONE = "628111167596";
  process.env.AI_CORE_JOB_WA_GATEWAY_URL = "http://cst-wa-gateway-dev-api-dev-1:8080";
  process.env.AI_CORE_JOB_WA_API_TOKEN = "fake-token-for-offline-test";
  assert.equal(jobWaConfig().ready, true);

  let calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    return { ok: false, status: 503, async json() {
      return { overallStatus: "degraded", onlineWorkers: 0 };
    }};
  };
  const down = await probeJobWaDevGateway();
  assert.equal(down.operational, false);
  const rejected = await sendJobViaDevWaGateway("628111167596", "Test", "event-001");
  assert.equal(rejected.accepted, false);
  assert.equal(calls.length, 2);
  assert.equal(calls.every(url => url.endsWith("/v1/status")), true, "Must never POST to gateway with zero workers");

  let posted = null;
  calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(url);
    if (url.endsWith("/v1/status")) return {
      ok: true, status: 200, async json() {
        return { overallStatus: "healthy", onlineWorkers: 1 };
      },
    };
    posted = options;
    return { ok: true, status: 202, async json() {
      return { status: "queued", messageId: "dev-queued-001" };
    }};
  };
  const queued = await sendJobViaDevWaGateway("628111167596", "Test", "event-001");
  assert.equal(queued.accepted, true);
  assert.equal(queued.messageId, "dev-queued-001");
  assert.equal(calls.length, 2);
  assert.equal(calls[1], "http://cst-wa-gateway-dev-api-dev-1:8080/v1/messages");
  assert.equal(posted.headers["Idempotency-Key"], "event-001");
  assert.equal(JSON.parse(posted.body).to, "628111167596");
  assert.equal(JSON.parse(posted.body).deviceId, "ai-core-dev-sender-01");

  // Configured self-recipient is the only destination authorized by this adapter.
  calls = [];
  const other = await sendJobViaDevWaGateway("628199999999", "Test", "event-cross-target");
  assert.equal(other.accepted, false);
  assert.equal(calls.length, 0);

  const messageId = "11111111-2222-3333-4444-555555555555";
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "http://cst-wa-gateway-dev-api-dev-1:8080/v1/messages/" + messageId);
    assert.ok(options.headers.Authorization.startsWith("Bearer "));
    return { ok: true, async json() {
      return { status: "delivered", messageId, deliveredAt: "2026-10-26T01:15:00+07:00" };
    }};
  };
  const receipt = await fetchJobWaDevDeliveryReceipt(messageId);
  assert.equal(receipt.status, "delivered");
  assert.equal(receipt.deliveredAt, "2026-10-26T01:15:00+07:00");
  assert.equal(await fetchJobWaDevDeliveryReceipt("unsafe-message-id"), null);

  process.env.AI_CORE_JOB_WA_GATEWAY_URL = "https://wa.cstlogistic.co.id";
  assert.equal(jobWaConfig().ready, false);
  calls = [];
  const forbidden = await sendJobViaDevWaGateway("628111167596", "Test", "event-002");
  assert.equal(forbidden.accepted, false);
  assert.equal(calls.length, 0, "Must not make a request to PROD gateway");
  console.log("PASS: DEV worker safety gate, no message when degraded, idempotent queue payload, PROD URL rejection");
} finally {
  globalThis.fetch = originalFetch;
  for (const name of ["AI_CORE_JOB_WA_ENABLED", "AI_CORE_JOB_WA_PHONE", "AI_CORE_JOB_WA_GATEWAY_URL", "AI_CORE_JOB_WA_API_TOKEN"]) delete process.env[name];
  await rm(scratch, { recursive: true, force: true });
}
