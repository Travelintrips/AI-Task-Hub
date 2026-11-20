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
  assert.match(src, /resolveOnboardingCustomerCompanyId/);
  assert.match(src, /JOIN companies company ON company.id = c.company_id/);
  assert.match(src, /company\.code = 'CST'/);
  assert.doesNotMatch(src, /company_id IS NULL OR/);
});
