import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const dir = new URL("../src/", import.meta.url);
const file = name => readFileSync(new URL(name, dir), "utf8");
const ui = file("pages/unified-dashboard.tsx");
const app = file("App.tsx");
const sidebar = file("components/layout/app-layout.tsx");

test("Dashboard is the one navigation entry; old detail routes remain intact", () => {
  assert.match(app, /<Route path="\/" component=\{UnifiedDashboard\}/);
  assert.match(app, /<Route path="\/ai-tasks" component=\{AiTaskBoard\}/);
  assert.match(app, /<Route path="\/bridge-jobs" component=\{BridgeJobsPage\}/);
  assert.doesNotMatch(sidebar, /\{ name: "AI Tasks",\s*href:/);
  assert.doesNotMatch(sidebar, /\{ name: "Job Registry",\s*href:/);
  assert.match(sidebar, /\{ name: "Dashboard",\s*href:/);
});
test("Unified list uses native AI Tasks and the read-only registry with source labels", () => {
  assert.match(ui, /getJson<AiTask\[]>\("\/api\/ai-tasks"\)/);
  assert.match(ui, /getJson<\{ jobs: BridgeJob\[] \}>\("\/api\/bridge\/admin\/jobs"\)/);
  assert.match(ui, /sourceLabel: "AI Tasks"/);
  assert.match(ui, /sourceLabel: j\.source === "AI_CORE" \? "AI Core"/);
  assert.match(ui, /sourceRows\.filter\(r => r\.bucket === "completed"\)/);
  assert.match(ui, /aria-pressed=\{status === s\.key/);
  assert.match(ui, /refetchInterval: false/);
  assert.match(ui, /postAdminCleanup/);
  assert.match(ui, /hide-jobs/);
  assert.match(ui, /delete-sessions/);
  assert.match(ui, /Check All/);
});
test("Results are expanded on demand; only bridge UUIDs request event history", () => {
  assert.match(ui, /openedJob\?\.startsWith\("bridge:"\)/);
  assert.match(ui, /enabled: canSeeBridge && activeBridgeId !== null/);
  assert.match(ui, /\/api\/bridge\/admin\/jobs\//);
  assert.match(ui, /ACK Terverifikasi/);
  assert.match(ui, /href=\{"\/ai-tasks\/" \+ row\.rawId\}/);
  assert.match(ui, /\/bridge-jobs\?job=/);
});
test("Sessions don't fake presence, and source access respects super_admin", () => {
  assert.match(ui, /const canSeeBridge = user\?\.role === "super_admin"/);
  assert.match(ui, /enabled: canSeeBridge/);
  assert.match(ui, /Belum ada sesi yang tercatat/);
  assert.match(ui, /Sesi di Job Registry berbeda dari heartbeat worker AI Core/);
});
