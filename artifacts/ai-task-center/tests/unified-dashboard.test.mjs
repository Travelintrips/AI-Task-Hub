import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { isEmployeeKasbonTask, isPendingBusinessTask, canNavigateToDevKasbonFinance, DEV_KASBON_FINANCE_URL, kasbonWorkflowState, kasbonWorkflowCounts } from "../src/lib/business-task-presentation.ts";

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

test("Finance navigation is limited to the canonical DEV host and management roles", () => {
  for (const role of ["owner", "super_admin"]) {
    assert.equal(canNavigateToDevKasbonFinance("dev-ai-task.cstlogistic.co.id", role), true);
  }
  for (const host of ["ai-task.cstlogistic.co.id", "localhost", "dev-ai-task.cstlogistic.co.id.example.invalid", ""]) {
    assert.equal(canNavigateToDevKasbonFinance(host, "super_admin"), false);
  }
  for (const role of ["staff", "finance", "admin", "company_admin", null, undefined]) {
    assert.equal(canNavigateToDevKasbonFinance("dev-ai-task.cstlogistic.co.id", role), false);
  }
});
test("Finance link carries no token, company query, or task ID and relies on independent session", () => {
  const destination = new URL(DEV_KASBON_FINANCE_URL);
  assert.equal(destination.origin, "https://dev-bizportal.cstlogistic.co.id");
  assert.equal(destination.pathname, "/expense/kasbon");
  assert.equal(destination.search, "");
  assert.equal(destination.hash, "");
  assert.match(ui, /canNavigateToDevKasbonFinance\(window.location.hostname, user\?\.role\)/);
  assert.match(ui, /<a href=\{DEV_KASBON_FINANCE_URL\} target="_blank" rel="noopener noreferrer"/);
  assert.match(ui, /referrerPolicy="no-referrer"/);
  assert.match(ui, /Gunakan sesi OTP BizPortal sendiri/);
  assert.match(ui, /Tautan ini tidak memberikan hak akses Finance/);
});

test("kasbon workflow counts distinguish pending review from in-progress only", () => {
  const native = (status) => ({ source: "employee_kasbon_conversation", status });
  const fixtures = [
    native("ready_for_review"), native("ready_for_review"),
    ...Array.from({length: 4}, () => native("in_progress")),
    native("completed"), native("paid"), native("failed"),
    {source: "manual", status: "ready_for_review"},
    {source: "AI_CORE", status: "in_progress"}, undefined,
  ];
  assert.deepEqual(kasbonWorkflowCounts(fixtures), {ready_for_review: 2, in_progress: 4});
  assert.deepEqual(kasbonWorkflowCounts([]), {ready_for_review: 0, in_progress: 0});
  assert.equal(kasbonWorkflowState(native("ready_for_review")), "ready_for_review");
  assert.equal(kasbonWorkflowState(native("in_progress")), "in_progress");
  for (const status of ["completed", "approved", "paid", "READY_FOR_REVIEW", "ready for review", " ready_for_review"]) {
    assert.equal(kasbonWorkflowState(native(status)), null);
  }
});
test("review chips filter existing native tasks without granting any finance action", () => {
  assert.match(ui, /tasks\.isSuccess && !tasks\.isFetching\s*\? kasbonWorkflowCounts\(sourceRows\.filter\(r => r\.kind === "task"\)\.map\(r => r\.task\)\)/);
  assert.match(ui, /status === "business" && kasbonFilter !== "all" &&\s*\(!tasks\.isSuccess \|\| tasks\.isFetching \|\| row\.kind !== "task" \|\| kasbonWorkflowState\(row\.task\) !== kasbonFilter\)/);
  const handler = ui.split("const chooseKasbonWorkflow = ")[1].split("const refreshAll = ")[0];
  assert.match(handler, /chooseSource\("task"\)/);
  assert.match(handler, /setStatus\("business"\)/);
  assert.match(handler, /setKasbonFilter\(next\)/);
  assert.ok(handler.includes('setSearch("");'));
  assert.doesNotMatch(handler, /fetch|mutate|postAdminCleanup|approve|disburse/);
  assert.match(ui, /data-testid="kasbon-review-filter"/);
  assert.match(ui, /data-testid="kasbon-in-progress-filter"/);
  assert.match(ui, /Status tugas tercatat saja; periksa bukti Finance terpisah/);
  assert.match(ui, /const chooseSource = [\s\S]+?setKasbonFilter\("all"\)/);
});
