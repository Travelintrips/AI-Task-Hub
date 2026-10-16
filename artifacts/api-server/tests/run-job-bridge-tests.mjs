import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const artifactDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectDir = path.resolve(artifactDir, "../..");
const outputDir = path.join(artifactDir, "tmp");
const outputFile = path.join(outputDir, "job-bridge-validation.test.mjs");
await mkdir(outputDir, { recursive: true });
try {
  await build({
    entryPoints: [path.join(artifactDir, "src/lib/job-bridge-validation.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: outputFile,
    logLevel: "silent",
  });
  const bridge = await import(pathToFileURL(outputFile).href);
  assert.equal(bridge.requiredString("  hello  "), "hello");
  assert.equal(bridge.requiredString("  "), null);
  assert.equal(bridge.requiredString("x".repeat(129)), null);
  assert.equal(bridge.inList("OPENCLAW", bridge.bridgeSources), true);
  assert.equal(bridge.inList("ADMIN_OVERRIDE", bridge.bridgeSources), false);
  assert.equal(bridge.validLeaseSeconds(29), null);
  assert.equal(bridge.validLeaseSeconds(30), 30);
  assert.equal(bridge.validLeaseSeconds(900), 900);
  assert.equal(bridge.validLeaseSeconds(901), null);
  assert.equal(bridge.isTerminal("WAITING_FOR_ACK"), false);
  assert.equal(bridge.isTerminal("COMPLETED"), true);
  assert.equal(bridge.isTerminal("FAILED"), true);
  assert.equal(bridge.safeUuid("not-a-uuid"), false);
  assert.equal(bridge.safeUuid("550e8400-e29b-41d4-a716-446655440000"), true);
  const expectedSecret = "abcde12345abcde12345abcde12345abcde12345";
  assert.equal(bridge.matchServiceSecret(expectedSecret, expectedSecret), true);
  assert.equal(bridge.matchServiceSecret(expectedSecret, "wrong"), false);
  assert.equal(bridge.matchServiceSecret("short", "short"), false);
  assert.equal(bridge.matchServiceSecret(undefined, "anything"), false);
  const route = await readFile(path.join(artifactDir, "src/routes/job-bridge.ts"), "utf8");
  const migrationPath = path.join(projectDir, "supabase/migrations/20261013154257_ai_task_unified_job_registry.sql");
  const schema = await readFile(migrationPath, "utf8");
  assert.ok(route.includes("requireReceipt"), "ACK requires separate receiver credential");
  assert.ok(route.includes("WAITING_FOR_ACK"), "Result cannot directly mark job completed");
  assert.ok(route.includes("FOR UPDATE"), "Result and ACK must lock job rows");
  assert.ok(route.includes('replayed: true, status: "WAITING_FOR_ACK"'),
    "An interrupted source ACK can be retried without an event-id collision");
  assert.ok(route.includes('job.callback_id === "core-source:" + id'),
    "Only the canonical receiver-owned callback is eligible for ACK replay");
  assert.ok(route.includes("lease_until <= now()"), "Ownership change must be fenced by lease");
  assert.ok(schema.includes("UNIQUE (source, idempotency_key)"));
  assert.ok(schema.includes("event_id text NOT NULL UNIQUE"));
  for (const table of ["jobs", "job_events", "sessions"]) {
    assert.ok(schema.includes(`ALTER TABLE ai_task_bridge.${table} ENABLE ROW LEVEL SECURITY`));
  }
  const policyFile = path.join(outputDir, "ai-core-source-policy.test.mjs");
  await build({
    entryPoints: [path.join(artifactDir, "src/lib/ai-core-source-reconciliation-policy.ts")],
    bundle: true, format: "esm", platform: "node", outfile: policyFile, logLevel: "silent",
  });
  const policy = await import(pathToFileURL(policyFile).href);
  const dev = {
    NODE_ENV: "development",
    RUN_STARTUP_MIGRATIONS: "false",
    AI_TASK_DEV_SOURCE_RECONCILE_ENABLED: "true",
    AI_TASK_DEV_EXPECTED_PROJECT_ID: "xssrfshdrtdfupgqwfdw",
    SUPABASE_DATABASE_URL_DEV: "postgres://example.dev/xssrfshdrtdfupgqwfdw",
  };
  assert.equal(policy.devSourceReconciliationEnabled(dev), true);
  assert.equal(policy.devSourceReconciliationEnabled({ ...dev, NODE_ENV: "production" }), false);
  assert.equal(policy.devSourceReconciliationEnabled({ ...dev, RUN_STARTUP_MIGRATIONS: "true" }), false);
  assert.equal(policy.devSourceReconciliationEnabled({ ...dev, AI_TASK_DEV_SOURCE_RECONCILE_ENABLED: "false" }), false);
  assert.equal(policy.devSourceReconciliationEnabled({ ...dev, AI_TASK_DEV_EXPECTED_PROJECT_ID: "wrongproject" }), false);
  assert.equal(policy.devSourceReconciliationEnabled({ ...dev, SUPABASE_PROD_DATABASE_URL: "postgres://prod" }), false);
  assert.equal(policy.devSourceReconciliationEnabled({ ...dev, SUPABASE_DATABASE_URL: "postgres://prod" }), false);
  const reconcileCode = await readFile(path.join(artifactDir, "src/lib/ai-core-source-reconciliation.ts"), "utf8");
  assert.ok(reconcileCode.includes("verifyAndAckAiCoreSource"), "No unverified ACKs are synthesized");
  assert.ok(reconcileCode.includes("FOR UPDATE"), "Reconciliation locks each source job");
  assert.ok(reconcileCode.includes("ON CONFLICT(event_id) DO NOTHING"), "Replay must be idempotent");
  console.log("Unified job registry and DEV-only source reconciliation invariant tests passed");
} finally {
  await rm(outputFile, { force: true });
  await rm(path.join(outputDir, "ai-core-source-policy.test.mjs"), { force: true });
}
