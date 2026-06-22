import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getStoredToken } from "@/lib/auth-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Play,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Award,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Zap,
} from "lucide-react";
import { useLocation } from "wouter";

function apiFetch(path: string, opts?: RequestInit) {
  const token = getStoredToken();
  return fetch(path, {
    ...opts,
    headers: {
      ...(opts?.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts?.body ? { "Content-Type": "application/json" } : {}),
    },
  }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  });
}

interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
  durationMs: number;
}

interface ScenarioResult {
  scenarioName: string;
  phase: string;
  serviceType: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  errorMessage: string | null;
  checks: CheckResult[];
}

interface ReportData {
  runId: number;
  runName: string;
  suiteName: string;
  triggeredBy: string;
  status: string;
  totalScenarios: number;
  passed: number;
  failed: number;
  skipped: number;
  successRate: number;
  criticalFailures: number;
  rbacFailures: number;
  certified: boolean;
  goDecision: string;
  durationMs: number;
  startedAt: string;
  completedAt: string;
  phaseSummary: Record<string, { total: number; passed: number; failed: number }>;
  releaseCriteria: {
    successRateRequired: number;
    successRateActual: number;
    criticalFailuresRequired: number;
    criticalFailuresActual: number;
    rbacFailuresRequired: number;
    rbacFailuresActual: number;
    certificationMet: boolean;
  };
  scenarios: ScenarioResult[];
}

interface RunRow {
  id: number;
  runName: string;
  status: string;
  totalScenarios: number;
  passed: number;
  failed: number;
  successRate: number;
  certified: boolean;
  goDecision: string;
  durationMs: number;
  startedAt: string;
  completedAt: string;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "passed") return <Badge className="bg-green-100 text-green-800 border-0">{status}</Badge>;
  if (status === "failed") return <Badge className="bg-red-100 text-red-800 border-0">{status}</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}

function GoBadge({ decision }: { decision: string }) {
  if (decision === "GO") return <Badge className="bg-green-600 text-white border-0 text-sm px-3">🟢 GO</Badge>;
  return <Badge className="bg-red-600 text-white border-0 text-sm px-3">🔴 NO-GO</Badge>;
}

function PhaseLabel(phase: string) {
  const map: Record<string, string> = {
    business: "Business Scenarios",
    conversation: "Conversation Validation",
    "mini-form": "Mini Form Validation",
    "document-validation": "Document Validation",
    "task-gate": "Task Creation Gate",
    rbac: "RBAC Certification",
    regression: "Regression Detection",
  };
  return map[phase] ?? phase;
}

