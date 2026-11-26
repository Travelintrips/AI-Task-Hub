import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const scratch = await mkdtemp(path.join(tmpdir(), "ai-job-wa-test-"));
try {
  const outfile = path.join(scratch, "formatter.mjs");
  // Build the real module with transport/database imports mocked.
  // The test has NO network access and cannot send any WhatsApp message.
  await build({
    entryPoints: [path.resolve(here, "../src/lib/ai-job-whatsapp.ts")],
    platform: "node",
    format: "esm",
    bundle: true,
    outfile,
    plugins: [{
      name: "no-io",
      setup(b) {
        b.onResolve({ filter: /^@workspace\/db$|^\.\/fonnte$|^\.\/logger$/ }, args => ({ path: args.path, namespace: "no-io" }));
        b.onLoad({ filter: /.*/, namespace: "no-io" }, args => ({
          contents: args.path === "@workspace/db"
            ? "export const aiExecutionEventsTable = {}; export const aiExecutionJobsTable = {}; export const whatsappNotificationsTable = {}; export const db = {};"
            : args.path === "./fonnte"
              ? "export async function sendFonnte(){throw new Error('Transport forbidden in test')}"
              : "export const logger = {warn(){}};",
          loader: "js",
        }));
      },
    }],
    logLevel: "silent",
  });
  const { formatAiJobWhatsApp, jobWaConfig } = await import(pathToFileURL(outfile).href);
  const now = new Date("2026-10-26T01:15:00+07:00");
  const createdAt = new Date("2026-10-26T01:00:00+07:00");
  const fixture = (id, title, workerId, status, seconds) => ({
    id, title, workerId, assignedClientId: null, status,
    createdAt,
    startedAt: new Date(now.getTime() - seconds * 1000),
    completedAt: status === "completed" || status === "failed" ? now : null,
  });
  const jobs = [
    fixture("12345678-0000-0000-0000-000000000001", "Gateway", "openclaw-pchp", "completed", 252),
    fixture("87654321-0000-0000-0000-000000000002", "Handshake", "openclaw-dell", "running", 155),
    fixture("abcdef01-0000-0000-0000-000000000003", "E2E Test", "OpenClaw Travelintrips", "queued", 0),
    fixture("55aa22cc-0000-0000-0000-000000000004", "OAuth", "openclaw-pchp", "failed", 370),
    fixture("ee44bb88-0000-0000-0000-000000000005", "Verified callbacks pending", "GPT02", "verifying", 65),
  ];
  const digest = formatAiJobWhatsApp(jobs, now);
  assert.match(digest, /📋 \*JOB MONITORING AI CORE\*/);
  assert.match(digest, /✅ 123456 \| Gateway \| HP \| 4m12s/);
  assert.match(digest, /🔄 876543 \| Handshake \| DELL \| 2m35s/);
  assert.match(digest, /⏳ ABCDEF \| E2E Test \| Travel \| —/);
  assert.match(digest, /❌ 55AA22 \| OAuth \| HP \| 6m10s/);
  assert.match(digest, /🔎 EE44BB \| Verified ca… \| GPT02/);
  for (const line of digest.split("\n").filter(line => line.includes(" | "))) {
    assert.ok([...line].length <= 46, "Each job must fit a narrow WhatsApp message: " + line);
  }
  assert.match(digest, /Total 5 · ✅ 1 · 🔄 2 · ⏳ 1 · ❌ 1 · ⚠️ 0/);
  assert.equal(digest.split("\n").filter(line => line.includes(" | ")).length, 5);

  process.env.AI_CORE_JOB_WA_ENABLED = "false";
  process.env.AI_CORE_JOB_WA_PHONE = "628111167596";
  process.env.AI_CORE_JOB_WA_API_TOKEN = "test-only-never-used";
  process.env.AI_CORE_JOB_WA_GATEWAY_URL = "http://cst-wa-gateway-dev-api-dev-1:8080";
  assert.equal(jobWaConfig().ready, false);
  process.env.AI_CORE_JOB_WA_ENABLED = "true";
  process.env.AI_CORE_JOB_WA_PHONE = "not-a-phone";
  assert.equal(jobWaConfig().ready, false);
  process.env.AI_CORE_JOB_WA_PHONE = "628111167596";
  process.env.AI_CORE_JOB_WA_GATEWAY_URL = "https://wa.cstlogistic.co.id";
  assert.equal(jobWaConfig().ready, false, "Must refuse PROD gateway URL");
  process.env.AI_CORE_JOB_WA_GATEWAY_URL = "http://cst-wa-gateway-dev-api-dev-1:8080";
  assert.equal(jobWaConfig().ready, true, "Only explicitly configured DEV gateway is allowed");
  delete process.env.AI_CORE_JOB_WA_ENABLED;
  delete process.env.AI_CORE_JOB_WA_PHONE;
  delete process.env.AI_CORE_JOB_WA_API_TOKEN;
  delete process.env.AI_CORE_JOB_WA_GATEWAY_URL;
  console.log("PASS: mobile digest, status symbols, agent, duration, totals, safe-off gates");
} finally {
  await rm(scratch, { recursive: true, force: true });
}
