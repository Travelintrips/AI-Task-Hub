
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canReadDevTeam, canRunDevTeam, canaryVerdict, projectCanaryStatus, CANARY_STALE_AFTER_MS } from "../../artifacts/api-server/src/lib/cst-ai-team-contract.ts";

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
  assert.match(route,/agentReadiness, canRunCanary: canRunDevTeam\(\)/);
  assert.match(frontend,/PRESENCE_ONLY_NOT_EXECUTION_PROOF/);
  assert.match(frontend,/Online bukan bukti tugas selesai/);
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
