import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ui = readFileSync(
  new URL("../../artifacts/ai-task-center/src/pages/ai-task-detail.tsx", import.meta.url), "utf8");
const guard = readFileSync(
  new URL("../../artifacts/api-server/src/lib/gpt02-preparation-admission.mjs", import.meta.url), "utf8");
const route = readFileSync(
  new URL("../../artifacts/api-server/src/routes/gpt02-preparation.ts", import.meta.url), "utf8");

test("prepared is described as a reservation, not an executed command", () => {
  assert.match(ui, /executionData\.execution\.status === "prepared"/);
  assert.match(ui, /Status: prepared — reservasi tercatat, bukan bukti worker berjalan/);
  assert.doesNotMatch(ui, /Status: prepared — (?:selesai|sukses|worker dijalankan)/);
});

test("existing execution is explained as independent review, not auto-retry", () => {
  assert.match(ui, /gpt02PreparationReadiness\.reason==="EXISTING_EXECUTION_REQUIRES_INDEPENDENT_REVIEW"/);
  assert.match(ui, /Persiapan ulang ditahan agar tidak menggandakan command/);
  assert.match(ui, /status prepared bukan izin dispatch/);
  assert.match(ui, /Boolean\(executionData\?\.execution\)/);
});

test("the existing server still denies duplicate preparation before any writer", () => {
  assert.match(guard, /existingExecutionCount !== 0/);
  assert.match(guard, /fail\('EXISTING_EXECUTION_REQUIRES_INDEPENDENT_REVIEW'\)/);
  assert.match(route, /existingExecutionCount:executions\.length/);
  const admissionPos = route.indexOf("const admission=facts.preparation;");
  const writePos = route.indexOf("const prepared=await factory.preparer.prepare(");
  assert.ok(admissionPos > 0 && writePos > admissionPos);
  assert.match(route.slice(admissionPos, writePos), /if \(!admission\.eligible \|\| !admission\.instruction\)/);
});

test("explaining the cause does not grant approval, issuer or dispatch", () => {
  assert.match(route, /dispatchPermitted:false,issuerGrantReady:false/);
  assert.match(route, /readOnly:true,commandDispatched:false,operatorApprovalGranted:false/);
  assert.match(ui, /NO-GO · belum ada izin dispatch/);
});
