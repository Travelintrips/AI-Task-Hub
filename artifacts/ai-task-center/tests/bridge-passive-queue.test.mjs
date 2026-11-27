import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isPassiveBridgeEvent, isExecutionQueued } from "../src/lib/bridge-queue-presentation.ts";
const passive = { source: "AI_CORE", status: "QUEUED", queue_classification: "PASSIVE_EVENT" };
test("five passive rows are visible but never count as executing queue", () => {
  const rows = Array.from({length: 5}, () => ({...passive}));
  assert.equal(rows.length, 5);
  assert.equal(rows.filter(isPassiveBridgeEvent).length, 5);
  assert.equal(rows.filter(isExecutionQueued).length, 0);
});
test("ordinary or unverified queue rows remain counted, even with similar titles", () => {
  const rows = [{ source:"AI_CORE",status:"QUEUED",title:"EVENT_BINDING" },
    {...passive, queue_classification:null}, {...passive, queue_classification:"UNKNOWN"},
    {...passive, source:"CHATGPT"}, {...passive,status:"WAITING_FOR_WORKER"}];
  assert.equal(rows.filter(isPassiveBridgeEvent).length, 0);
  assert.equal(rows.filter(isExecutionQueued).length, 5);
});
test("FAILED/COMPLETED/RUNNING never get relabeled by a stale passive marker", () => {
  for (const status of ["FAILED","COMPLETED","RUNNING","WAITING_FOR_ACK"]) {
    assert.equal(isPassiveBridgeEvent({...passive,status}), false);
    assert.equal(isExecutionQueued({...passive,status}), false);
  }
});
test("all UI surfaces use the same bounded display predicate and retain raw history", () => {
  const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
  const dashboard = read("../src/pages/unified-dashboard.tsx");
  const registry = read("../src/pages/bridge-jobs.tsx");
  const visibility = read("../src/components/bridge-job-visibility.tsx");
  assert.match(dashboard, /bucket: isPassiveBridgeEvent\(j\) \? "passive" : bucket\(j.status\)/);
  assert.match(dashboard, /row.bucket === "passive"/);
  assert.match(registry, /rows.filter\(isExecutionQueued\)/);
  assert.match(registry, /rows.filter\(isPassiveBridgeEvent\)/);
  assert.match(registry, /\{j.status\}<\/Badge>/);
  assert.match(visibility, /jobs.filter\(isPassiveBridgeEvent\)/);
  for (const ui of [dashboard, registry, visibility]) assert.match(ui, /passiveEventClassification === "UNAVAILABLE"/);
});
test("existing Super Admin GET enrichment is DEV-only, canonical, and read-only", () => {
  const route = readFileSync(new URL("../../api-server/src/routes/job-bridge.ts", import.meta.url), "utf8");
  const list = route.split('router.get("/bridge/admin/jobs", ...adminOnly')[1].split('router.get("/bridge/admin/sessions"')[0];
  for (const marker of ['process.env.NODE_ENV === "development"', 'process.env.APP_ENV === undefined || process.env.APP_ENV === "development"', 'https://dev-ai-task.cstlogistic.co.id', 'https://xssrfshdrtdfupgqwfdw.supabase.co', "j.id=ANY($1::uuid[])", "j.source='AI_CORE'", "j.status='QUEUED'", "j.owner IS NULL", "j.lease_token IS NULL", "c.command_type='EVENT_BINDING'", "c.status='RECEIVED'", "coalesce(c.metadata_json->>'assignedClientId','')=''", 'passiveIds.clear()', 'passiveEventClassification = "UNAVAILABLE"']) assert.ok(list.includes(marker), marker);
  assert.doesNotMatch(list, /\b(?:INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|FOR\s+UPDATE)\b/i);
  assert.match(list, /queue_classification: "PASSIVE_EVENT"/);
  assert.doesNotMatch(list, /SELECT\s+c\.metadata_json|SELECT\s+c\.instruction/i);
});
