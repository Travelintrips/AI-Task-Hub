import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { summarizeWhatsAppOnboarding } from "../../artifacts/api-server/src/lib/onboarding-wa-readiness.mjs";

test("DEV without any configured WA channel stays incomplete", () => {
  assert.deepEqual(summarizeWhatsAppOnboarding({}), {
    pct: 0, done: false, productionChannelReady: false, operationalChannel: "none",
  });
});
test("Meta alone stays partially configured", () => {
  assert.deepEqual(summarizeWhatsAppOnboarding({ metaConfigured: true }), {
    pct: 50, done: false, productionChannelReady: false, operationalChannel: "meta_partial",
  });
});
test("Only a VERIFIED operational DEV gateway completes DEV checklist, never PROD readiness", () => {
  for (const status of [false, null, undefined, "true", 1]) {
    assert.equal(summarizeWhatsAppOnboarding({ devGatewayOperational: status }).done, false);
  }
  assert.deepEqual(summarizeWhatsAppOnboarding({ devGatewayOperational: true }), {
    pct: 100, done: true, productionChannelReady: false, operationalChannel: "ai_core_dev",
  });
});
test("Existing Fonnte completion behavior and production readiness are preserved", () => {
  assert.deepEqual(summarizeWhatsAppOnboarding({ fonnteConfigured: true }), {
    pct: 100, done: true, productionChannelReady: true, operationalChannel: "fonnte",
  });
  assert.equal(summarizeWhatsAppOnboarding({ fonnteConfigured: true, devGatewayOperational: true }).operationalChannel, "fonnte");
});
test("onboarding endpoint is scoped to CST-DEV and performs read-only gateway checks only", () => {
  const src = readFileSync("artifacts/api-server/src/routes/system.ts", "utf8");
  assert.match(src, /companyId !== "default"/);
  assert.match(src, /process\.env\.NODE_ENV !== "development"/);
  assert.match(src, /process\.env\.APP_ENV !== "development"/);
  assert.match(src, /await probeJobWaDevGateway\(\)/);
  assert.doesNotMatch(src, /sendJobViaDevWaGateway/);
  assert.match(src, /productionChannelReady/);
  // PR #233 uses the authenticated numeric company in DEV; keep the
  // legacy PROD query and reject unresolved DEV companies before SQL.
  // Behavioral coverage also runs in onboarding-customers-scope.test.mjs.
  const onboarding = src.split('router.get("/system/onboarding-status"')[1]
    .split('router.post("/system/ai-test"')[0];
  assert.equal((onboarding.match(/\bconst custResult\b/g) ?? []).length, 1);
  assert.match(onboarding, /const sessionCompany = req\.user\?\.companyId;/);
  assert.match(onboarding, /let customerQueryFailed = isDev && !validNumericCompany;/);
  assert.match(onboarding, /const custResult = customerQueryFailed\s*\?\s*\{ rows: \[\{ total: 0, with_wa: 0 \}\] \}/);
  assert.match(onboarding, /FROM public\.customers WHERE company_id = \$\{Number\(numericCompany\)\}/);
  assert.match(onboarding, /FROM customers WHERE company_id = \$\{companyId\}/);
  assert.match(onboarding, /status: customerQueryFailed \? "unavailable" : customerVerificationPending \? "awaiting_verified_customer" : "ok"/);
  assert.match(onboarding, /done: !customerQueryFailed && \(requiresCstCustomerEvidence \? verifiedCustomerTotal === 1/);
  assert.match(onboarding, /JOIN public\.audit_logs a ON a\.id = 2656/);
  assert.match(onboarding, /fleet: fleetStep/);
  assert.doesNotMatch(src, /company_id IS NULL OR/);
});

test("read-only gateway probe requires exact CST-DEV identity, even with legacy APP_ENV absent", async () => {
  const src = readFileSync("artifacts/api-server/src/routes/system.ts", "utf8");
  const start = src.indexOf("async function readDevGatewayStatus(companyId: string)");
  const end = src.indexOf("// ── GET /api/system/whatsapp-health", start);
  assert.ok(start >= 0 && end > start);
  const helper = src.slice(start, end).replace("companyId: string", "companyId");
  const base = {
    NODE_ENV: "development",
    PUBLIC_APP_BASE_URL: "https://dev-ai-task.cstlogistic.co.id",
    SUPABASE_URL_DEV: "https://xssrfshdrtdfupgqwfdw.supabase.co",
  };
  async function run(env, companyId = "default", ready = true, operational = true) {
    let calls = 0;
    let configCalls = 0;
    const result = await runInNewContext(
      helper + "\nreadDevGatewayStatus(companyId)", {
        companyId,
        process: { env },
        jobWaConfig: () => { configCalls++; return { ready }; },
        probeJobWaDevGateway: async () => {
          calls++;
          return { operational, onlineWorkers: operational ? 1 : 0 };
        },
      },
    );
    return { result, calls, configCalls };
  }
  for (const env of [base, { ...base, APP_ENV: "development" }]) {
    const value = await run(env);
    assert.equal(value.calls, 1);
    assert.equal(value.configCalls, 1);
    assert.equal(value.result.operational, true);
    assert.equal(value.result.onlineWorkers, 1);
  }
  for (const env of [
    { ...base, APP_ENV: "production" },
    { ...base, APP_ENV: "" },
    { ...base, APP_ENV: "test" },
    { ...base, NODE_ENV: "production" },
    { ...base, NODE_ENV: "test" },
    { ...base, PUBLIC_APP_BASE_URL: undefined },
    { ...base, PUBLIC_APP_BASE_URL: "https://ai-task.cstlogistic.co.id" },
    { ...base, SUPABASE_URL_DEV: undefined },
    { ...base, SUPABASE_URL_DEV: "https://wrong.supabase.co" },
    { ...base, APP_ENV: "development", SUPABASE_URL_DEV: "https://wrong.supabase.co" },
  ]) {
    const value = await run(env);
    assert.equal(value.result, null);
    assert.equal(value.configCalls, 0);
    assert.equal(value.calls, 0);
  }
  for (const company of ["1", "2", "", "DEFAULT"]) {
    const value = await run(base, company);
    assert.equal(value.result, null);
    assert.equal(value.calls, 0);
  }
  const unconfigured = await run(base, "default", false);
  assert.equal(unconfigured.calls, 0);
  assert.equal(unconfigured.result.operational, false);
  const offline = await run(base, "default", true, false);
  assert.equal(offline.calls, 1);
  assert.equal(offline.result.operational, false);
  assert.equal(offline.result.onlineWorkers, 0);
});
