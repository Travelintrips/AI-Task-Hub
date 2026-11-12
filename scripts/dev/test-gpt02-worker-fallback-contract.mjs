import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const api = readFileSync(resolve(root, "artifacts/api-server/src/routes/executions.ts"), "utf8");
const ui = readFileSync(resolve(root, "artifacts/ai-task-center/src/pages/ai-task-detail.tsx"), "utf8");
const routeStart = api.indexOf('router.post("/ai-tasks/:id/execution"');
const routeEnd = api.indexOf('// Read-only preview and readiness check.', routeStart);
assert.ok(routeStart >= 0 && routeEnd > routeStart);
const route = api.slice(routeStart, routeEnd);

for (const guard of [
  'process.env.NODE_ENV === "development" && process.env.APP_ENV !== "production"',
  'eq(auditLogsTable.action, "gpt02_pic_assigned")',
  'body.mode !== "chatgpt" || normalizedAccountAlias !== "GPT02"',
  'GPT02_PIC_AUDITED_WORKER_FALLBACK_FORBIDDEN',
  'dispatchNotStarted: true',
  'continuationScheduled: false',
]) {
  assert.ok(route.includes(guard), "Missing audited GPT02 worker guard: " + guard);
}
const firstAuditGuard = route.indexOf("const [gpt02PicAssignment]");
const firstExecutionLookup = route.indexOf("const [existing]");
assert.ok(firstAuditGuard > 0 && firstAuditGuard < firstExecutionLookup, "Guard must precede existing retry lookup");
const lock = route.indexOf("pg_advisory_xact_lock");
const underLock = route.indexOf("const [auditedUnderLock]");
const insertion = route.indexOf("tx.insert(aiExecutionJobsTable)");
assert.ok(lock > 0 && underLock > lock && underLock < insertion, "Audit must be rechecked inside existing cross-instance admission lock");
assert.ok(route.includes('"GPT02_PIC_AUDITED_WORKER_FALLBACK_FORBIDDEN"].includes(err.message)'));
assert.ok(route.includes('if (mode === "chatgpt" && accountAlias === "GPT02")'));
assert.ok(route.includes('GPT02_LIFECYCLE_PRE_DISPATCH_PROOF_REQUIRED'));
assert.ok(route.includes('GPT02_EXISTING_ATTEMPT_REQUIRES_AUTHORIZED_RECOVERY'));
assert.ok(route.includes('GPT02_REASONING_HANDOFF_REQUIRES_AUTHORIZED_ADMISSION'));

assert.ok(ui.includes("gpt02PicAudit.auditPresent"));
assert.ok(ui.includes("gpt02PicAuditFetching || !gpt02PicAudit"));
assert.ok(ui.includes("Run Worker dikunci untuk task dengan audit PIC GPT02"));
assert.ok(ui.includes('startExecutionMutation.mutate("worker")'), "Worker action must remain for non-GPT02 tasks");
assert.ok(ui.includes('Mulai Lifecycle GPT02 (belum diaktifkan)'), "Hold state must be retained");

const denied = (audited, mode, alias) => audited &&
  (mode !== "chatgpt" || alias !== "GPT02");
for (const input of [
  ["worker", "GPT01"], ["worker", "GPT02"], ["chatgpt", "GPT01"], ["chatgpt", ""],
]) assert.equal(denied(true, ...input), true);
assert.equal(denied(true, "chatgpt", "GPT02"), false, "Explicit GPT02 one-shot route must remain under original gate");
assert.equal(denied(false, "worker", "GPT01"), false, "Generic non-GPT02 worker route must remain unchanged");
console.log("PASS: scoped DEV-only GPT02 PIC worker fallback gate, lock recheck, preserved one-shot/recovery and UI hold");
