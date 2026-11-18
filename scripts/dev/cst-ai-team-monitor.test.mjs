
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canRunDevTeam, canaryVerdict } from "../../artifacts/api-server/src/lib/cst-ai-team-contract.ts";

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
test("all four role evidence required; no skipped or failed role can PASS", () => {
  const all = ["coding","infrastructure","security","qa"].map(role=>({role,status:"completed",ok:true}));
  assert.equal(canaryVerdict(all),true);
  for (const role of ["coding","infrastructure","security","qa"]) {
    assert.equal(canaryVerdict(all.filter(x=>x.role!==role)),false);
  }
  assert.equal(canaryVerdict([...all,{role:"security",status:"failed",ok:false}]),false);
  assert.equal(canaryVerdict(all.map(x=>x.role==="qa"?{...x,ok:false}:x)),false);
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
