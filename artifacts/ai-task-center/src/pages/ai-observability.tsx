import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Activity, AlertTriangle, BarChart2, Brain, CheckCircle2,
  Clock, FlaskConical, RefreshCw, TrendingDown, TrendingUp, Zap,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// ─── API helpers ──────────────────────────────────────────────────────────────

function getToken(): string {
  return localStorage.getItem("ai_task_center_token") ?? "";
}

async function apiFetch(path: string) {
  const token = getToken();
  const res = await fetch(path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface HealthData {
  today: {
    total: number;
    fallbacks: number;
    corrected: number;
    fallbackRate: string;
    avgConfidence: string | null;
    avgLlmLatencyMs: number | null;
    p50LlmLatencyMs: number | null;
    p95LlmLatencyMs: number | null;
  };
  topIntents: { intent: string | null; cnt: number }[];
  trend: {
    date: string;
    total: number;
    fallbackRate: string | null;
    avgConfidence: string | null;
    avgLlmLatencyMs: number | null;
    p95LlmLatencyMs: number | null;
  }[];
}

interface AccuracyData {
  days: number;
  byIntent: {
    intentCode: string;
    sampleCount: number;
    correctionCount: number;
    fallbackCount: number;
    avgAccuracy: string | null;
    avgConfidence: string | null;
  }[];
  topCorrected: { fieldCorrected: string; originalValue: string; cnt: number }[];
  byField: { fieldCorrected: string; cnt: number }[];
}

interface CostData {
  days: number;
  totalPredictions: number;
  byVersion: { promptVersionId: number | null; versionLabel: string; model: string; count: number; pct: string; avgLatencyMs: number | null }[];
  byModel: { model: string; cnt: number }[];
  versions: { id: number; versionLabel: string; model: string; status: string; activatedAt: string | null }[];
  daily: { date: string; count: number; fallbacks: number }[];
}

interface ErrorData {
  days: number;
  fallbacks: {
    id: number; taskId: number | null; model: string; predictedIntent: string | null;
    predictedConfidence: string | null; isFallback: boolean; wasCorrected: boolean;
    llmLatencyMs: number | null; predictedAt: string;
  }[];
  lowConf: {
    id: number; taskId: number | null; model: string; predictedIntent: string | null;
    predictedConfidence: string | null; wasCorrected: boolean;
    llmLatencyMs: number | null; predictedAt: string;
  }[];
  hourlyTrend: { hour: string; total: number; fallbacks: number; fallbackRate: string }[];
  dailyErrors: {
    date: string; totalPredictions: number; totalFallbacks: number;
    totalLowConfidence: number; fallbackRate: string | null; correctionRate: string | null;
  }[];
}

interface ExperimentsData {
  experiments: {
    id: number; name: string; description: string | null; status: string;
    controlVersionId: number; challengerVersionId: number; challengerTrafficPct: number;
    conclusion: string | null; createdAt: string;
    controlLabel: string; challengerLabel: string;
    results: { id: number; group: string; sampleSize: number | null; intentAccuracy: string | null; routingAccuracy: string | null; correctionRate: string | null; winner: string | null }[];
    predictions: { experimentGroup: string | null; cnt: number; avgConfidence: string | null; fallbacks: number }[];
  }[];
}

// ─── Shared sub-components ────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub, color = "blue" }: {
  icon: React.ReactNode; label: string; value: string | number; sub?: string; color?: string;
}) {
  const colors: Record<string, string> = {
    blue: "bg-blue-50 text-blue-600",
    green: "bg-green-50 text-green-600",
    orange: "bg-orange-50 text-orange-600",
    red: "bg-red-50 text-red-600",
    purple: "bg-purple-50 text-purple-600",
    gray: "bg-gray-50 text-gray-600",
  };
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-lg ${colors[color] ?? colors["blue"]}`}>{icon}</div>
          <div>
            <p className="text-xs text-gray-500">{label}</p>
            <p className="text-xl font-semibold text-gray-900">{value}</p>
            {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="py-12 flex flex-col items-center gap-2 text-gray-400">
      <BarChart2 className="h-8 w-8 opacity-30" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: "bg-green-100 text-green-700",
    draft: "bg-gray-100 text-gray-600",
    archived: "bg-slate-100 text-slate-500",
    running: "bg-blue-100 text-blue-700",
    concluded: "bg-purple-100 text-purple-700",
    paused: "bg-yellow-100 text-yellow-700",
  };
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${map[status] ?? "bg-gray-100 text-gray-600"}`}>
      {status}
    </span>
  );
}

