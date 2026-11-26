import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  assert.match(onboarding, /status: customerQueryFailed \? "unavailable" : "ok"/);
  assert.doesNotMatch(src, /company_id IS NULL OR/);
});
