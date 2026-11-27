import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { isEmployeeKasbonTask, isPendingBusinessTask } from "../src/lib/business-task-presentation.ts";

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
  assert.match(ui, /getJson<\{ jobs: BridgeJob\[]; hiddenTaskIds\?: number\[]; passiveEventClassification\?: PassiveEventClassification; sourceSyncGap\?: SourceSyncGap \}>\("\/api\/bridge\/admin\/jobs"\)/);
  assert.match(ui, /sourceLabel: "AI Tasks"/);
  assert.match(ui, /sourceLabel: j\.source === "AI_CORE" \? "AI Core"/);
  assert.match(ui, /sourceRows\.filter\(r => r\.bucket === "completed"\)/);
  assert.match(ui, /aria-pressed=\{status === s\.key/);
  assert.match(ui, /refetchInterval: false/);
  assert.match(ui, /postAdminCleanup/);
  assert.match(ui, /hide-dashboard-items/);
  assert.match(ui, /eligibleTaskIds/);
  assert.match(ui, /selectedTasks/);
  assert.match(ui, /hiddenTaskIds/);
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

test("exact persisted kasbon source and two observed business states form a separate bucket", () => {
  const source = "employee_kasbon_conversation";
  for (const status of ["in_progress", "ready_for_review"]) {
    assert.equal(isEmployeeKasbonTask({ source, status }), true);
    assert.equal(isPendingBusinessTask({ source, status }), true);
  }
  for (const status of ["new_inquiry", "completed", "failed", "cancelled", "paid"]) {
    assert.equal(isPendingBusinessTask({ source, status }), false);
  }
});
test("unrelated native tasks and free-text guesses cannot enter kasbon bucket", () => {
  for (const source of [undefined, null, "", "manual", "AI_CORE", "employee_kasbon_conversation_extra"]) {
    for (const status of ["in_progress", "ready_for_review"]) {
      assert.equal(isEmployeeKasbonTask({ source, status, title: "Kasbon Karyawan" }), false);
      assert.equal(isPendingBusinessTask({ source, status }), false);
    }
  }
});
test("business counts and filtering use native rows only and do not redefine bridge queue", () => {
  assert.match(ui, /bucket: isPendingBusinessTask\(t\) \? "business" : bucket\(t.status\)/);
  assert.match(ui, /sourceRows\.filter\(r => r\.bucket === "business"\)\.length/);
  assert.match(ui, /if \(status !== "all" && row.bucket !== status\) return false/);
  assert.match(ui, /bucket: isPassiveBridgeEvent\(j\) \? "passive" : bucket\(j.status\)/);
});
test("business labels preserve recorded status and explicitly avoid approval or payment inference", () => {
  assert.match(ui, /data-testid="business-workflow-note"/);
  assert.match(ui, /bukan bukti worker aktif, persetujuan Owner, pencairan dana, atau posting jurnal/);
  assert.match(ui, /<Badge variant=\{row.bucket === "business" \? "secondary" : badgeVariant\(row.status\)\}>\{row.status\}<\/Badge>/);
  assert.match(ui, /Terakhir diperbarui: \{stamp\(row.task.updatedAt\)\}/);
  assert.match(ui, /Status alur · bukan bukti pencairan/);
});