// Mini bar for percentages
function MiniBar({ pct, color = "bg-blue-500" }: { pct: number; color?: string }) {
  return (
    <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1">
      <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

// ─── Tab: Health ──────────────────────────────────────────────────────────────

function HealthTab() {
  const { data, isLoading, refetch, isFetching } = useQuery<HealthData>({
    queryKey: ["obs-health"],
    queryFn: () => apiFetch("/api/observability/health"),
    refetchInterval: 60_000,
  });

  if (isLoading) return <div className="py-16 text-center text-sm text-gray-400">Memuat data...</div>;

  const t = data?.today;
  const fallbackPct = parseFloat(t?.fallbackRate ?? "0");
  const confPct = t?.avgConfidence ? parseFloat(t.avgConfidence) * 100 : null;

  return (
    <div className="space-y-6">
      {/* Header action */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-800">AI Health — Hari Ini</h2>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={<Brain className="h-4 w-4" />} label="Prediksi hari ini" value={t?.total ?? 0} color="blue" />
        <StatCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Fallback rate"
          value={`${t?.fallbackRate ?? "0.0"}%`}
          sub={`${t?.fallbacks ?? 0} fallbacks`}
          color={fallbackPct > 20 ? "red" : fallbackPct > 10 ? "orange" : "green"}
        />
        <StatCard
          icon={<Zap className="h-4 w-4" />}
          label="Avg confidence"
          value={confPct != null ? `${confPct.toFixed(0)}%` : "—"}
          color={confPct == null ? "gray" : confPct >= 70 ? "green" : confPct >= 50 ? "orange" : "red"}
        />
        <StatCard
          icon={<Clock className="h-4 w-4" />}
          label="Latency p95"
          value={t?.p95LlmLatencyMs != null ? `${t.p95LlmLatencyMs}ms` : "—"}
          sub={t?.p50LlmLatencyMs != null ? `p50: ${t.p50LlmLatencyMs}ms` : undefined}
          color={t?.p95LlmLatencyMs == null ? "gray" : t.p95LlmLatencyMs > 5000 ? "red" : t.p95LlmLatencyMs > 2000 ? "orange" : "green"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top intents */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Top Intent Hari Ini</CardTitle>
          </CardHeader>
          <CardContent>
            {!data?.topIntents?.length ? <EmptyState label="Belum ada prediksi hari ini" /> : (
              <div className="space-y-2">
                {data.topIntents.map((r, i) => {
                  const total = data.topIntents.reduce((a, b) => a + Number(b.cnt), 0);
                  const pct = total > 0 ? (Number(r.cnt) / total) * 100 : 0;
                  return (
                    <div key={i}>
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-gray-700 truncate max-w-[200px]">{r.intent ?? "(unknown)"}</span>
                        <span className="text-gray-500 shrink-0 ml-2">{r.cnt} <span className="text-gray-400">({pct.toFixed(0)}%)</span></span>
                      </div>
                      <MiniBar pct={pct} color="bg-blue-400" />
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 7-day trend table */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Tren 7 Hari (dari performance_daily)</CardTitle>
          </CardHeader>
          <CardContent>
            {!data?.trend?.length ? <EmptyState label="Belum ada data trend" /> : (
              <div className="overflow-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-gray-500">
                      <th className="text-left pb-1 font-medium">Tanggal</th>
                      <th className="text-right pb-1 font-medium">Total</th>
                      <th className="text-right pb-1 font-medium">Fallback%</th>
                      <th className="text-right pb-1 font-medium">Conf avg</th>
                      <th className="text-right pb-1 font-medium">p95 lat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.trend.map((r) => (
                      <tr key={r.date} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="py-1 text-gray-600">{r.date}</td>
                        <td className="py-1 text-right font-medium">{r.total}</td>
                        <td className={`py-1 text-right ${r.fallbackRate && parseFloat(r.fallbackRate) > 20 ? "text-red-600" : "text-gray-600"}`}>
                          {r.fallbackRate != null ? `${r.fallbackRate}%` : "—"}
                        </td>
                        <td className="py-1 text-right text-gray-600">
                          {r.avgConfidence != null ? (parseFloat(r.avgConfidence) * 100).toFixed(0) + "%" : "—"}
                        </td>
                        <td className="py-1 text-right text-gray-600">
                          {r.p95LlmLatencyMs != null ? `${r.p95LlmLatencyMs}ms` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Tab: Accuracy ────────────────────────────────────────────────────────────

function AccuracyTab() {
  const [days, setDays] = useState(30);
  const { data, isLoading } = useQuery<AccuracyData>({
    queryKey: ["obs-accuracy", days],
    queryFn: () => apiFetch(`/api/observability/accuracy?days=${days}`),
  });

  if (isLoading) return <div className="py-16 text-center text-sm text-gray-400">Memuat data...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-800">Akurasi AI</h2>
        <div className="flex gap-1">
          {[7, 14, 30, 90].map((d) => (
            <Button key={d} size="sm" variant={days === d ? "default" : "outline"} onClick={() => setDays(d)} className="text-xs px-3">
              {d}h
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Per-intent accuracy */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Akurasi per Intent</CardTitle>
            <CardDescription className="text-xs">Dari performance_by_intent (last {days} hari)</CardDescription>
          </CardHeader>
          <CardContent>
            {!data?.byIntent?.length ? <EmptyState label="Belum ada data intent" /> : (
              <div className="overflow-auto max-h-80">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-gray-500">
                      <th className="text-left pb-1 font-medium">Intent</th>
                      <th className="text-right pb-1 font-medium">Sample</th>
                      <th className="text-right pb-1 font-medium">Akurasi</th>
                      <th className="text-right pb-1 font-medium">Koreksi</th>
                      <th className="text-right pb-1 font-medium">Conf</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byIntent.map((r, i) => {
                      const acc = r.avgAccuracy ? parseFloat(r.avgAccuracy) : null;
                      return (
                        <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="py-1 font-medium text-gray-700 truncate max-w-[130px]">{r.intentCode}</td>
                          <td className="py-1 text-right text-gray-500">{r.sampleCount}</td>
                          <td className={`py-1 text-right font-medium ${acc == null ? "text-gray-400" : acc >= 80 ? "text-green-600" : acc >= 60 ? "text-orange-500" : "text-red-600"}`}>
                            {acc != null ? `${acc.toFixed(0)}%` : "—"}
                          </td>
                          <td className="py-1 text-right text-orange-600">{r.correctionCount}</td>
                          <td className="py-1 text-right text-gray-500">
                            {r.avgConfidence ? (parseFloat(r.avgConfidence) * 100).toFixed(0) + "%" : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top corrected */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Intent Paling Sering Dikoreksi</CardTitle>
            </CardHeader>
            <CardContent>
              {!data?.topCorrected?.length ? <EmptyState label="Belum ada koreksi" /> : (
                <div className="space-y-1.5">
                  {data.topCorrected.slice(0, 8).map((r, i) => {
                    const max = data.topCorrected[0]?.cnt ?? 1;
                    const pct = (Number(r.cnt) / max) * 100;
                    return (
                      <div key={i}>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-gray-600 truncate max-w-[200px]">
                            <span className="font-medium text-gray-800">{r.fieldCorrected}</span>: {r.originalValue}
                          </span>
                          <span className="text-orange-600 font-semibold shrink-0 ml-2">{r.cnt}x</span>
                        </div>
                        <MiniBar pct={pct} color="bg-orange-400" />
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Koreksi per Field</CardTitle>
            </CardHeader>
            <CardContent>
              {!data?.byField?.length ? <EmptyState label="Belum ada koreksi" /> : (
                <div className="space-y-1.5">
                  {data.byField.map((r, i) => {
                    const max = data.byField[0]?.cnt ?? 1;
                    const pct = (Number(r.cnt) / max) * 100;
                    return (
                      <div key={i}>
                        <div className="flex justify-between text-xs">
                          <span className="font-medium text-gray-700">{r.fieldCorrected}</span>
                          <span className="text-gray-500">{r.cnt}x</span>
                        </div>
                        <MiniBar pct={pct} color="bg-purple-400" />
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Cost / Usage ───────────────────────────────────────────────────────

function CostTab() {
  const [days, setDays] = useState(30);
  const { data, isLoading } = useQuery<CostData>({
    queryKey: ["obs-cost", days],
    queryFn: () => apiFetch(`/api/observability/cost?days=${days}`),
  });

  if (isLoading) return <div className="py-16 text-center text-sm text-gray-400">Memuat data...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-800">Penggunaan Prompt & Model</h2>
        <div className="flex gap-1">
          {[7, 14, 30, 90].map((d) => (
            <Button key={d} size="sm" variant={days === d ? "default" : "outline"} onClick={() => setDays(d)} className="text-xs px-3">
              {d}h
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <StatCard icon={<Brain className="h-4 w-4" />} label="Total prediksi" value={(data?.totalPredictions ?? 0).toLocaleString()} color="blue" />
        <StatCard icon={<Activity className="h-4 w-4" />} label="Prompt versions aktif" value={data?.versions.filter((v) => v.status === "active").length ?? 0} color="green" />
        <StatCard icon={<BarChart2 className="h-4 w-4" />} label="Model berbeda" value={data?.byModel.length ?? 0} color="purple" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Usage by prompt version */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Penggunaan per Prompt Version</CardTitle>
          </CardHeader>
          <CardContent>
            {!data?.byVersion?.length ? <EmptyState label="Belum ada data" /> : (
              <div className="space-y-3">
                {data.byVersion.map((r, i) => (
                  <div key={i}>
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-gray-800">{r.versionLabel}</span>
                        <span className="text-gray-400">{r.model}</span>
                        {r.avgLatencyMs && (
                          <span className="text-gray-400">· {r.avgLatencyMs}ms avg</span>
                        )}
                      </div>
                      <span className="text-gray-600 shrink-0">{r.count.toLocaleString()} ({r.pct}%)</span>
                    </div>
                    <MiniBar pct={parseFloat(r.pct)} color="bg-blue-400" />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Prompt versions list */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Daftar Prompt Versions</CardTitle>
          </CardHeader>
          <CardContent>
            {!data?.versions?.length ? <EmptyState label="Belum ada prompt version" /> : (
              <div className="space-y-2">
                {data.versions.map((v) => (
                  <div key={v.id} className="flex items-center justify-between text-xs py-1.5 border-b border-gray-50">
                    <div>
                      <span className="font-medium text-gray-800">{v.versionLabel}</span>
                      <span className="text-gray-400 ml-2">{v.model}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {v.activatedAt && (
                        <span className="text-gray-400">{formatDistanceToNow(new Date(v.activatedAt), { addSuffix: true })}</span>
                      )}
                      <StatusBadge status={v.status} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Daily usage sparkline (table) */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Volume Harian</CardTitle>
          </CardHeader>
          <CardContent>
            {!data?.daily?.length ? <EmptyState label="Belum ada data harian" /> : (
              <div className="overflow-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-gray-500">
                      <th className="text-left pb-1 font-medium">Tanggal</th>
                      <th className="text-right pb-1 font-medium">Prediksi</th>
                      <th className="text-right pb-1 font-medium">Fallbacks</th>
                      <th className="text-right pb-1 font-medium">Fallback%</th>
                      <th className="pb-1 w-32"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.daily.map((r) => {
                      const maxCount = Math.max(...data.daily.map((d) => d.count), 1);
                      const pct = (r.count / maxCount) * 100;
                      const fb = r.count > 0 ? ((r.fallbacks / r.count) * 100).toFixed(0) : "0";
                      return (
                        <tr key={r.date} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="py-1 text-gray-600">{r.date}</td>
                          <td className="py-1 text-right font-medium">{r.count.toLocaleString()}</td>
                          <td className="py-1 text-right text-orange-500">{r.fallbacks}</td>
                          <td className={`py-1 text-right ${parseInt(fb) > 20 ? "text-red-600" : "text-gray-500"}`}>{fb}%</td>
                          <td className="py-1 pl-3">
                            <div className="w-full bg-gray-100 rounded h-1.5">
                              <div className="h-1.5 rounded bg-blue-400" style={{ width: `${pct}%` }} />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Tab: Errors ──────────────────────────────────────────────────────────────

function ErrorsTab() {
  const [days, setDays] = useState(7);
  const [view, setView] = useState<"fallbacks" | "lowconf">("fallbacks");
  const { data, isLoading } = useQuery<ErrorData>({
    queryKey: ["obs-errors", days],
    queryFn: () => apiFetch(`/api/observability/errors?days=${days}`),
  });

  if (isLoading) return <div className="py-16 text-center text-sm text-gray-400">Memuat data...</div>;

  const rows = view === "fallbacks" ? data?.fallbacks : data?.lowConf;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-800">Error & Fallback Monitor</h2>
        <div className="flex gap-1">
          {[1, 3, 7, 14].map((d) => (
            <Button key={d} size="sm" variant={days === d ? "default" : "outline"} onClick={() => setDays(d)} className="text-xs px-3">
              {d}h
            </Button>
          ))}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={<AlertTriangle className="h-4 w-4" />} label="Total fallbacks" value={data?.fallbacks.length ?? 0} color="orange" />
        <StatCard icon={<TrendingDown className="h-4 w-4" />} label="Low confidence" value={data?.lowConf.length ?? 0} color="red" />
        <StatCard
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Fallbacks dikoreksi"
          value={data?.fallbacks.filter((f) => f.wasCorrected).length ?? 0}
          color="green"
        />
        <StatCard
          icon={<Activity className="h-4 w-4" />}
          label="Avg fallback rate (daily)"
          value={
            data?.dailyErrors.length
              ? `${(data.dailyErrors.reduce((a, r) => a + parseFloat(r.fallbackRate ?? "0"), 0) / data.dailyErrors.length).toFixed(1)}%`
              : "—"
          }
          color="purple"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Hourly trend */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Tren Fallback per Jam (24h)</CardTitle>
          </CardHeader>
          <CardContent>
            {!data?.hourlyTrend?.length ? <EmptyState label="Belum ada data jam ini" /> : (
              <div className="space-y-1 max-h-72 overflow-auto">
                {data.hourlyTrend.slice(-24).map((r, i) => {
                  const pct = parseFloat(r.fallbackRate);
                  return (
                    <div key={i} className="text-xs flex justify-between items-center gap-2">
                      <span className="text-gray-500 shrink-0 w-16">{new Date(r.hour).toLocaleTimeString("id", { hour: "2-digit", minute: "2-digit" })}</span>
                      <div className="flex-1">
                        <MiniBar pct={pct * 5} color={pct > 20 ? "bg-red-400" : "bg-orange-300"} />
                      </div>
                      <span className={`shrink-0 w-10 text-right font-medium ${pct > 20 ? "text-red-600" : "text-gray-500"}`}>{r.fallbackRate}%</span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Daily error rates */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Error Rate Harian</CardTitle>
          </CardHeader>
          <CardContent>
            {!data?.dailyErrors?.length ? <EmptyState label="Belum ada data" /> : (
              <div className="space-y-2 max-h-72 overflow-auto">
                {data.dailyErrors.map((r) => (
                  <div key={r.date} className="text-xs border-b border-gray-50 pb-1.5">
                    <div className="flex justify-between mb-0.5">
                      <span className="font-medium text-gray-700">{r.date}</span>
                      <span className="text-gray-500">{r.totalPredictions} pred</span>
                    </div>
                    <div className="flex gap-3 text-gray-500">
                      <span className="text-orange-500">FB: {r.fallbackRate ?? "—"}%</span>
                      <span className="text-purple-500">Korr: {r.correctionRate ?? "—"}%</span>
                      <span className="text-red-500">LowConf: {r.totalLowConfidence}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Detail logs */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Log Detail</CardTitle>
              <div className="flex gap-1">
                <Button size="sm" variant={view === "fallbacks" ? "default" : "outline"} onClick={() => setView("fallbacks")} className="text-xs px-2 h-6">
                  Fallbacks
                </Button>
                <Button size="sm" variant={view === "lowconf" ? "default" : "outline"} onClick={() => setView("lowconf")} className="text-xs px-2 h-6">
                  Low Conf
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {!rows?.length ? <EmptyState label="Tidak ada data" /> : (
              <div className="space-y-2 max-h-80 overflow-auto">
                {rows.slice(0, 30).map((r) => (
                  <div key={r.id} className="text-xs border border-gray-100 rounded p-2 space-y-0.5">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-gray-700 truncate max-w-[140px]">{r.predictedIntent ?? "(none)"}</span>
                      <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                        r.predictedConfidence === "high" ? "bg-green-100 text-green-700"
                          : r.predictedConfidence === "medium" ? "bg-yellow-100 text-yellow-700"
                          : "bg-red-100 text-red-700"
                      }`}>{r.predictedConfidence ?? "—"}</span>
                    </div>
                    <div className="flex gap-2 text-gray-400">
                      {r.taskId && <span>task #{r.taskId}</span>}
                      <span>{r.llmLatencyMs != null ? `${r.llmLatencyMs}ms` : ""}</span>
                      {r.wasCorrected && <span className="text-orange-500">✓ dikoreksi</span>}
                    </div>
                    <span className="text-gray-400">{formatDistanceToNow(new Date(r.predictedAt), { addSuffix: true })}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Tab: Experiments ─────────────────────────────────────────────────────────

function ExperimentsTab() {
  const { data, isLoading } = useQuery<ExperimentsData>({
    queryKey: ["obs-experiments"],
    queryFn: () => apiFetch("/api/observability/experiments"),
    refetchInterval: 60_000,
  });

  if (isLoading) return <div className="py-16 text-center text-sm text-gray-400">Memuat data...</div>;

  const exps = data?.experiments ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-800">Performa Eksperimen</h2>
        <Badge variant="outline" className="text-xs">{exps.length} eksperimen</Badge>
      </div>

      {!exps.length ? (
        <Card>
          <CardContent className="py-16">
            <EmptyState label="Belum ada eksperimen yang dibuat" />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {exps.map((exp) => {
            const totalPred = exp.predictions.reduce((a, p) => a + Number(p.cnt), 0);
            const controlPred = exp.predictions.find((p) => p.experimentGroup === "control");
            const challengerPred = exp.predictions.find((p) => p.experimentGroup === "challenger");

            return (
              <Card key={exp.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-sm">{exp.name}</CardTitle>
                      {exp.description && <CardDescription className="text-xs mt-0.5">{exp.description}</CardDescription>}
                    </div>
                    <StatusBadge status={exp.status} />
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Versions */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-blue-50 rounded-lg p-3 text-xs space-y-1">
                      <p className="font-semibold text-blue-700">Control</p>
                      <p className="text-blue-600">{exp.controlLabel}</p>
                      <p className="text-blue-500">{Number(controlPred?.cnt ?? 0)} prediksi</p>
                      {controlPred?.avgConfidence && (
                        <p className="text-blue-500">Conf avg: {(parseFloat(String(controlPred.avgConfidence)) * 100).toFixed(0)}%</p>
                      )}
                    </div>
                    <div className="bg-orange-50 rounded-lg p-3 text-xs space-y-1">
                      <p className="font-semibold text-orange-700">Challenger ({exp.challengerTrafficPct}%)</p>
                      <p className="text-orange-600">{exp.challengerLabel}</p>
                      <p className="text-orange-500">{Number(challengerPred?.cnt ?? 0)} prediksi</p>
                      {challengerPred?.avgConfidence && (
                        <p className="text-orange-500">Conf avg: {(parseFloat(String(challengerPred.avgConfidence)) * 100).toFixed(0)}%</p>
                      )}
                    </div>
                  </div>

                  {/* Results */}
                  {exp.results.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-600 mb-2">Hasil Eksperimen</p>
                      <div className="overflow-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b text-gray-500">
                              <th className="text-left pb-1 font-medium">Group</th>
                              <th className="text-right pb-1 font-medium">Sample</th>
                              <th className="text-right pb-1 font-medium">Intent Acc</th>
                              <th className="text-right pb-1 font-medium">Routing Acc</th>
                              <th className="text-right pb-1 font-medium">Koreksi%</th>
                              <th className="text-right pb-1 font-medium">Winner</th>
                            </tr>
                          </thead>
                          <tbody>
                            {exp.results.map((r) => (
                              <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                                <td className="py-1 font-medium text-gray-700">{r.group}</td>
                                <td className="py-1 text-right text-gray-500">{r.sampleSize ?? "—"}</td>
                                <td className="py-1 text-right text-gray-600">
                                  {r.intentAccuracy ? `${parseFloat(r.intentAccuracy).toFixed(0)}%` : "—"}
                                </td>
                                <td className="py-1 text-right text-gray-600">
                                  {r.routingAccuracy ? `${parseFloat(r.routingAccuracy).toFixed(0)}%` : "—"}
                                </td>
                                <td className="py-1 text-right text-orange-500">
                                  {r.correctionRate ? `${parseFloat(r.correctionRate).toFixed(0)}%` : "—"}
                                </td>
                                <td className="py-1 text-right">
                                  {r.winner ? <span className="text-green-600 font-semibold">{r.winner}</span> : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Conclusion */}
                  {exp.conclusion && (
                    <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600">
                      <span className="font-semibold text-gray-700">Kesimpulan: </span>
                      {exp.conclusion}
                    </div>
                  )}

                  <div className="text-xs text-gray-400 flex gap-4">
                    <span>Total prediksi: {totalPred}</span>
                    <span>Dibuat {formatDistanceToNow(new Date(exp.createdAt), { addSuffix: true })}</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AiObservabilityPage() {
  const { user } = useAuth();

  if (!user || !["super_admin", "company_admin", "supervisor"].includes(user.role ?? "")) {
    return (
      <div className="max-w-2xl mx-auto p-8 text-center">
        <AlertTriangle className="h-10 w-10 text-orange-400 mx-auto mb-3" />
        <p className="text-gray-600">Halaman ini hanya untuk Supervisor, Company Admin, atau Super Admin.</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-xl bg-indigo-50">
          <Activity className="h-6 w-6 text-indigo-600" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-gray-900">AI Observability</h1>
          <p className="text-sm text-gray-500">Monitoring real-time performa, akurasi, dan health model AI</p>
        </div>
        <Badge variant="outline" className="ml-auto text-xs text-indigo-600 border-indigo-200 bg-indigo-50">
          Read-only
        </Badge>
      </div>

      <Tabs defaultValue="health">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="health" className="text-xs flex items-center gap-1">
            <Zap className="h-3.5 w-3.5" /> Health
          </TabsTrigger>
          <TabsTrigger value="accuracy" className="text-xs flex items-center gap-1">
            <TrendingUp className="h-3.5 w-3.5" /> Akurasi
          </TabsTrigger>
          <TabsTrigger value="cost" className="text-xs flex items-center gap-1">
            <BarChart2 className="h-3.5 w-3.5" /> Usage
          </TabsTrigger>
          <TabsTrigger value="errors" className="text-xs flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5" /> Errors
          </TabsTrigger>
          <TabsTrigger value="experiments" className="text-xs flex items-center gap-1">
            <FlaskConical className="h-3.5 w-3.5" /> Eksperimen
          </TabsTrigger>
        </TabsList>

        <TabsContent value="health" className="pt-4"><HealthTab /></TabsContent>
        <TabsContent value="accuracy" className="pt-4"><AccuracyTab /></TabsContent>
        <TabsContent value="cost" className="pt-4"><CostTab /></TabsContent>
        <TabsContent value="errors" className="pt-4"><ErrorsTab /></TabsContent>
        <TabsContent value="experiments" className="pt-4"><ExperimentsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