function ScenarioRow({ scenario }: { scenario: ScenarioResult }) {
  const [open, setOpen] = useState(false);
  const passCount = scenario.checks?.filter((c) => c.pass).length ?? 0;
  const totalCount = scenario.checks?.length ?? 0;

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors text-left"
        onClick={() => setOpen((o) => !o)}
      >
        {scenario.status === "passed"
          ? <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
          : scenario.status === "failed"
          ? <XCircle className="h-4 w-4 text-red-600 shrink-0" />
          : <Clock className="h-4 w-4 text-gray-400 shrink-0" />}
        <span className="flex-1 text-sm font-medium">{scenario.scenarioName}</span>
        <span className="text-xs text-muted-foreground shrink-0">{passCount}/{totalCount} checks</span>
        <Badge variant="outline" className="text-xs shrink-0">{PhaseLabel(scenario.phase)}</Badge>
        <span className="text-xs text-muted-foreground shrink-0">{scenario.durationMs}ms</span>
        {open ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
      </button>
      {open && (
        <div className="border-t bg-muted/20 px-4 py-3 space-y-1.5">
          {scenario.errorMessage && (
            <p className="text-xs text-red-600 mb-2">⚠ {scenario.errorMessage}</p>
          )}
          {(scenario.checks ?? []).map((c, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              {c.pass
                ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 mt-0.5 shrink-0" />
                : <XCircle className="h-3.5 w-3.5 text-red-500 mt-0.5 shrink-0" />}
              <span className={`font-medium shrink-0 ${c.pass ? "text-foreground" : "text-red-700"}`}>{c.name}</span>
              <span className="text-muted-foreground">— {c.detail}</span>
              <span className="ml-auto text-muted-foreground shrink-0">{c.durationMs}ms</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function QualityGatePage() {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [phaseFilter, setPhaseFilter] = useState<string>("all");

  const runsQ = useQuery<{ data: RunRow[] }>({
    queryKey: ["quality-gate-runs"],
    queryFn: () => apiFetch("/api/quality-gate/runs?limit=10"),
    staleTime: 30_000,
  });

  const reportQ = useQuery<{ data: ReportData | null }>({
    queryKey: ["quality-gate-report", selectedRunId],
    queryFn: () =>
      selectedRunId
        ? apiFetch(`/api/quality-gate/runs/${selectedRunId}`).then((d) => ({ data: d.data }))
        : apiFetch("/api/quality-gate/report"),
    staleTime: 30_000,
    enabled: true,
  });

  const runMutation = useMutation({
    mutationFn: (runName: string) =>
      apiFetch("/api/quality-gate/run", {
        method: "POST",
        body: JSON.stringify({ runName }),
      }),
    onSuccess: () => {
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["quality-gate-runs"] });
        qc.invalidateQueries({ queryKey: ["quality-gate-report"] });
      }, 35_000);
    },
  });

  const runs = runsQ.data?.data ?? [];
  const report = reportQ.data?.data;

  const phases = report
    ? [...new Set(report.scenarios.map((s) => s.phase))]
    : [];

  const filteredScenarios = report?.scenarios.filter(
    (s) => phaseFilter === "all" || s.phase === phaseFilter,
  ) ?? [];

  return (
    <div className="flex flex-col min-h-full bg-background">
      {/* Header */}
      <div className="border-b bg-card px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <ClipboardList className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Quality Gate — Certification Report</h1>
              <p className="text-sm text-muted-foreground">
                Sprint 9D end-to-end validation &amp; certification
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                qc.invalidateQueries({ queryKey: ["quality-gate-runs"] });
                qc.invalidateQueries({ queryKey: ["quality-gate-report"] });
              }}
            >
              <RefreshCw className="h-4 w-4 mr-1.5" />
              Refresh
            </Button>
            <Button
              size="sm"
              disabled={runMutation.isPending}
              onClick={() =>
                runMutation.mutate(`Run ${new Date().toLocaleString("id-ID")}`)
              }
            >
              <Play className="h-4 w-4 mr-1.5" />
              {runMutation.isPending ? "Memulai..." : "Jalankan Quality Gate"}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 p-6 space-y-6 overflow-auto">
        {runMutation.isSuccess && (
          <div className="p-3 rounded-lg border border-blue-200 bg-blue-50 text-sm text-blue-800">
            ✅ Quality gate run dimulai. Hasil akan tersedia dalam ~30 detik. Klik Refresh untuk memuat.
          </div>
        )}

        {/* Run history */}
        {runs.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Riwayat Run
            </h2>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setSelectedRunId(null)}
                className={`px-3 py-1.5 rounded-md text-xs border transition-colors ${!selectedRunId ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:bg-muted/40"}`}
              >
                Terbaru
              </button>
              {runs.map((run) => (
                <button
                  key={run.id}
                  onClick={() => setSelectedRunId(run.id)}
                  className={`px-3 py-1.5 rounded-md text-xs border transition-colors ${selectedRunId === run.id ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:bg-muted/40"}`}
                >
                  #{run.id} — {run.successRate != null ? run.successRate.toFixed(0) : "?"}%
                  {run.certified ? " 🟢" : " 🔴"}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* No report yet */}
        {!report && !reportQ.isLoading && (
          <div className="text-center py-16 text-muted-foreground">
            <ClipboardList className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm font-medium">Belum ada certification run</p>
            <p className="text-xs mt-1">Klik "Jalankan Quality Gate" untuk memulai</p>
          </div>
        )}
        {reportQ.isLoading && (
          <div className="flex items-center justify-center py-16">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        )}

        {report && (
          <>
            {/* Summary cards */}
            <section>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Ringkasan Sertifikasi
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <Card className="border shadow-sm">
                  <CardContent className="pt-4">
                    <div className="text-2xl font-bold">{report.totalScenarios}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">Total Skenario</div>
                  </CardContent>
                </Card>
                <Card className="border shadow-sm">
                  <CardContent className="pt-4">
                    <div className="text-2xl font-bold text-green-600">{report.passed}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">Passed</div>
                  </CardContent>
                </Card>
                <Card className="border shadow-sm">
                  <CardContent className="pt-4">
                    <div className={`text-2xl font-bold ${report.failed > 0 ? "text-red-600" : "text-muted-foreground"}`}>{report.failed}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">Failed</div>
                  </CardContent>
                </Card>
                <Card className="border shadow-sm">
                  <CardContent className="pt-4">
                    <div className={`text-2xl font-bold ${report.successRate >= 95 ? "text-green-600" : "text-red-600"}`}>
                      {report.successRate != null ? report.successRate.toFixed(1) : "?"}%
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">Success Rate</div>
                  </CardContent>
                </Card>
              </div>

              {/* Certification verdict */}
              <Card className={`border shadow-sm ${report.certified ? "border-green-300 bg-green-50" : "border-red-300 bg-red-50"}`}>
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {report.certified
                        ? <Award className="h-8 w-8 text-green-600" />
                        : <ShieldOff className="h-8 w-8 text-red-600" />}
                      <div>
                        <div className="font-bold text-lg">
                          {report.certified ? "✅ PRODUCTION CERTIFIED" : "❌ NOT CERTIFIED"}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {report.certified
                            ? "Semua kriteria release terpenuhi"
                            : `${report.criticalFailures} critical failure(s), ${report.rbacFailures} RBAC failure(s)`}
                        </div>
                      </div>
                    </div>
                    <GoBadge decision={report.goDecision} />
                  </div>
                </CardContent>
              </Card>
            </section>

            {/* Release criteria */}
            <section>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Release Criteria
              </h2>
              <Card className="border shadow-sm">
                <CardContent className="pt-4 space-y-3">
                  {[
                    {
                      label: "Success Rate ≥ 95%",
                      met: (report.releaseCriteria.successRateActual ?? 0) >= 95,
                      detail: `${(report.releaseCriteria.successRateActual ?? 0).toFixed(1)}% (min 95%)`,
                    },
                    {
                      label: "Critical Failures = 0",
                      met: report.releaseCriteria.criticalFailuresActual === 0,
                      detail: `${report.releaseCriteria.criticalFailuresActual} critical failure(s)`,
                    },
                    {
                      label: "RBAC Failures = 0",
                      met: report.releaseCriteria.rbacFailuresActual === 0,
                      detail: `${report.releaseCriteria.rbacFailuresActual} RBAC violation(s)`,
                    },
                    {
                      label: "Document Validation Gate Passed",
                      met: !report.scenarios.find((s) => s.scenarioName === "Document Validation Gate" && s.status === "failed"),
                      detail: report.scenarios.find((s) => s.scenarioName === "Document Validation Gate")?.status ?? "N/A",
                    },
                    {
                      label: "Task Creation Gate Passed",
                      met: !report.scenarios.find((s) => s.scenarioName === "Task Creation Gate" && s.status === "failed"),
                      detail: report.scenarios.find((s) => s.scenarioName === "Task Creation Gate")?.status ?? "N/A",
                    },
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-3">
                      {item.met
                        ? <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                        : <XCircle className="h-4 w-4 text-red-600 shrink-0" />}
                      <span className="text-sm font-medium">{item.label}</span>
                      <span className="text-sm text-muted-foreground ml-auto">{item.detail}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </section>

            {/* Phase summary */}
            <section>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Ringkasan per Phase
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Object.entries(report.phaseSummary).map(([phase, stats]) => (
                  <Card key={phase} className="border shadow-sm">
                    <CardContent className="pt-3 pb-3">
                      <div className="text-xs font-semibold text-muted-foreground mb-2">{PhaseLabel(phase)}</div>
                      <div className="flex items-center gap-1 mb-1.5">
                        <span className="text-sm font-bold text-green-600">{stats.passed}</span>
                        <span className="text-xs text-muted-foreground">/</span>
                        <span className="text-sm font-bold">{stats.total}</span>
                        {stats.failed > 0 && (
                          <span className="text-xs text-red-500 ml-1">({stats.failed} failed)</span>
                        )}
                      </div>
                      <Progress
                        value={stats.total > 0 ? (stats.passed / stats.total) * 100 : 0}
                        className="h-1.5"
                      />
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>

            {/* Scenario details */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Skenario Detail
                </h2>
                <select
                  className="text-xs border rounded px-2 py-1 bg-background"
                  value={phaseFilter}
                  onChange={(e) => setPhaseFilter(e.target.value)}
                >
                  <option value="all">Semua Phase</option>
                  {phases.map((p) => (
                    <option key={p} value={p}>{PhaseLabel(p)}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                {filteredScenarios.map((s, i) => (
                  <ScenarioRow key={i} scenario={s} />
                ))}
              </div>
            </section>

            {/* Footer metadata */}
            <section className="text-xs text-muted-foreground border-t pt-4 space-y-1">
              <div>Run ID: #{report.runId} | Suite: {report.suiteName} | Oleh: {report.triggeredBy}</div>
              <div>
                Dimulai: {report.startedAt ? new Date(report.startedAt).toLocaleString("id-ID") : "—"} |
                Selesai: {report.completedAt ? new Date(report.completedAt).toLocaleString("id-ID") : "—"} |
                Durasi: {report.durationMs != null ? (report.durationMs / 1000).toFixed(1) : "?"}s
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
