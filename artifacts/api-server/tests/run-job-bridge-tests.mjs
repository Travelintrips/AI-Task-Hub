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
  assert.equal(bridge.projectAiCoreObservedStatus("ANALYZING", "QUEUED"), "RUNNING");
  assert.equal(bridge.projectAiCoreObservedStatus("REVIEW_REQUIRED", "QUEUED"), "REVIEW_REQUIRED");
  assert.equal(bridge.projectAiCoreObservedStatus("UNKNOWN", "QUEUED"), "QUEUED");
  assert.deepEqual(bridge.aiCoreSourceReconciliationPlan("COMPLETED"), {
    sourceStatus: "COMPLETED",
    eventKind: "RESULT_RECORDED",
    ledgerStatus: "WAITING_FOR_ACK",
    requiresAck: true,
  });
  assert.deepEqual(bridge.aiCoreSourceReconciliationPlan("FAILED"), {
    sourceStatus: "FAILED",
    eventKind: "WORKER_FAILED",
    ledgerStatus: "FAILED",
    requiresAck: false,
  });
  assert.deepEqual(bridge.aiCoreSourceReconciliationPlan("REVIEW_REQUIRED"), {
    sourceStatus: "REVIEW_REQUIRED",
    eventKind: "SOURCE_PROGRESS",
    ledgerStatus: "REVIEW_REQUIRED",
    requiresAck: false,
  });
  assert.equal(bridge.aiCoreSourceReconciliationPlan("RUNNING"), null);
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
    AI_TASK_PROD_SOURCE_RECONCILE_ENABLED: "false",
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
  assert.equal(policy.sourceReconciliationEnabled(dev), true);
  const prod = {
    NODE_ENV: "production",
    RUN_STARTUP_MIGRATIONS: "false",
    AI_TASK_DEV_SOURCE_RECONCILE_ENABLED: "false",
    AI_TASK_PROD_SOURCE_RECONCILE_ENABLED: "true",
    AI_TASK_PROD_RECONCILE_SCHEMA_READY: "true",
    AI_TASK_PROD_EXPECTED_PROJECT_ID: "nzdweipzckfszczzqtuw",
    SUPABASE_DATABASE_URL:
      "postgres://ai_task_runtime_login.nzdweipzckfszczzqtuw@example.prod/postgres",
  };
  assert.equal(policy.prodSourceReconciliationEnabled(prod), true);
  assert.equal(policy.sourceReconciliationEnabled(prod), true);
  assert.equal(policy.prodSourceReconciliationEnabled({ ...prod, NODE_ENV: "development" }), false);
  assert.equal(policy.prodSourceReconciliationEnabled({ ...prod, RUN_STARTUP_MIGRATIONS: "true" }), false);
  assert.equal(policy.prodSourceReconciliationEnabled({ ...prod, AI_TASK_PROD_SOURCE_RECONCILE_ENABLED: "false" }), false);
  assert.equal(policy.prodSourceReconciliationEnabled({ ...prod, AI_TASK_PROD_RECONCILE_SCHEMA_READY: "false" }), false);
  assert.equal(policy.prodSourceReconciliationEnabled({ ...prod, AI_TASK_PROD_EXPECTED_PROJECT_ID: "wrongproject" }), false);
  assert.equal(policy.prodSourceReconciliationEnabled({ ...prod, SUPABASE_DATABASE_URL_DEV: "postgres://dev" }), false);
  assert.equal(policy.prodSourceReconciliationEnabled({ ...prod, AI_TASK_DEV_SOURCE_RECONCILE_ENABLED: "true" }), false);
  assert.equal(policy.sourceReconciliationEnabled({
    ...dev,
    AI_TASK_PROD_SOURCE_RECONCILE_ENABLED: "true",
  }), false);
  const indexCode = await readFile(path.join(artifactDir, "src/index.ts"), "utf8");
  assert.ok(indexCode.includes("startAiCoreSourceReconciliationRuntime"),
    "The environment-gated source reconciler must start with the API runtime");
  const reconcileCode = await readFile(path.join(artifactDir, "src/lib/ai-core-source-reconciliation.ts"), "utf8");
  assert.ok(reconcileCode.includes("verifyAndAckAiCoreSource"), "No unverified ACKs are synthesized");
  assert.ok(reconcileCode.includes("FOR UPDATE"), "Reconciliation locks each source job");
  assert.ok(reconcileCode.includes("ON CONFLICT(event_id) DO NOTHING"), "Replay must be idempotent");
  assert.ok(reconcileCode.includes("status='REVIEW_REQUIRED'"),
    "Canonical review-required work must be mirrored without dispatch");
  assert.ok(reconcileCode.includes("!plan.requiresAck"),
    "Non-terminal review state must not synthesize an ACK");
  assert.ok(reconcileCode.includes("sourceReconciliationEnabled"),
    "Source reconciliation must remain behind environment and project gates");

  const deployWorkflow = await readFile(
    path.join(projectDir, ".github/workflows/hostinger-deploy.yml"), "utf8",
  );
  const monitorWorkflow = await readFile(
    path.join(projectDir, ".github/workflows/ai-task-ledger-prod-monitor.yml"), "utf8",
  );
  const prodAuditScriptPath = path.join(
    projectDir, "deploy/hostinger/verify-ai-task-ledger-prod.sh",
  );
  const prodAuditScript = await readFile(prodAuditScriptPath, "utf8");

  for (const marker of [
    "AI_TASK_PROD_SOURCE_RECONCILE_ENABLED': 'true'",
    "AI_TASK_PROD_RECONCILE_SCHEMA_READY': 'true'",
    "AI_TASK_PROD_EXPECTED_PROJECT_ID': expected_project_id",
    "AI_TASK_DEV_SOURCE_RECONCILE_ENABLED': 'false'",
    "RUN_STARTUP_MIGRATIONS': 'false'",
    "AI_TASK_PROD_INTERLOCK_",
    "verify-ai-task-ledger-prod.sh",
  ]) {
    assert.ok(deployWorkflow.includes(marker), `Production deploy is missing interlock marker: ${marker}`);
  }
  assert.ok(deployWorkflow.includes("AI_TASK_LEDGER_AUDIT_FAIL_ON_STALE=false"),
    "Deployment must reject mismatches and invalid ACKs without blocking on unrelated stale work");

  for (const marker of [
    "cron: \"17 * * * *\"",
    "issues: write",
    "AI_TASK_LEDGER_AUDIT_FAIL_ON_STALE=true",
    "[AI Task] PROD ledger reconciliation degraded",
    "ai-task-ledger-fingerprint:",
    "state:\"closed\"",
  ]) {
    assert.ok(monitorWorkflow.includes(marker), `Production monitor is missing invariant: ${marker}`);
  }

  for (const marker of [
    "BEGIN READ ONLY",
    "statement_timeout: 15_000",
    "nzdweipzckfszczzqtuw",
    "AI_TASK_BRIDGE_TOKEN_invalid",
    "bridge_tokens_not_distinct",
    "mismatch_count",
    "review_ack_violation_count",
    "stale_active_count",
    "AI_TASK_LEDGER_AUDIT=",
  ]) {
    assert.ok(prodAuditScript.includes(marker), `Read-only production audit is missing invariant: ${marker}`);
  }
  assert.equal(prodAuditScript.includes("set -x"), false,
    "Production audit must never enable shell tracing around runtime secrets");

  console.log("Unified job registry, production deploy, and ledger monitor invariant tests passed");
} finally {
  await rm(outputFile, { force: true });
  await rm(path.join(outputDir, "ai-core-source-policy.test.mjs"), { force: true });
}
