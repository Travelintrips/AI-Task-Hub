import test from "node:test";
import assert from "node:assert/strict";
import { checkDevCutoverConfig } from "./ai-task-dev-cutover-config-gate.mjs";

const live = Object.freeze({
  NODE_ENV: "development", APP_ENV: "development",
  PUBLIC_APP_BASE_URL: "https://dev-ai-task.cstlogistic.co.id",
  SUPABASE_URL_DEV: "https://xssrfshdrtdfupgqwfdw.supabase.co",
  DEV_PASSWORDLESS_LOGIN: "true",
  AI_CORE_JOB_WA_ENABLED: "true",
  SESSION_SECRET: "synthetic-opaque-active-dev-session-secret-12345",
  SUPABASE_DATABASE_URL_DEV: "synthetic-only-database-url-for-dev",
  SUPABASE_ANON_KEY_DEV: "synthetic-anon-key",
  SUPABASE_SERVICE_ROLE_KEY_DEV: "synthetic-service-key",
  AI_CORE_DEV_BASE_URL: "https://example.invalid/dev-core",
  AI_CORE_DEV_CHECKPOINT_PUBLIC_KEY_DER_B64: "synthetic-public-signature",
  AI_CORE_JOB_WA_API_TOKEN: "synthetic-gateway-token",
  AI_CORE_JOB_WA_GATEWAY_URL: "http://synthetic-gateway:8080",
});
const preview = Object.freeze({
  NODE_ENV: "development", APP_ENV: "development",
  SESSION_SECRET: "synthetic-private-preview-secret-long-enough",
  RUN_STARTUP_MIGRATIONS: "false",
  DISABLE_STORAGE_BUCKET_AUTO_CREATE: "true",
  DISABLE_BACKGROUND_SCHEDULERS: "true",
  AI_CORE_JOB_WA_ENABLED: "false",
  VPS_STORAGE_INVENTORY_READONLY_ENABLED: "false",
  GPT02_CORE_PREPARATION_ENABLED: "false",
});
const handoff = Object.freeze({
  ...live, RUN_STARTUP_MIGRATIONS: "false",
  DISABLE_STORAGE_BUCKET_AUTO_CREATE: "true",
  DISABLE_BACKGROUND_SCHEDULERS: "false",
  VPS_STORAGE_INVENTORY_READONLY_ENABLED: "false",
  GPT02_CORE_PREPARATION_ENABLED: "false",
});
const previewArgs = Object.freeze({
  live, candidate: preview, mode: "preview",
  privateInternalNetwork: true, candidatePublishedPorts: 0,
  candidateReadOnlyRoot: true,
});

test("private candidate accepts isolated cold startup without existing session keys", () => {
  assert.deepEqual(checkDevCutoverConfig(previewArgs), { ok: true, failures: [] });
});
test("preview denies any second WA/Core worker or unsafe storage/DB startup", () => {
  for (const [key, value] of [
    ["DISABLE_BACKGROUND_SCHEDULERS", "false"],
    ["AI_CORE_JOB_WA_ENABLED", "true"],
    ["RUN_STARTUP_MIGRATIONS", "true"],
    ["DISABLE_STORAGE_BUCKET_AUTO_CREATE", "false"],
    ["VPS_STORAGE_INVENTORY_READONLY_ENABLED", "true"],
    ["GPT02_CORE_PREPARATION_ENABLED", "true"],
  ]) {
    assert.equal(checkDevCutoverConfig({
      ...previewArgs, candidate: { ...preview, [key]: value },
    }).ok, false, key);
  }
});
test("preview denies publicly exposed or writable-root containers", () => {
  for (const patch of [
    { privateInternalNetwork: false },
    { candidatePublishedPorts: 1 },
    { candidateReadOnlyRoot: false },
  ]) {
    const result = checkDevCutoverConfig({ ...previewArgs, ...patch });
    assert.equal(result.ok, false);
    assert.ok(result.failures.includes("PREVIEW_NETWORK_ISOLATION_INCOMPLETE"));
  }
});
test("handoff must wait for old worker stop, then preserve all active secrets and services", () => {
  assert.ok(checkDevCutoverConfig({
    live, candidate: handoff, mode: "handoff", oldBackendStopped: false,
  }).failures.includes("OLD_WORKER_NOT_STOPPED"));
  assert.deepEqual(checkDevCutoverConfig({
    live, candidate: handoff, mode: "handoff", oldBackendStopped: true,
  }), { ok: true, failures: [] });
});
test("handoff refuses changed session signing secret, Google auth, DB or WA integrations", () => {
  for (const key of [
    "SESSION_SECRET", "SUPABASE_DATABASE_URL_DEV",
    "SUPABASE_URL_DEV", "SUPABASE_ANON_KEY_DEV", "SUPABASE_SERVICE_ROLE_KEY_DEV",
    "AI_CORE_DEV_BASE_URL", "AI_CORE_DEV_CHECKPOINT_PUBLIC_KEY_DER_B64",
    "AI_CORE_JOB_WA_API_TOKEN", "AI_CORE_JOB_WA_GATEWAY_URL",
  ]) {
    const response = checkDevCutoverConfig({
      live, candidate: { ...handoff, [key]: "deliberately-wrong" },
      mode: "handoff", oldBackendStopped: true,
    });
    assert.ok(response.failures.includes("HANDOFF_PARITY_" + key), key);
  }
  for (const [key, value] of [
    ["PUBLIC_APP_BASE_URL", "https://wrong.invalid"],
    ["DEV_PASSWORDLESS_LOGIN", "false"],
    ["DISABLE_BACKGROUND_SCHEDULERS", "true"],
    ["AI_CORE_JOB_WA_ENABLED", "false"],
  ]) {
    assert.equal(checkDevCutoverConfig({
      live, candidate: { ...handoff, [key]: value },
      mode: "handoff", oldBackendStopped: true,
    }).ok, false, key);
  }
});
test("non-DEV, fallback signing key, missing primary project and unknown mode deny", () => {
  assert.equal(checkDevCutoverConfig({
    ...previewArgs, candidate: { ...preview, NODE_ENV: "production" },
  }).ok, false);
  assert.equal(checkDevCutoverConfig({
    ...previewArgs, candidate: { ...preview, SESSION_SECRET: "fallback-secret-change-in-production" },
  }).ok, false);
  assert.equal(checkDevCutoverConfig({
    ...previewArgs, live: { ...live, SUPABASE_URL_DEV: "https://other.supabase.co" },
  }).ok, false);
  assert.equal(checkDevCutoverConfig({
    ...previewArgs, mode: "other",
  }).ok, false);
});
test("failure reports contain only field names, never live credential values", () => {
  const result = checkDevCutoverConfig({
    live, candidate: { ...handoff, SESSION_SECRET: "different-secret-value-is-still-long-enough" },
    mode: "handoff", oldBackendStopped: true,
  });
  const message = JSON.stringify(result);
  assert.ok(!result.ok);
  for (const key of ["SESSION_SECRET", "SUPABASE_DATABASE_URL_DEV",
    "SUPABASE_SERVICE_ROLE_KEY_DEV", "AI_CORE_JOB_WA_API_TOKEN"]) {
    assert.ok(!message.includes(live[key]));
  }
});
