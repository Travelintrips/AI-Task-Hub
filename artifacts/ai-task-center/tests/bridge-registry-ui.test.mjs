import { summarizeSourceGap } from "../src/lib/source-gap-presentation.ts";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
const root = new URL("../src/", import.meta.url);
const read = relative => readFileSync(new URL(relative, root), "utf8");
const registry = read("pages/bridge-jobs.tsx");
const visibility = read("components/bridge-job-visibility.tsx");
const dashboard = read("pages/dashboard.tsx");
const aiTasks = read("pages/ai-task-board.tsx");

test("Stat cards filter the returned registry jobs", () => {
  assert.match(registry, /type SummaryFilter = "all" \| "running" \| "waiting" \| "attention" \| "queued" \| "passive"/);
  assert.match(registry, /aria-pressed=\{filter === stat.key\}/);
  assert.match(registry, /onClick=\{\(\) => setFilter\(/);
  assert.match(registry, /filter === "attention" && attention\(j.status\)/);
  assert.match(registry, /100 job terbaru \(maks\.\)/);
});
test("On-demand job details expose real event and ACK history", () => {
  assert.match(registry, /selectedJobId !== null/);
  assert.match(registry, /\/api\/bridge\/admin\/jobs\//);
  assert.match(registry, /ev.kind/);
  assert.match(registry, /j\.result_verified_at/);
  assert.match(registry, /aria-expanded=\{selectedJobId === j.id\}/);
});
test("Session detail expansion and truthful empty state", () => {
  assert.match(registry, /setSelectedSession/);
  assert.match(registry, /aria-expanded=\{selectedSession === key\}/);
  assert.match(registry, /Belum ada sesi tersimpan di Job Registry/);
});
test("Dashboard and AI Tasks show the read-only registry separately", () => {
  assert.match(dashboard, /BridgeJobVisibility location="dashboard"/);
  assert.match(aiTasks, /BridgeJobVisibility location="ai-tasks"/);
  assert.match(visibility, /\/api\/bridge\/admin\/jobs/);
  assert.match(visibility, /user\?\.role === "super_admin"/);
  assert.match(visibility, /refetchInterval: false/);
  assert.match(visibility, /href=\{"\/bridge-jobs\?job=" \+ encodeURIComponent\(job.id\)\}/);
  assert.doesNotMatch(visibility, /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
});

test("Failed job details present bounded canonical diagnostic without retry controls", () => {
  assert.match(registry, /j\.status === "FAILED" && events\.data\?\.failureDiagnostic/);
  assert.match(registry, /failureReasonLabels\[events\.data\.failureDiagnostic\.reasonCategory\]/);
  assert.match(registry, /Pengiriman belum terverifikasi/);
  assert.match(registry, /Hasil end-to-end belum terverifikasi/);
  assert.match(registry, /bukan izin retry atau bukti penyelesaian/);
  assert.match(registry, /status gagal tetap dipertahankan/);
  assert.doesNotMatch(registry, /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
});

test("failed response evidence is observational and has no automatic retry permission", () => {
  assert.match(registry, /REPORTED_EXECUTION_SIGNAL/);
  assert.match(registry, /REPORTED_NO_EXECUTION_SIGNAL/);
  assert.match(registry, /INCOMPLETE_STAGE_EVIDENCE/);
  assert.match(registry, /TERMINAL_EVIDENCE_UNCONFIRMED/);
  assert.match(registry, /belum membuktikan tidak ada efek samping/);
  assert.match(registry, /Retry otomatis tidak diizinkan/);
  assert.doesNotMatch(registry, /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
});

test("source gap breakdown distinguishes observations from worker backlog",()=>{
  const fixture=[...Array.from({length:4},()=>({category:"HANDSHAKE",sourceAckRecorded:false})),
    ...Array.from({length:4},()=>({category:"PROTECTED_WAKE",sourceAckRecorded:false}))];
  assert.deepEqual(summarizeSourceGap(8,fixture),{
    counts:{HANDSHAKE:4,PROTECTED_WAKE:4,PASSIVE_EVENT:0,OTHER_COMMAND:0},
    observed:8,complete:true,ackRecorded:0,ackNotRecorded:8
  });
  const partial=summarizeSourceGap(120,Array.from({length:100},()=>({category:"HANDSHAKE",sourceAckRecorded:true})));
  assert.equal(partial.complete,false); assert.equal(partial.observed,100); assert.equal(partial.ackRecorded,100);
  assert.equal(summarizeSourceGap(8,fixture.slice(1)),null);
  assert.equal(summarizeSourceGap(1,[{category:"OTHER_COMMAND",sourceAckRecorded:"false"}]),null);
  assert.equal(summarizeSourceGap(1,[{category:"__proto__",sourceAckRecorded:true}]),null);
  assert.equal(summarizeSourceGap(1,[{category:"UNKNOWN",sourceAckRecorded:true}]),null);
  assert.equal(summarizeSourceGap(0,[]).complete,true);
});
test("source gap summary never presents capped samples as complete or offers retries",()=>{
  const gap=read("components/bridge-source-gap.tsx");
  assert.match(gap,/summary.complete && summary.observed > 0/);
  assert.match(gap,/Sampel record yang ditampilkan/);
  assert.match(gap,/Command lainnya: \{summary.counts.OTHER_COMMAND\}/);
  assert.match(gap,/Bukan bukti hasil end-to-end/);
  assert.match(gap,/Jangan anggap sebagai antrean worker/);
  assert.doesNotMatch(gap,/fetch\(|method:|checkbox|onClick=|result_verified_at/);
});
