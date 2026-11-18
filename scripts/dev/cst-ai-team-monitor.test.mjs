
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canReadDevTeam, canRunDevTeam, canaryVerdict, projectCanaryStatus, projectIndependentTeamGate, CANARY_STALE_AFTER_MS } from "../../artifacts/api-server/src/lib/cst-ai-team-contract.ts";

const base = new URL("../../artifacts/api-server/src/routes/cst-ai-team.ts", import.meta.url);
const route = readFileSync(base, "utf8");
const frontend = readFileSync(new URL("../../artifacts/ai-task-center/src/pages/cst-ai-team-monitor.tsx", import.meta.url), "utf8");

test("team monitor fails closed unless explicitly enabled in DEV", () => {
  const env = {CST_AI_TEAM_DEV_ENABLED:"true",NODE_ENV:"development",APP_ENV:"development"};
  assert.equal(canRunDevTeam(env),true);
  assert.equal(canRunDevTeam({...env,APP_ENV:"production"}),false);
  assert.equal(canRunDevTeam({...env,NODE_ENV:"production"}),false);
  assert.equal(canRunDevTeam({...env,CST_AI_TEAM_DEV_ENABLED:"false"}),false);
});
test("read-only monitor stays visible to existing DEV Super Admin even when canary is OFF", () => {
  const dev = {NODE_ENV:"development",APP_ENV:"development",CST_AI_TEAM_DEV_ENABLED:"false"};
  assert.equal(canReadDevTeam(dev), true);
  assert.equal(canRunDevTeam(dev), false);
  assert.equal(canReadDevTeam({...dev,APP_ENV:"production"}), false);
  assert.match(route,/requireCanary && !canRunDevTeam\(\)/);
  assert.match(route,/allow\(req, res, true\)/);
});
test("canary cannot claim a real AI Task completion without tenant and worker lineage", () => {
  assert.match(route, /operationalTaskBinding: \{ verified: false/);
  assert.match(route, /NO_VERIFIED_OPERATIONAL_TASK_COMPANY_AND_WORKER_CALLBACK/);
  assert.match(frontend, /task operasional terikat ke Company 1/);
  assert.match(frontend, /companyId berbeda tidak boleh otomatis dipetakan/);
});

test("actual worker readiness is separate from four-role diagnostic PASS", () => {
  assert.match(route,/fetchCstTeamAgentReadiness\(\)/);
  assert.match(route,/agentReadiness, operationalProbes, independentTeamGate, canRunCanary: canRunDevTeam\(\)/);
  assert.match(frontend,/PRESENCE_ONLY_NOT_EXECUTION_PROOF/);
  assert.match(frontend,/Online bukan bukti tugas selesai/);
  assert.match(frontend,/Heartbeat aktif — belum eligible/);
  assert.match(frontend,/Kondisi: \{worker.reportedHealth\}/);
  assert.match(frontend,/Status worker belum dapat diverifikasi/);
  assert.match(frontend,/Uji DEV terkunci/);
});
test("all four role evidence required; no skipped or failed role can PASS", () => {
  const all = ["coding","infrastructure","security","qa"].map(role=>({role,status:"completed",ok:true}));
  assert.equal(canaryVerdict(all),true);
  for (const role of ["coding","infrastructure","security","qa"]) {
    assert.equal(canaryVerdict(all.filter(x=>x.role!==role)),false);
  }
  assert.equal(canaryVerdict([...all,{role:"security",status:"failed",ok:false}]),false);
  assert.equal(canaryVerdict(all.map(x=>x.role==="qa"?{...x,ok:false}:x)),false);
});
test("stale or interrupted canary is BLOCKED rather than falsely running or PASS", () => {
  const start = new Date("2026-11-18T10:00:00Z");
  const now = start.getTime() + CANARY_STALE_AFTER_MS + 1;
  assert.deepEqual(projectCanaryStatus("processing", start, now), { status:"blocked", stale:true });
  assert.deepEqual(projectCanaryStatus("processing", null, now), { status:"blocked", stale:true });
  assert.deepEqual(projectCanaryStatus("processing", start, start.getTime() + CANARY_STALE_AFTER_MS), { status:"processing", stale:false });
  assert.deepEqual(projectCanaryStatus("completed", start, now), { status:"completed", stale:false });
  assert.match(route, /CANARY_INTERRUPTED_OR_STALE/);
  assert.match(frontend, /PASS diagnostik/);
});

test("existing JWT and explicit company guard protect reads and writes", () => {
  assert.match(route,/router\.get\("\/cst-ai-team\/monitor", requireAuth/);
  assert.match(route,/router\.post\("\/cst-ai-team\/runs", requireAuth/);
  assert.match(route,/req\.user\?\.role !== "super_admin"/);
  assert.match(route,/company !== "1"/);
  assert.match(route,/TEAM_SOURCE/);
});
test("canary is restricted to read-only diagnostics and does not claim signed final ACK", () => {
  assert.match(route,/ONLY_PREDEFINED_READ_ONLY_CANARY_SUPPORTED/);
  assert.match(route,/signatureVerified: false/);
  assert.match(route,/Never fake callbackVerified, attestationVerified, or finalAckVerified/);
  assert.doesNotMatch(route, /submitAiTaskCommand|submitAiTaskChatGptCommand|signToken\(|signingPermitted: true/);
  assert.match(frontend,/bukan empat GPT mandiri/);
  assert.match(frontend,/verifiedComplete/);
});

test("internal E2E worker probes are read-only, tenant-scoped and separate from canary PASS", () => {
  assert.match(route, /eq\(jobs\.companyId, company\)/);
  assert.match(route, /eq\(jobs\.source, "AI_TASK"\)/);
  assert.match(route, /like\(jobs\.title, "\[INTERNAL-E2E\]%"\)/);
  assert.match(route, /operationalProbes/);
  assert.match(frontend, /Tugas worker nyata — internal E2E DEV/);
  assert.match(frontend, /const trusted = workerCallbackPass && probe\.attestationVerified && probe\.finalAckVerified/);
  assert.match(frontend, /GAGAL — periksa ledger/);
  assert.match(frontend, /const workerCallbackPass = probe.status === "completed"/);
  assert.match(frontend, /probe.workerId === probe.assignedClientId && probe.callbackVerified/);
  assert.match(frontend, /const trusted = workerCallbackPass && probe.attestationVerified && probe.finalAckVerified/);
  assert.match(frontend, /WORKER SELESAI — callback PASS/);
  assert.match(frontend, /bukti attestation dan Final ACK independen belum tersedia/);
  assert.match(route, /resultSummary: jobs.resultSummary/);
  assert.match(route, /commandId: jobs.commandId/);
  assert.match(frontend, /Tugas gagal tidak boleh diulang/);
  // A diagnostic canary must still be explicitly barred from granting authority.
  assert.match(route, /operationalTaskBinding: \{ verified: false/);
});

test("four independent workers require real leases, handoff and verified QA Final ACK", () => {
  const now = new Date("2026-11-18T15:00:00Z");
  const blocked = projectIndependentTeamGate({
    registeredCodingWorkers: 4, activeLeasedCodingWorkers: 0, recordedAiHandoffs: 0,
  }, now);
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.verifiedIndependentTeam, false);
  assert.deepEqual(blocked.blockers, [
    "FOUR_ACTIVE_CODING_WORKERS_NOT_VERIFIED",
    "NO_PERSISTED_MULTIWORKER_HANDOFF",
    "FOUR_DISTINCT_AGENT_RECEIPTS_AND_INDEPENDENT_QA_FINAL_ACK_NOT_VERIFIED",
  ]);
  const presentNotVerified = projectIndependentTeamGate({
    registeredCodingWorkers: 4, activeLeasedCodingWorkers: 4, recordedAiHandoffs: 4,
  }, now);
  assert.equal(presentNotVerified.verifiedIndependentTeam, false);
  assert.deepEqual(presentNotVerified.blockers, [
    "FOUR_DISTINCT_AGENT_RECEIPTS_AND_INDEPENDENT_QA_FINAL_ACK_NOT_VERIFIED",
  ]);
  const unavailable = projectIndependentTeamGate(null, now);
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.activeLeasedCodingWorkers, null);
  assert.deepEqual(unavailable.blockers, ["CORE_CAPACITY_READBACK_UNAVAILABLE"]);
  assert.equal(projectIndependentTeamGate({
    registeredCodingWorkers: 2, activeLeasedCodingWorkers: 3, recordedAiHandoffs: 0,
  }).status, "unavailable");
});

test("independent team capacity uses existing global Core tables read-only, no tenant task promotion", () => {
  const query = route.slice(
    route.indexOf("async function fetchIndependentTeamGate()"),
    route.indexOf('router.get("/cst-ai-team/monitor"'),
  );
  assert.match(query, /ai_platform\.ai_workers/);
  assert.match(query, /ai_platform\.ai_coding_workstream_ai_handoffs/);
  assert.match(query, /lease_expires_at > now\(\)/);
  assert.doesNotMatch(query, /CREATE TABLE|ALTER TABLE|GRANT |INSERT INTO|DELETE FROM|db\.update\(|db\.insert\(/);
  assert.match(route, /fetchIndependentTeamGate\(\)/);
  assert.match(frontend, /Kesiapan tim AI independen — Core DEV/);
  assert.match(frontend, /Kapasitas global worker/);
  assert.match(frontend, /BELUM SIAP — belum ada empat receipt agen independen/);
  assert.match(frontend, /Kapasitas Core AI belum dapat dibaca/);
});
